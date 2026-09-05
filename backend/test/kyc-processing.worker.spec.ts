jest.mock("@nestjs/common", () => ({
  Inject: () => (): void => undefined,
  Injectable: () => (): void => undefined,
  Logger: class {
    warn(): void {}
  },
}));

jest.mock("@nestjs/schedule", () => ({
  Interval: () => (): void => undefined,
}));

import type { KycProcessingJob, KycVerification } from "@prisma/client";
import { KYC_STATUS } from "../src/kyc/domain/kyc-state";
import {
  KYC_PROCESSING_FAILURE,
  KycProcessingWorker,
} from "../src/kyc/kyc-processing.worker";
import {
  GEMINI_DOCUMENT_EXTRACTION_FAILURE,
  GeminiDocumentExtractionError,
} from "../src/kyc/providers/gemini-document-extraction.provider";
import {
  ExternalDocumentProviderError,
  EXTERNAL_DOCUMENT_PROVIDER_FAILURE,
} from "../src/kyc/providers/external-document-provider.error";
import type { DocumentExtractionProvider } from "../src/kyc/providers/document-extraction.provider";
import { DOCUMENT_PARSE_OUTCOME } from "../src/kyc/providers/document-extraction.provider";
import {
  FACE_CAPTURE_FAILURE_CODE,
  FaceCaptureError,
} from "../src/kyc/providers/local-human-face-verification.provider";
import type { FaceVerificationProvider } from "../src/kyc/providers/face-verification.provider";
import type { FileStorage } from "../src/kyc/storage/file-storage.port";
import type { AppConfigService } from "../src/config/app-config.service";
import type { PrismaService } from "../src/prisma/prisma.service";

interface TransactionSpy {
  kycProcessingJob: { updateMany: jest.Mock };
  kycVerification: { updateMany: jest.Mock };
}

function createVerification(): KycVerification {
  return {
    id: "verification-opaque-id",
    userId: "user-opaque-id",
    status: KYC_STATUS.VALIDATING,
    rejectionCode: null,
    documentType: null,
    documentNumberHash: null,
    documentFullName: null,
    documentNumber: null,
    documentBirthDate: null,
    documentIssueDate: null,
    documentSex: null,
    documentHeight: null,
    documentCheckResult: null,
    documentOcrConfidence: null,
    documentProvider: null,
    documentProviderModel: null,
    faceDistance: null,
    faceSimilarity: null,
    frontPresent: true,
    backPresent: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createJob(): KycProcessingJob & { lockToken: string } {
  return {
    id: "job-opaque-id",
    verificationId: "verification-opaque-id",
    status: "RUNNING",
    attempts: 1,
    lockedAt: new Date(),
    lockToken: "lock-opaque-token",
    completedAt: null,
    failureCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface WorkerHarnessImage {
  kind: string;
  side: string | null;
  storageKey: string;
}

interface WorkerHarnessOptions {
  images?: WorkerHarnessImage[];
  faceVerify?: jest.Mock;
}

function createWorker(
  fileStorage: FileStorage,
  extract: jest.Mock,
  options: WorkerHarnessOptions = {},
): {
  worker: KycProcessingWorker;
  transaction: TransactionSpy;
} {
  const transaction: TransactionSpy = {
    kycProcessingJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    kycVerification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prismaService = {
    kycVerification: {
      findUnique: jest.fn().mockResolvedValue({
        ...createVerification(),
        images:
          options.images ?? [
            { kind: "DOCUMENT", side: "FRONT", storageKey: "document-key" },
            { kind: "SELFIE", side: null, storageKey: "selfie-key" },
          ],
      }),
    },
    $transaction: jest.fn(async (callback: (tx: TransactionSpy) => Promise<void>) => callback(transaction)),
  } as unknown as PrismaService;
  const documentProvider: DocumentExtractionProvider = {
    audit: { provider: "test", model: "test" },
    extract,
  };
  const faceProvider: FaceVerificationProvider = {
    verify: options.faceVerify ?? jest.fn(),
  };
  const configService = {
    values: { ocrMinimumConfidence: 0.8 },
  } as AppConfigService;

  return {
    worker: new KycProcessingWorker(
      prismaService,
      configService,
      fileStorage,
      documentProvider,
      faceProvider,
    ),
    transaction,
  };
}

describe("KycProcessingWorker stage failures", () => {
  it("fails closed with a document storage code", async () => {
    const fileStorage = { read: jest.fn().mockRejectedValue(new Error("storage failure")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(fileStorage, jest.fn());

    await worker["processJob"](createJob());

    expect(transaction.kycProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureCode: KYC_PROCESSING_FAILURE.DOCUMENT_STORAGE_READ_FAILED }),
      }),
    );
    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: KYC_STATUS.PROCESSING_FAILED }) }),
    );
  });

  it("fails closed with a document provider code", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const extract = jest.fn().mockRejectedValue(new Error("provider failure"));
    const { worker, transaction } = createWorker(fileStorage, extract);

    await worker["processJob"](createJob());

    expect(extract).toHaveBeenCalledWith([
      { side: "FRONT", buffer: Buffer.from("image") },
    ]);
    expect(transaction.kycProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureCode: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_FAILED }),
      }),
    );
  });

  it("persists a quota exhaustion code without exposing the provider failure", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(
      fileStorage,
      jest
        .fn()
        .mockRejectedValue(
          new GeminiDocumentExtractionError(
            GEMINI_DOCUMENT_EXTRACTION_FAILURE.REQUEST_QUOTA_EXHAUSTED,
          ),
        ),
    );
    const loggerWarn = jest.fn();
    Object.defineProperty(worker, "logger", { value: { warn: loggerWarn } });

    await worker["processJob"](createJob());

    expect(transaction.kycProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED,
          status: "FAILED",
        }),
      }),
    );
    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rejectionCode: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED,
          status: KYC_STATUS.PROCESSING_FAILED,
        }),
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith(
      JSON.stringify({
        event: "kyc_processing_stage_failed",
        stage: "document-provider",
        code: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED,
        jobId: "job-opaque-id",
        verificationId: "verification-opaque-id",
      }),
    );
  });

  it("persists a generic external document-provider rate-limit code", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(
      fileStorage,
      jest
        .fn()
        .mockRejectedValue(
          new ExternalDocumentProviderError(EXTERNAL_DOCUMENT_PROVIDER_FAILURE.RATE_LIMITED),
        ),
    );

    await worker["processJob"](createJob());

    expect(transaction.kycProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_RATE_LIMITED,
          status: "FAILED",
        }),
      }),
    );
    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rejectionCode: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_RATE_LIMITED,
          status: KYC_STATUS.PROCESSING_FAILED,
        }),
      }),
    );
  });
});

