import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaService } from "../src/prisma/prisma.service";
import type { ImageNormalizationService } from "../src/kyc/image/image-normalization.service";
import { KycService } from "../src/kyc/kyc.service";
import type { FileStorage } from "../src/kyc/storage/file-storage.port";

jest.mock("@nestjs/common", () => ({
  BadRequestException: class BadRequestException extends Error {},
  ConflictException: class ConflictException extends Error {},
  ForbiddenException: class ForbiddenException extends Error {},
  Inject: () => (target: unknown) => target,
  Injectable: () => (target: unknown) => target,
  NotFoundException: class NotFoundException extends Error {},
}));

const OWNER = { id: "history-owner", email: "owner@example.test" };
const NOW = new Date("2026-09-06T12:00:00.000Z");
const FUTURE = new Date("2026-12-05T12:00:00.000Z");
const FINALIZED_AT = new Date("2026-09-06T10:00:00.000Z");

function historyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "history-entry-one",
    userId: OWNER.id,
    status: "APPROVED",
    rejectionCode: "KYC_APPROVED",
    documentType: "COLOMBIAN_CEDULA",
    documentFullName: "Test Holder",
    documentNumber: "12345678",
    documentBirthDate: new Date("1990-01-01T00:00:00.000Z"),
    documentIssueDate: new Date("2010-01-01T00:00:00.000Z"),
    documentSex: "F",
    documentHeight: "165",
    documentBloodType: "O+",
    documentBirthPlace: "Bogota",
    documentCheckResult: "VALID",
    faceSimilarity: 0.8,
    faceAiVerdict: null,
    faceAiSimilarityPercent: null,
    faceAiSummary: null,
    finalizedAt: FINALIZED_AT,
    expiresAt: FUTURE,
    documentNumberHash: "must-not-leak",
    documentProvider: "must-not-leak",
    documentProviderModel: "must-not-leak",
    faceDistance: 0.2,
    documentOcrConfidence: 0.99,
    images: [{ id: "media-one", kind: "DOCUMENT", side: "FRONT" }],
    ...overrides,
  };
}

function createService(rows: Record<string, unknown>[] = [historyRow()]): {
  service: KycService;
  findMany: jest.Mock;
  findFirst: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue(rows);
  const findFirst = jest.fn().mockResolvedValue(rows[0] ?? null);
  const prismaService = {
    kycVerification: { findMany, findFirst },
  } as unknown as PrismaService;
  const fileStorage = { read: jest.fn(), remove: jest.fn(), write: jest.fn() } as unknown as FileStorage;
  const service = new KycService(
    prismaService,
    {} as ImageNormalizationService,
    fileStorage,
    { values: { documentProvider: "local", faceVerificationProvider: "local" } } as never,
  );

  return { service, findMany, findFirst };
}

describe("KycService private history", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists only unexpired terminal entries for the authenticated owner using a total cursor order", async () => {
    const { service, findMany } = createService([
      historyRow(),
      historyRow({ id: "history-entry-two", finalizedAt: FINALIZED_AT }),
    ]);

    await expect(service.listHistory(OWNER, { limit: 1 })).resolves.toEqual({
      items: [
        {
          id: "history-entry-one",
          status: "APPROVED",
          finalizedAt: FINALIZED_AT,
          faceSimilarity: 0.8,
          faceAiVerdict: null,
          faceAiSimilarityPercent: null,
          faceAiSummary: null,
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: OWNER.id,
        status: { in: ["APPROVED", "REJECTED", "NEEDS_REVIEW", "PROCESSING_FAILED"] },
        finalizedAt: { not: null },
        expiresAt: { gt: NOW },
      },
      orderBy: [{ finalizedAt: "desc" }, { id: "desc" }],
      take: 2,
      select: expect.any(Object),
    });
    const selectedFields = findMany.mock.calls[0]?.[0].select as Record<string, unknown>;
    expect(selectedFields).not.toHaveProperty("documentNumberHash");
    expect(selectedFields).not.toHaveProperty("faceDistance");
    expect(selectedFields).not.toHaveProperty("documentProvider");
  });

  it("rejects an opaque cursor with an invalid shape instead of weakening its owner and expiration predicates", async () => {
    const { service, findMany } = createService();

    await expect(service.listHistory(OWNER, { cursor: "not-a-compatible-cursor" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1.01, 1.01])(
    "redacts an invalid face similarity from history detail (%p)",
    async (faceSimilarity) => {
      const { service } = createService([historyRow({ faceSimilarity })]);

      await expect(service.getHistoryDetail(OWNER, "history-entry-one")).resolves.toEqual({
        id: "history-entry-one",
        status: "APPROVED",
        reasonCode: "KYC_APPROVED",
        finalizedAt: FINALIZED_AT,
        documentFullName: "Test Holder",
        documentNumber: "12345678",
        documentBirthDate: new Date("1990-01-01T00:00:00.000Z"),
        documentIssueDate: new Date("2010-01-01T00:00:00.000Z"),
        documentSex: "F",
        documentHeight: "165",
        documentBloodType: "O+",
        documentBirthPlace: "Bogota",
        documentCheckResult: "VALID",
        documentNationality: "COLOMBIAN",
        faceSimilarity: null,
        faceAiVerdict: null,
        faceAiSimilarityPercent: null,
        faceAiSummary: null,
        images: [{ id: "media-one", kind: "DOCUMENT", side: "FRONT" }],
      });
      const detailQuery = (service as unknown as { prismaService: { kycVerification: { findFirst: jest.Mock } } }).prismaService.kycVerification.findFirst.mock.calls[0]?.[0];
      expect(detailQuery.select).not.toHaveProperty("documentNumberHash");
      expect(detailQuery.select).not.toHaveProperty("faceDistance");
      expect(detailQuery.select).not.toHaveProperty("documentProvider");
    },
  );

  it("denies another owner and expired history detail", async () => {
    const otherOwner = createService([historyRow({ userId: "another-user" })]);
    await expect(otherOwner.service.getHistoryDetail(OWNER, "history-entry-one")).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const expired = createService([historyRow({ expiresAt: new Date("2026-09-06T11:59:59.000Z") })]);
    await expect(expired.service.getHistoryDetail(OWNER, "history-entry-one")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
