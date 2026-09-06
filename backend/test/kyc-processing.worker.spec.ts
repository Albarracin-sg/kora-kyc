jest.mock("@nestjs/common", () => ({
  Inject: () => (): void => undefined,
  Injectable: () => (): void => undefined,
  Logger: class {
    log(): void {}
    warn(): void {}
  },
}));

jest.mock("@nestjs/schedule", () => ({
  Interval: () => (): void => undefined,
}));

import type { KycProcessingJob, KycVerification } from "@prisma/client";
import {
  FACE_VERIFICATION_PROVIDER,
  KYC_DOCUMENT_PROVIDER,
  type FaceVerificationProviderName,
  type KycDocumentProvider,
} from "../src/config/app-config.service";
import { KYC_STATUS } from "../src/kyc/domain/kyc-state";
import { REMOTE_BIOMETRIC_CONSENT_VERSION } from "../src/kyc/domain/remote-biometric-consent";
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
import {
  HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE,
  HuggingFaceDocumentExtractionError,
} from "../src/kyc/providers/hugging-face-document-extraction.provider";
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
    documentBloodType: null,
    documentBirthPlace: null,
    documentCheckResult: null,
    documentOcrConfidence: null,
    documentProvider: null,
    documentProviderModel: null,
    faceDistance: null,
    faceSimilarity: null,
    faceAiVerdict: null,
    faceAiSimilarityPercent: null,
    faceAiSummary: null,
    faceAiProvider: null,
    faceAiProviderModel: null,
    faceCombinedSimilarityPercent: null,
    faceCombinedVerdict: null,
    consentVersion: null,
    consentAcceptedAt: null,
    frontPresent: true,
    backPresent: true,
    finalizedAt: null,
    expiresAt: null,
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
  documentProvider?: KycDocumentProvider;
  faceVerificationProvider?: FaceVerificationProviderName;
  verification?: Partial<KycVerification>;
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
        ...options.verification,
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
    values: {
      ocrMinimumConfidence: 0.8,
      faceMinimumSimilarity: 0.72,
      documentProvider: options.documentProvider ?? KYC_DOCUMENT_PROVIDER.LOCAL,
      faceVerificationProvider:
        options.faceVerificationProvider ?? FACE_VERIFICATION_PROVIDER.LOCAL,
    },
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

describe("KycProcessingWorker remote consent guard", () => {
  it("terminates an external job without reading or transferring images when consent is absent", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const extract = jest.fn();
    const faceVerify = jest.fn();
    const { worker, transaction } = createWorker(fileStorage, extract, {
      documentProvider: KYC_DOCUMENT_PROVIDER.HUGGING_FACE,
      faceVerify,
    });

    await worker["processJob"](createJob());

    expect(fileStorage.read).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(faceVerify).not.toHaveBeenCalled();
    expect(transaction.kycProcessingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.NEEDS_REVIEW,
          rejectionCode: KYC_PROCESSING_FAILURE.REMOTE_BIOMETRIC_CONSENT_REQUIRED,
        }),
      }),
    );
  });

  it("guards a remote face-service job before reading images when consent is absent", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const extract = jest.fn();
    const faceVerify = jest.fn();
    const { worker, transaction } = createWorker(fileStorage, extract, {
      faceVerificationProvider: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
      faceVerify,
    });

    await worker["processJob"](createJob());

    expect(fileStorage.read).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(faceVerify).not.toHaveBeenCalled();
    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.NEEDS_REVIEW,
          rejectionCode: KYC_PROCESSING_FAILURE.REMOTE_BIOMETRIC_CONSENT_REQUIRED,
        }),
      }),
    );
  });

  it("allows an external job with the current consent version and timestamp", async () => {
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
        bloodType: null,
        birthPlace: null,
        reasonCode: "DOCUMENT_UNSUPPORTED",
      },
      frontPresent: true,
      backPresent: true,
      audit: { provider: "huggingface", model: "test" },
    });
    const { worker } = createWorker(fileStorage, extract, {
      documentProvider: KYC_DOCUMENT_PROVIDER.HUGGING_FACE,
      verification: {
        consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
        consentAcceptedAt: new Date(),
      },
    });

    await worker["processJob"](createJob());

    expect(extract).toHaveBeenCalledTimes(1);
  });
});