describe("KycProcessingWorker document profile persistence", () => {
  const FULL_COVERAGE_IMAGES: WorkerHarnessImage[] = [
    { kind: "DOCUMENT", side: "FRONT", storageKey: "document-front-key" },
    { kind: "DOCUMENT", side: "BACK", storageKey: "document-back-key" },
    { kind: "SELFIE", side: null, storageKey: "selfie-key" },
  ];

  const VALID_EXTRACTION = {
    confidence: 0.95,
    parsedDocument: {
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "12345678",
      fullName: "PEPITA PEREZ",
      birthDate: "1990-05-15",
      issueDate: "2015-03-10",
      sex: "F",
      height: "1,64 m",
      reasonCode: "DOCUMENT_PARSED",
    },
    frontPresent: true,
    backPresent: true,
    audit: { provider: "test", model: "test" },
  };

  it("persists the typed profile fields and the document verdict on approval", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockResolvedValue({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0.1,
      similarity: 0.9,
      accepted: true,
    });
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue(VALID_EXTRACTION),
      { images: FULL_COVERAGE_IMAGES, faceVerify },
    );

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.APPROVED,
          rejectionCode: "KYC_APPROVED",
          documentCheckResult: DOCUMENT_PARSE_OUTCOME.VALID,
          documentFullName: "PEPITA PEREZ",
          documentNumber: "12345678",
          documentBirthDate: new Date("1990-05-15T00:00:00.000Z"),
          documentIssueDate: new Date("2015-03-10T00:00:00.000Z"),
          documentSex: "F",
          documentHeight: "1,64 m",
        }),
      }),
    );
  });

  it("persists the typed profile fields and the verdict on a face-capture failure", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockRejectedValue(
      new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.MULTIPLE_FACES),
    );
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue(VALID_EXTRACTION),
      { images: FULL_COVERAGE_IMAGES, faceVerify },
    );

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.NEEDS_REVIEW,
          rejectionCode: "FACE_CAPTURE_MULTIPLE_FACES",
          documentCheckResult: DOCUMENT_PARSE_OUTCOME.VALID,
          documentFullName: "PEPITA PEREZ",
          documentNumber: "12345678",
          documentBirthDate: new Date("1990-05-15T00:00:00.000Z"),
          documentIssueDate: new Date("2015-03-10T00:00:00.000Z"),
          documentSex: "F",
          documentHeight: "1,64 m",
          documentType: null,
          documentNumberHash: null,
        }),
      }),
    );
  });

  it("preserves the typed document fields when an unusable embedding triggers review", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockRejectedValue(
      new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE),
    );
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue(VALID_EXTRACTION),
      { images: FULL_COVERAGE_IMAGES, faceVerify },
    );

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.NEEDS_REVIEW,
          rejectionCode: "FACE_CAPTURE_EMBEDDING_UNAVAILABLE",
          documentCheckResult: DOCUMENT_PARSE_OUTCOME.VALID,
          documentFullName: "PEPITA PEREZ",
          documentNumber: "12345678",
          documentBirthDate: new Date("1990-05-15T00:00:00.000Z"),
          documentIssueDate: new Date("2015-03-10T00:00:00.000Z"),
          documentSex: "F",
          documentHeight: "1,64 m",
          documentType: null,
          documentNumberHash: null,
        }),
      }),
    );
  });

  it("persists measured scores for a true face similarity rejection", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockResolvedValue({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0.8,
      similarity: 0.05,
      accepted: false,
    });
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue(VALID_EXTRACTION),
      { images: FULL_COVERAGE_IMAGES, faceVerify },
    );

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.REJECTED,
          rejectionCode: "FACE_SIMILARITY_BELOW_THRESHOLD",
          faceDistance: 0.8,
          faceSimilarity: 0.05,
        }),
      }),
    );
  });

  it("persists only the reject verdict and nulls the typed profile fields", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const extract = jest.fn().mockResolvedValue({
      confidence: 0.95,
      parsedDocument: {
        outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
        documentType: null,
        documentNumber: null,
        fullName: null,
        birthDate: null,
        issueDate: null,
        sex: null,
        height: null,
        reasonCode: "DOCUMENT_UNSUPPORTED",
      },
      frontPresent: true,
      backPresent: true,
      audit: { provider: "test", model: "test" },
    });
    const { worker, transaction } = createWorker(fileStorage, extract, {
      images: FULL_COVERAGE_IMAGES,
    });

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.REJECTED,
          rejectionCode: "DOCUMENT_UNSUPPORTED",
          documentCheckResult: DOCUMENT_PARSE_OUTCOME.REJECT,
          documentFullName: null,
          documentNumber: null,
          documentBirthDate: null,
          documentIssueDate: null,
          documentSex: null,
          documentHeight: null,
          documentType: null,
          documentNumberHash: null,
        }),
      }),
    );
  });

  it("persists null profile fields when processing fails before extraction", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockRejectedValue(new Error("provider failure")),
      { images: FULL_COVERAGE_IMAGES },
    );

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.PROCESSING_FAILED,
          documentCheckResult: null,
          documentFullName: null,
          documentNumber: null,
          documentBirthDate: null,
          documentIssueDate: null,
          documentSex: null,
          documentHeight: null,
        }),
      }),
    );
  });

  it("persists null optional profile fields when the model omits them", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockResolvedValue({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0.1,
      similarity: 0.9,
      accepted: true,
    });
    const extract = jest.fn().mockResolvedValue({
      confidence: 0.95,
      parsedDocument: {
        outcome: DOCUMENT_PARSE_OUTCOME.VALID,
        documentType: "COLOMBIAN_CEDULA",
        documentNumber: "12345678",
        fullName: "PEPITA PEREZ",
        birthDate: "1990-05-15",
        issueDate: null,
        sex: null,
        height: null,
        reasonCode: "DOCUMENT_PARSED",
      },
      frontPresent: true,
      backPresent: true,
      audit: { provider: "test", model: "test" },
    });
    const { worker, transaction } = createWorker(fileStorage, extract, {
      images: FULL_COVERAGE_IMAGES,
      faceVerify,
    });

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.APPROVED,
          documentCheckResult: DOCUMENT_PARSE_OUTCOME.VALID,
          documentFullName: "PEPITA PEREZ",
          documentNumber: "12345678",
          documentBirthDate: new Date("1990-05-15T00:00:00.000Z"),
          documentIssueDate: null,
          documentSex: null,
          documentHeight: null,
        }),
      }),
    );
  });
});
