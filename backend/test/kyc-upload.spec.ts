import type { PrismaService } from "../src/prisma/prisma.service";
import type { ImageNormalizationService } from "../src/kyc/image/image-normalization.service";
import type { FileStorage } from "../src/kyc/storage/file-storage.port";
import type { KycImage } from "@prisma/client";
import { KycService } from "../src/kyc/kyc.service";
import type { AuthenticatedUser } from "../src/common/types/authenticated-user";
import { DOCUMENT_SIDE } from "../src/kyc/domain/document-side";

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

const USER_ID = "clxabc123def456ghi789jklm";
const VERIFICATION_ID = "verification-id";
const UPLOADED_BYTES = Buffer.from("uploaded-image-bytes");

const USER: AuthenticatedUser = { id: USER_ID, email: "owner@example.test" };

const NORMALIZED_IMAGE = {
  buffer: UPLOADED_BYTES,
  mimeType: "image/jpeg",
  byteSize: 42,
  width: 800,
  height: 600,
  sha256: "uploaded-hash",
};

interface MockVerification {
  id: string;
  userId: string;
  status: string;
  rejectionCode: null;
  documentType: null;
  faceSimilarity: null;
  frontPresent: boolean;
  backPresent: boolean;
  createdAt: Date;
  updatedAt: Date;
  images: KycImage[];
}

function verificationRow(status: string): MockVerification {
  return {
    id: VERIFICATION_ID,
    userId: USER_ID,
    status,
    rejectionCode: null,
    documentType: null,
    faceSimilarity: null,
    frontPresent: false,
    backPresent: false,
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
    images: [],
  };
}

function imageRow(): KycImage {
  return {
    id: "cabcdefghijklmnopqrstuvwx",
    verificationId: VERIFICATION_ID,
    kind: "SELFIE",
    side: null,
    storageKey: "ignored-for-this-test",
    mimeType: "image/jpeg",
    byteSize: 42,
    width: 800,
    height: 600,
    sha256: "uploaded-hash",
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
  };
}

interface UploadHarness {
  service: KycService;
  write: jest.Mock;
}

function createUploadHarness(startingStatus: string): UploadHarness {
  const currentVerification = verificationRow(startingStatus);
  const updatedVerification = verificationRow(
    startingStatus === "DOCUMENT_UPLOADED" ? "SELFIE_UPLOADED" : "DOCUMENT_UPLOADED",
  );
  updatedVerification.images = [imageRow()];

  const transaction = {
    kycVerification: {
      findFirst: jest.fn().mockResolvedValue(currentVerification),
      update: jest.fn().mockResolvedValue(updatedVerification),
    },
    kycImage: {
      upsert: jest.fn().mockResolvedValue(imageRow()),
    },
  };

  const prismaService = {
    kycVerification: { findFirst: jest.fn().mockResolvedValue(currentVerification) },
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaService;

  const imageNormalizationService = {
    normalize: jest.fn().mockResolvedValue(NORMALIZED_IMAGE),
  } as unknown as ImageNormalizationService;

  const write = jest.fn().mockResolvedValue(undefined);
  const fileStorage = {
    write,
    read: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as FileStorage;

  return {
    service: new KycService(prismaService, imageNormalizationService, fileStorage),
    write,
  };
}

// Mirrors the safe-key rule enforced by LocalFileStorage.
const SAFE_STORAGE_KEY_PATTERN = /^[a-zA-Z0-9/_-]+\.jpg$/;

describe("KycService image upload storage keys", () => {
  it.each([
    {
      label: "document front evidence",
      call: (service: KycService) => service.uploadDocument(USER, UPLOADED_BYTES, DOCUMENT_SIDE.FRONT),
      sidePath: "front",
      startingStatus: "CREATED",
    },
    {
      label: "document back evidence",
      call: (service: KycService) => service.uploadDocument(USER, UPLOADED_BYTES, DOCUMENT_SIDE.BACK),
      sidePath: "back",
      startingStatus: "CREATED",
    },
    {
      label: "the selfie",
      call: (service: KycService) => service.uploadSelfie(USER, UPLOADED_BYTES),
      sidePath: "selfie",
      startingStatus: "DOCUMENT_UPLOADED",
    },
  ])("stores $label under {userId}/{verificationId}/$sidePath/{uuid}.jpg", async ({ call, sidePath, startingStatus }) => {
    const { service, write } = createUploadHarness(startingStatus);

    await call(service);

    const [writeArgument] = write.mock.calls[0];
    expect(writeArgument.key).toMatch(
      new RegExp(`^${USER_ID}/${VERIFICATION_ID}/${sidePath}/[0-9a-f-]{36}\\.jpg$`),
    );
    expect(writeArgument.key).toMatch(SAFE_STORAGE_KEY_PATTERN);
  });

  it("always namespaces the stored key with the uploading user id first", async () => {
    const { service, write } = createUploadHarness("CREATED");

    await service.uploadDocument(USER, UPLOADED_BYTES, DOCUMENT_SIDE.FRONT);

    const [writeArgument] = write.mock.calls[0];
    expect(writeArgument.key).toMatch(new RegExp(`^${USER_ID}/`));
  });
});