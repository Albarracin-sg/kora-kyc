import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaService } from "../src/prisma/prisma.service";
import type { ImageNormalizationService } from "../src/kyc/image/image-normalization.service";
import type { FileStorage } from "../src/kyc/storage/file-storage.port";
import type { KycImage } from "@prisma/client";
import { KycService } from "../src/kyc/kyc.service";

jest.mock("@nestjs/common", () => ({
  BadRequestException: class BadRequestException extends Error {},
  ConflictException: class ConflictException extends Error {},
  ForbiddenException: class ForbiddenException extends Error {},
  Inject: () => (target: unknown, key: string | symbol | undefined, index: number) => target,
  Injectable: () => (target: unknown) => target,
  Logger: class Logger {
    warn(): void {}
  },
  NotFoundException: class NotFoundException extends Error {},
  OnModuleDestroy: class OnModuleDestroy {},
  OnModuleInit: class OnModuleInit {},
  PayloadTooLargeException: class PayloadTooLargeException extends Error {},
  UnsupportedMediaTypeException: class UnsupportedMediaTypeException extends Error {},
}));

jest.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
  },
  PrismaClient: class PrismaClient {},
}));

const OWNER_USER_ID = "media-owner-user";
const MEDIA_ID = "cabcdefghijklmnopqrstuvwx";
const STORAGE_KEY =
  "media-owner-user/verification-id/document/front/00000000-0000-4000-8000-000000000000.jpg";
const STORED_BYTES = Buffer.from("stored-image-bytes");

interface ServiceMocks {
  service: KycService;
  findUnique: jest.Mock;
  read: jest.Mock;
}

function createServiceWithImageRow(row: unknown): ServiceMocks {
  const findUnique = jest.fn().mockResolvedValue(row);
  const prismaService = {
    kycImage: { findUnique },
  } as unknown as PrismaService;
  const imageNormalizationService = {} as unknown as ImageNormalizationService;
  const read = jest.fn().mockResolvedValue(STORED_BYTES);
  const fileStorage = {
    write: jest.fn(),
    read,
    remove: jest.fn(),
  } as unknown as FileStorage;

  return {
    service: new KycService(
      prismaService,
      imageNormalizationService,
      fileStorage,
      { values: { documentProvider: "local", faceVerificationProvider: "local" } } as never,
    ),
    findUnique,
    read,
  };
}

function imageRow(overrides: Partial<KycImage> = {}): KycImage {
  return {
    id: MEDIA_ID,
    verificationId: "verification-id",
    kind: "DOCUMENT",
    side: "FRONT",
    storageKey: STORAGE_KEY,
    mimeType: "image/jpeg",
    byteSize: 42,
    width: 800,
    height: 600,
    sha256: "stored-hash",
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  };
}

describe("KycService.readOwnedMedia", () => {
  it("rejects a media identifier that does not look like a KYC image id", async () => {
    const mocks = createServiceWithImageRow(null);

    await expect(
      mocks.service.readOwnedMedia({ id: OWNER_USER_ID, email: "owner@example.test" }, "../../etc/passwd"),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns not found when the image does not exist", async () => {
    const mocks = createServiceWithImageRow(null);

    await expect(
      mocks.service.readOwnedMedia({ id: OWNER_USER_ID, email: "owner@example.test" }, MEDIA_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: MEDIA_ID },
      include: { verification: { select: { userId: true, status: true, expiresAt: true } } },
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("denies media owned by another user", async () => {
    const row = {
      ...imageRow(),
      verification: { userId: "another-user", status: "APPROVED", expiresAt: new Date("2026-12-01T00:00:00.000Z") },
    };
    const mocks = createServiceWithImageRow(row);

    await expect(
      mocks.service.readOwnedMedia({ id: OWNER_USER_ID, email: "owner@example.test" }, MEDIA_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("hides media whose stored key does not match the safe pattern", async () => {
    const row = {
      ...imageRow({ storageKey: "archive/not-a-jpeg.png" }),
      verification: { userId: OWNER_USER_ID, status: "APPROVED", expiresAt: new Date("2026-12-01T00:00:00.000Z") },
    };
    const mocks = createServiceWithImageRow(row);

    await expect(
      mocks.service.readOwnedMedia({ id: OWNER_USER_ID, email: "owner@example.test" }, MEDIA_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("streams the owned image with its stored metadata", async () => {
    const row = {
      ...imageRow(),
      verification: { userId: OWNER_USER_ID, status: "APPROVED", expiresAt: new Date("2026-12-01T00:00:00.000Z") },
    };
    const mocks = createServiceWithImageRow(row);

    await expect(
      mocks.service.readOwnedMedia({ id: OWNER_USER_ID, email: "owner@example.test" }, MEDIA_ID),
    ).resolves.toEqual({
      buffer: STORED_BYTES,
      mimeType: "image/jpeg",
      byteSize: 42,
    });

    expect(mocks.read).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("does not stream media after the terminal verification expires", async () => {
    const mocks = createServiceWithImageRow({
      ...imageRow(),
      verification: { userId: OWNER_USER_ID, status: "APPROVED", expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    await expect(
      mocks.service.readOwnedMedia({ id: OWNER_USER_ID, email: "owner@example.test" }, MEDIA_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