describe("KycProcessingWorker expired history cleanup", () => {
  it("removes private objects before deleting the expired terminal row", async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const worker = new KycProcessingWorker(
      { kycVerification: { findMany: jest.fn().mockResolvedValue([{ id: "expired-id", images: [{ storageKey: "owner/expired/front/file.jpg" }] }]), deleteMany } } as unknown as PrismaService,
      { values: {} } as AppConfigService,
      { remove } as unknown as FileStorage,
      { audit: { provider: "test", model: "test" }, extract: jest.fn() },
      { verify: jest.fn() },
    );

    await worker.cleanupExpiredHistory();

    expect(remove).toHaveBeenCalledWith("owner/expired/front/file.jpg");
    expect(deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "expired-id" }) }));
  });

  it("keeps the database row for a later idempotent retry when object removal fails", async () => {
    const remove = jest.fn().mockRejectedValue(new Error("temporary storage failure"));
    const deleteMany = jest.fn();
    const worker = new KycProcessingWorker(
      { kycVerification: { findMany: jest.fn().mockResolvedValue([{ id: "expired-id", images: [{ storageKey: "owner/expired/front/file.jpg" }] }]), deleteMany } } as unknown as PrismaService,
      { values: {} } as AppConfigService,
      { remove } as unknown as FileStorage,
      { audit: { provider: "test", model: "test" }, extract: jest.fn() },
      { verify: jest.fn() },
    );

    await worker.cleanupExpiredHistory();

    expect(deleteMany).not.toHaveBeenCalled();
  });
});

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
    Object.defineProperty(worker, "logger", { value: { log: jest.fn(), warn: loggerWarn } });

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
        providerCode: GEMINI_DOCUMENT_EXTRACTION_FAILURE.REQUEST_QUOTA_EXHAUSTED,
      }),
    );
  });

  it("logs only typed provider diagnostics for an HTTP document-provider failure", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker } = createWorker(
      fileStorage,
      jest.fn().mockRejectedValue(
        new HuggingFaceDocumentExtractionError(
          HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
          401,
        ),
      ),
    );
    const loggerWarn = jest.fn();
    Object.defineProperty(worker, "logger", { value: { log: jest.fn(), warn: loggerWarn } });

    await worker["processJob"](createJob());

    const logLine = loggerWarn.mock.calls[0]?.[0] as string;
    expect(logLine).toBe(
      JSON.stringify({
        event: "kyc_processing_stage_failed",
        stage: "document-provider",
        code: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_FAILED,
        jobId: "job-opaque-id",
        verificationId: "verification-opaque-id",
        providerCode: HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
        providerHttpStatus: 401,
      }),
    );
    expect(logLine).not.toContain("sensitive provider body");
    expect(logLine).not.toContain("test-huggingface-token");
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
      bloodType: "O+",
      birthPlace: "Bogotá",
      reasonCode: "DOCUMENT_PARSED",
    },
    frontPresent: true,
    backPresent: true,
    audit: { provider: "test", model: "test" },
  };

  const LOCAL_INCOMPLETE_EXTRACTION = {
    ...VALID_EXTRACTION,
    parsedDocument: {
      ...VALID_EXTRACTION.parsedDocument,
      fullName: null,
      birthDate: null,
    },
    audit: { provider: "local", model: "tesseract-spa" },
  };

  it("routes a local incomplete document profile to review before face verification", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn();
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue(LOCAL_INCOMPLETE_EXTRACTION),
      { images: FULL_COVERAGE_IMAGES, faceVerify },
    );

    await worker["processJob"](createJob());

    expect(faceVerify).not.toHaveBeenCalled();
    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.NEEDS_REVIEW,
          rejectionCode: "INCOMPLETE_DOCUMENT_PROFILE",
          documentType: "COLOMBIAN_CEDULA",
          documentNumber: "12345678",
          documentFullName: null,
          documentBirthDate: null,
          documentBloodType: "O+",
          documentBirthPlace: "Bogotá",
          faceDistance: null,
          faceSimilarity: null,
        }),
      }),
    );
  });

  it("fails closed and keeps dynamic document reasons out of persistence and logs", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue({
        ...VALID_EXTRACTION,
        parsedDocument: {
          ...VALID_EXTRACTION.parsedDocument,
          reasonCode: "DOCUMENT_NUMBER_12345678",
        },
      }),
      { images: FULL_COVERAGE_IMAGES },
    );
    const loggerWarn = jest.fn();
    const loggerLog = jest.fn();
    Object.defineProperty(worker, "logger", { value: { warn: loggerWarn, log: loggerLog } });

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.PROCESSING_FAILED,
          rejectionCode: KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_FAILED,
        }),
      }),
    );

    const logs = JSON.stringify([...loggerWarn.mock.calls, ...loggerLog.mock.calls]);
    expect(logs).toContain(KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_FAILED);
    for (const pii of ["12345678", "PEPITA PEREZ", "1990-05-15", "O+", "Bogotá"]) {
      expect(logs).not.toContain(pii);
    }
  });

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
          documentBloodType: "O+",
          documentBirthPlace: "Bogotá",
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
          documentBloodType: "O+",
          documentBirthPlace: "Bogotá",
          documentType: "COLOMBIAN_CEDULA",
          documentNumberHash: null,
          faceDistance: null,
          faceSimilarity: null,
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
          documentBloodType: "O+",
          documentBirthPlace: "Bogotá",
          documentType: "COLOMBIAN_CEDULA",
          documentNumberHash: null,
          faceDistance: null,
          faceSimilarity: null,
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

  it("fails closed without persisting a similarity for an inconsistent face result", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockResolvedValue({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0.1,
      similarity: 0.9,
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
          status: KYC_STATUS.NEEDS_REVIEW,
          rejectionCode: "FACE_CAPTURE_INVALID_RESPONSE",
          faceDistance: null,
          faceSimilarity: null,
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
        bloodType: null,
        birthPlace: null,
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
          documentBloodType: null,
          documentBirthPlace: null,
          documentType: null,
          documentNumberHash: null,
        }),
      }),
    );
  });

  it("processes an explicit non-Colombian reject before incomplete coverage", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const extract = jest.fn().mockResolvedValue({
      confidence: 0.95,
      parsedDocument: {
        outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
        documentType: "PASSPORT",
        documentNumber: null,
        fullName: null,
        birthDate: null,
        issueDate: null,
        sex: null,
        height: null,
        bloodType: null,
        birthPlace: null,
        reasonCode: "DOCUMENT_TYPE_NOT_RECOGNIZED",
      },
      frontPresent: false,
      backPresent: false,
      audit: { provider: "test", model: "test" },
    });
    const { worker, transaction } = createWorker(fileStorage, extract, {
      images: [
        { kind: "DOCUMENT", side: "FRONT", storageKey: "document-front-key" },
        { kind: "SELFIE", side: null, storageKey: "selfie-key" },
      ],
    });

    await worker["processJob"](createJob());

    expect(transaction.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: KYC_STATUS.REJECTED,
          rejectionCode: "DOCUMENT_TYPE_NOT_RECOGNIZED",
          documentType: null,
          documentCheckResult: DOCUMENT_PARSE_OUTCOME.REJECT,
        }),
      }),
    );
  });

  it("logs the reason code when a document outcome completes processing", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker } = createWorker(fileStorage, jest.fn().mockResolvedValue({
      ...VALID_EXTRACTION,
      parsedDocument: {
        ...VALID_EXTRACTION.parsedDocument,
        outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
        reasonCode: "DOCUMENT_UNSUPPORTED",
        documentType: null,
        documentNumber: null,
        fullName: null,
        birthDate: null,
        issueDate: null,
        sex: null,
        height: null,
      },
    }), {
      images: FULL_COVERAGE_IMAGES,
    });
    const loggerLog = jest.fn();
    Object.defineProperty(worker, "logger", { value: { log: loggerLog } });

    await worker["processJob"](createJob());

    expect(loggerLog).toHaveBeenCalledWith(
      JSON.stringify({
        event: "kyc_processing_completed",
        jobId: "job-opaque-id",
        verificationId: "verification-opaque-id",
        status: KYC_STATUS.REJECTED,
        reasonCode: "DOCUMENT_UNSUPPORTED",
        hasFaceResult: false,
      }),
    );
  });

  it("logs a face result when processing reaches face verification", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const faceVerify = jest.fn().mockResolvedValue({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0.1,
      similarity: 0.9,
      accepted: true,
    });
    const { worker } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue(VALID_EXTRACTION),
      { images: FULL_COVERAGE_IMAGES, faceVerify },
    );
    const loggerLog = jest.fn();
    Object.defineProperty(worker, "logger", { value: { log: loggerLog } });

    await worker["processJob"](createJob());

    expect(faceVerify).toHaveBeenCalledTimes(1);
    expect(loggerLog).toHaveBeenCalledWith(
      JSON.stringify({
        event: "kyc_processing_completed",
        jobId: "job-opaque-id",
        verificationId: "verification-opaque-id",
        status: KYC_STATUS.APPROVED,
        reasonCode: "KYC_APPROVED",
        hasFaceResult: true,
      }),
    );
  });

  it("does not log completion when outcome persistence fails", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue({
        ...VALID_EXTRACTION,
        parsedDocument: {
          ...VALID_EXTRACTION.parsedDocument,
          outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
          reasonCode: "DOCUMENT_UNSUPPORTED",
        },
      }),
      { images: FULL_COVERAGE_IMAGES },
    );
    transaction.kycVerification.updateMany.mockRejectedValueOnce(new Error("outcome persistence failure"));
    const loggerLog = jest.fn();
    Object.defineProperty(worker, "logger", { value: { log: loggerLog } });

    await expect(worker["processJob"](createJob())).rejects.toThrow("outcome persistence failure");

    expect(loggerLog).not.toHaveBeenCalled();
  });

  it("does not log completion when the job claim is lost", async () => {
    const fileStorage = { read: jest.fn().mockResolvedValue(Buffer.from("image")) } as unknown as FileStorage;
    const { worker, transaction } = createWorker(
      fileStorage,
      jest.fn().mockResolvedValue({
        ...VALID_EXTRACTION,
        parsedDocument: {
          ...VALID_EXTRACTION.parsedDocument,
          outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
          reasonCode: "DOCUMENT_UNSUPPORTED",
        },
      }),
      { images: FULL_COVERAGE_IMAGES },
    );
    transaction.kycProcessingJob.updateMany.mockResolvedValueOnce({ count: 0 });
    const loggerLog = jest.fn();
    Object.defineProperty(worker, "logger", { value: { log: loggerLog } });

    await worker["processJob"](createJob());

    expect(loggerLog).not.toHaveBeenCalled();
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
          documentBloodType: null,
          documentBirthPlace: null,
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
        bloodType: null,
        birthPlace: null,
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
          documentBloodType: null,
          documentBirthPlace: null,
        }),
      }),
    );
  });
});
