import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { KycImage, KycProcessingJob, KycVerification } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  AppConfigService,
  FACE_VERIFICATION_PROVIDER,
  KYC_DOCUMENT_PROVIDER,
} from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import { DOCUMENT_SIDE, type DocumentSide } from "./domain/document-side";
import { KYC_IMAGE_KIND } from "./domain/kyc-image-kind";
import { KYC_STATUS, assertKycTransition, type KycStatus } from "./domain/kyc-state";
import {
  hasCurrentRemoteBiometricConsent,
} from "./domain/remote-biometric-consent";
import { KYC_TOKENS } from "./kyc.tokens";
import {
  DOCUMENT_PARSE_OUTCOME,
  type DocumentExtractionProvider,
  type DocumentExtractionResult,
  type DocumentParseOutcome,
  type LabeledDocumentImage,
} from "./providers/document-extraction.provider";
import {
  GEMINI_DOCUMENT_EXTRACTION_FAILURE,
  GeminiDocumentExtractionError,
} from "./providers/gemini-document-extraction.provider";
import { HuggingFaceDocumentExtractionError } from "./providers/hugging-face-document-extraction.provider";
import {
  ExternalDocumentProviderError,
  EXTERNAL_DOCUMENT_PROVIDER_FAILURE,
} from "./providers/external-document-provider.error";
import { isDocumentExtractionReasonCode } from "./providers/document-extraction-response";
import {
  FaceCaptureError,
  FaceModelUnavailableError,
} from "./providers/local-human-face-verification.provider";
import type { FaceVerificationProvider, FaceVerificationResult } from "./providers/face-verification.provider";
import type { FileStorage } from "./storage/file-storage.port";

const KYC_JOB_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export const KYC_PROCESSING_FAILURE = {
  DOCUMENT_STORAGE_READ_FAILED: "DOCUMENT_STORAGE_READ_FAILED",
  DOCUMENT_PROVIDER_FAILED: "DOCUMENT_PROVIDER_FAILED",
  DOCUMENT_PROVIDER_QUOTA_EXHAUSTED: "DOCUMENT_PROVIDER_QUOTA_EXHAUSTED",
  DOCUMENT_PROVIDER_RATE_LIMITED: "DOCUMENT_PROVIDER_RATE_LIMITED",
  FACE_STORAGE_READ_FAILED: "FACE_STORAGE_READ_FAILED",
  FACE_RUNTIME_FAILED: "FACE_RUNTIME_FAILED",
  FACE_MODEL_UNAVAILABLE: "FACE_MODEL_UNAVAILABLE",
  REMOTE_BIOMETRIC_CONSENT_REQUIRED: "REMOTE_BIOMETRIC_CONSENT_REQUIRED",
} as const;

type KycProcessingFailureCode =
  (typeof KYC_PROCESSING_FAILURE)[keyof typeof KYC_PROCESSING_FAILURE];

interface VerificationWithImages extends KycVerification {
  images: KycImage[];
}

interface ClaimedKycProcessingJob extends KycProcessingJob {
  lockToken: string;
}

interface ProviderFailureLogDetails {
  providerCode?: string;
  providerHttpStatus?: number;
}

interface KycTerminalOutcome {
  status: KycStatus;
  reasonCode: string;
  documentType: string | null;
  documentNumberHash: string | null;
  documentFullName: string | null;
  documentNumber: string | null;
  documentBirthDate: Date | null;
  documentIssueDate: Date | null;
  documentSex: string | null;
  documentHeight: string | null;
  documentBloodType: string | null;
  documentBirthPlace: string | null;
  documentCheckResult: DocumentParseOutcome | null;
  documentOcrConfidence: number | null;
  documentProvider: string | null;
  documentProviderModel: string | null;
  faceDistance: number | null;
  faceSimilarity: number | null;
}

class KycJobClaimLostError extends Error {
  constructor() {
    super("KYC job claim was lost before completion");
    this.name = "KycJobClaimLostError";
  }
}

const COLOMBIAN_CEDULA_DOCUMENT_TYPE = "COLOMBIAN_CEDULA";
const DOCUMENT_NUMBER_PATTERN = /^\d{6,10}$/;

function documentDateToDateOrNull(date: string | null): Date | null {
  if (!isValidIsoDate(date)) {
    return null;
  }

  return new Date(`${date}T00:00:00.000Z`);
}

function isValidIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasCompleteDocumentProfile(extraction: DocumentExtractionResult): boolean {
  const parsedDocument = extraction.parsedDocument;
  const fullName = parsedDocument.fullName?.trim() ?? "";

  return (
    parsedDocument.outcome === DOCUMENT_PARSE_OUTCOME.VALID &&
    parsedDocument.documentType === COLOMBIAN_CEDULA_DOCUMENT_TYPE &&
    parsedDocument.documentNumber !== null &&
    DOCUMENT_NUMBER_PATTERN.test(parsedDocument.documentNumber) &&
    fullName.length >= 3 &&
    /\p{L}/u.test(fullName) &&
    isValidIsoDate(parsedDocument.birthDate)
  );
}

@Injectable()
export class KycProcessingWorker {
  private isClaimLoopRunning = false;
  private readonly logger = new Logger(KycProcessingWorker.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: AppConfigService,
    @Inject(KYC_TOKENS.FILE_STORAGE) private readonly fileStorage: FileStorage,
    @Inject(KYC_TOKENS.DOCUMENT_EXTRACTION_PROVIDER)
    private readonly documentExtractionProvider: DocumentExtractionProvider,
    @Inject(KYC_TOKENS.FACE_VERIFICATION_PROVIDER)
    private readonly faceVerificationProvider: FaceVerificationProvider,
  ) {}

  @Interval(2_000)
  async processPendingJobs(): Promise<void> {
    if (this.isClaimLoopRunning) {
      return;
    }

    this.isClaimLoopRunning = true;
    try {
      const job = await this.claimNextJob();
      if (job) {
        await this.processJob(job);
      }
    } finally {
      this.isClaimLoopRunning = false;
    }
  }

  private async claimNextJob(): Promise<ClaimedKycProcessingJob | null> {
    const staleBefore = new Date(Date.now() - this.configService.values.jobLockTimeoutMs);
    await this.prismaService.kycProcessingJob.updateMany({
      where: {
        status: KYC_JOB_STATUS.RUNNING,
        lockedAt: { lt: staleBefore },
      },
      data: {
        status: KYC_JOB_STATUS.PENDING,
        lockedAt: null,
        lockToken: null,
      },
    });

    const candidate = await this.prismaService.kycProcessingJob.findFirst({
      where: { status: KYC_JOB_STATUS.PENDING },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) {
      return null;
    }

    const lockToken = randomUUID();
    const claim = await this.prismaService.kycProcessingJob.updateMany({
      where: { id: candidate.id, status: KYC_JOB_STATUS.PENDING },
      data: {
        status: KYC_JOB_STATUS.RUNNING,
        lockedAt: new Date(),
        lockToken,
        attempts: { increment: 1 },
      },
    });
    if (claim.count !== 1) {
      return null;
    }

    const claimedJob = await this.prismaService.kycProcessingJob.findUnique({
      where: { id: candidate.id },
    });
    if (!claimedJob?.lockToken) {
      return null;
    }

    return claimedJob as ClaimedKycProcessingJob;
  }

  private async processJob(job: ClaimedKycProcessingJob): Promise<void> {
    const verification = await this.prismaService.kycVerification.findUnique({
      where: { id: job.verificationId },
      include: { images: true },
    });

    if (!verification || verification.status !== KYC_STATUS.VALIDATING) {
      await this.markJobFailedWithoutVerification(job, "VERIFICATION_NOT_VALIDATING");
      return;
    }

    if (
      this.requiresExternalProcessing() &&
      !hasCurrentRemoteBiometricConsent(verification)
    ) {
      await this.complete(job, verification, this.remoteConsentRequiredOutcome());
      return;
    }

    const selfieImage = verification.images.find((image) => image.kind === KYC_IMAGE_KIND.SELFIE);
    const documentImages = verification.images.filter(
      (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT,
    );

    if (!selfieImage) {
      await this.complete(job, verification, this.processingFailedOutcome("SELFIE_IMAGE_MISSING"));
      return;
    }

    if (documentImages.length === 0) {
      await this.complete(job, verification, this.processingFailedOutcome("DOCUMENT_IMAGE_MISSING"));
      return;
    }

    let labeledImages: LabeledDocumentImage[];
    try {
      labeledImages = await this.collectLabeledDocumentImages(documentImages);
    } catch {
      await this.completeStageFailure(
        job,
        verification,
        "document-storage-read",
        KYC_PROCESSING_FAILURE.DOCUMENT_STORAGE_READ_FAILED,
      );
      return;
    }

    let selfieBuffer: Buffer;
    try {
      selfieBuffer = await this.fileStorage.read(selfieImage.storageKey);
    } catch {
      await this.completeStageFailure(
        job,
        verification,
        "face-storage-read",
        KYC_PROCESSING_FAILURE.FACE_STORAGE_READ_FAILED,
      );
      return;
    }

    let extractedDocument: DocumentExtractionResult;
    try {
      extractedDocument = await this.documentExtractionProvider.extract(labeledImages);
    } catch (error: unknown) {
      await this.completeStageFailure(
        job,
        verification,
        "document-provider",
        this.documentProviderFailureCode(error),
        this.documentProviderFailureLogDetails(error),
      );
      return;
    }

    if (!isDocumentExtractionReasonCode(extractedDocument.parsedDocument.reasonCode)) {
      await this.completeStageFailure(
        job,
        verification,
        "document-provider",
        KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_FAILED,
      );
      return;
    }

    if (extractedDocument.parsedDocument.outcome === DOCUMENT_PARSE_OUTCOME.REJECT) {
      const documentOutcome = this.evaluateDocument(extractedDocument);
      if (documentOutcome) {
        await this.complete(job, verification, documentOutcome);
        return;
      }
    }

    const coverageOutcome = this.evaluateCoverage(extractedDocument, documentImages);
    if (coverageOutcome) {
      await this.complete(job, verification, coverageOutcome);
      return;
    }

    const documentOutcome = this.evaluateDocument(extractedDocument);
    if (documentOutcome) {
      await this.complete(job, verification, documentOutcome);
      return;
    }

    if (!hasCompleteDocumentProfile(extractedDocument)) {
      await this.complete(job, verification, {
        status: KYC_STATUS.NEEDS_REVIEW,
        reasonCode: "INCOMPLETE_DOCUMENT_PROFILE",
        documentType: extractedDocument.parsedDocument.documentType,
        documentNumberHash: null,
        ...this.documentProfileFields(extractedDocument),
        documentOcrConfidence: extractedDocument.confidence,
        documentProvider: extractedDocument.audit.provider,
        documentProviderModel: extractedDocument.audit.model,
        faceDistance: null,
        faceSimilarity: null,
      });
      return;
    }

    let faceImageBuffer: Buffer | null;
    try {
      faceImageBuffer = await this.selectFaceImageBuffer(documentImages, extractedDocument);
    } catch {
      await this.completeStageFailure(
        job,
        verification,
        "face-storage-read",
        KYC_PROCESSING_FAILURE.FACE_STORAGE_READ_FAILED,
      );
      return;
    }
    if (!faceImageBuffer) {
      await this.complete(job, verification, this.processingFailedOutcome("FACE_IMAGE_UNAVAILABLE"));
      return;
    }

    try {
      const faceResult = await this.faceVerificationProvider.verify(faceImageBuffer, selfieBuffer);
      const faceOutcome = this.evaluateFace(faceResult, extractedDocument);
      await this.complete(job, verification, faceOutcome);
    } catch (error: unknown) {
      if (error instanceof FaceCaptureError) {
        await this.complete(job, verification, {
          status: KYC_STATUS.NEEDS_REVIEW,
          reasonCode: `FACE_CAPTURE_${error.code}`,
          documentType: null,
          documentNumberHash: null,
          ...this.documentProfileFields(extractedDocument),
          documentOcrConfidence: null,
          documentProvider: this.documentExtractionProvider.audit.provider,
          documentProviderModel: this.documentExtractionProvider.audit.model,
          faceDistance: null,
          faceSimilarity: null,
        });
        return;
      }

      if (error instanceof FaceModelUnavailableError) {
        await this.completeStageFailure(
          job,
          verification,
          "face-runtime",
          KYC_PROCESSING_FAILURE.FACE_MODEL_UNAVAILABLE,
        );
        return;
      }

      await this.completeStageFailure(
        job,
        verification,
        "face-runtime",
        KYC_PROCESSING_FAILURE.FACE_RUNTIME_FAILED,
      );
    }
  }

  private async completeStageFailure(
    job: ClaimedKycProcessingJob,
    verification: VerificationWithImages,
    stage: string,
    code: KycProcessingFailureCode,
    providerFailureLogDetails: ProviderFailureLogDetails = {},
  ): Promise<void> {
    this.logger.warn(
      JSON.stringify({
        event: "kyc_processing_stage_failed",
        stage,
        code,
        jobId: job.id,
        verificationId: verification.id,
        ...providerFailureLogDetails,
      }),
    );
    await this.complete(job, verification, this.processingFailedOutcome(code));
  }

  private documentProviderFailureCode(error: unknown): KycProcessingFailureCode {
    if (
      error instanceof GeminiDocumentExtractionError &&
      error.code === GEMINI_DOCUMENT_EXTRACTION_FAILURE.REQUEST_QUOTA_EXHAUSTED
    ) {
      return KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED;
    }

    if (
      error instanceof ExternalDocumentProviderError &&
      error.code === EXTERNAL_DOCUMENT_PROVIDER_FAILURE.RATE_LIMITED
    ) {
      return KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_RATE_LIMITED;
    }

    return KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_FAILED;
  }

  private documentProviderFailureLogDetails(error: unknown): ProviderFailureLogDetails {
    if (error instanceof HuggingFaceDocumentExtractionError) {
      return {
        providerCode: error.code,
        ...(typeof error.httpStatus === "number"
          ? { providerHttpStatus: error.httpStatus }
          : {}),
      };
    }

    if (error instanceof ExternalDocumentProviderError) {
      return {
        providerCode: error.code,
        ...(typeof error.httpStatus === "number"
          ? { providerHttpStatus: error.httpStatus }
          : {}),
      };
    }

    if (error instanceof GeminiDocumentExtractionError) {
      return { providerCode: error.code };
    }

    return {};
  }

  private async collectLabeledDocumentImages(
    documentImages: KycImage[],
  ): Promise<LabeledDocumentImage[]> {
    const labeledImages: LabeledDocumentImage[] = [];

    for (const image of documentImages) {
      const side = image.side as DocumentSide;
      if (!side) continue;

      const buffer = await this.fileStorage.read(image.storageKey);
      labeledImages.push({ side, buffer });
    }

    return labeledImages;
  }

  private async selectFaceImageBuffer(
    documentImages: KycImage[],
    extraction: DocumentExtractionResult,
  ): Promise<Buffer | null> {
    const frontImage = documentImages.find(
      (image) => image.side === DOCUMENT_SIDE.FRONT,
    );
    if (frontImage) {
      return this.fileStorage.read(frontImage.storageKey);
    }

    const combinedImage = documentImages.find(
      (image) => image.side === DOCUMENT_SIDE.COMBINED,
    );
    if (combinedImage && extraction.frontPresent && extraction.backPresent) {
      return this.fileStorage.read(combinedImage.storageKey);
    }

    return null;
  }

  private evaluateCoverage(
    extraction: DocumentExtractionResult,
    documentImages: KycImage[],
  ): KycTerminalOutcome | null {
    const hasCombined = documentImages.some(
      (image) => image.side === DOCUMENT_SIDE.COMBINED,
    );

    if (hasCombined) {
      if (!extraction.frontPresent || !extraction.backPresent) {
        return {
          status: KYC_STATUS.NEEDS_REVIEW,
          reasonCode: "COMBINED_IMAGE_INCOMPLETE_COVERAGE",
          documentType: extraction.parsedDocument.documentType,
          documentNumberHash: null,
          ...this.documentProfileFields(extraction),
          documentOcrConfidence: extraction.confidence,
          documentProvider: extraction.audit.provider,
          documentProviderModel: extraction.audit.model,
          faceDistance: null,
          faceSimilarity: null,
        };
      }
    }

    const hasFront = documentImages.some(
      (image) => image.side === DOCUMENT_SIDE.FRONT,
    );
    const hasBack = documentImages.some(
      (image) => image.side === DOCUMENT_SIDE.BACK,
    );

    if (hasFront && hasBack) {
      if (!extraction.frontPresent || !extraction.backPresent) {
        return {
          status: KYC_STATUS.NEEDS_REVIEW,
          reasonCode: "DOCUMENT_COVERAGE_MISMATCH",
          documentType: extraction.parsedDocument.documentType,
          documentNumberHash: null,
          ...this.documentProfileFields(extraction),
          documentOcrConfidence: extraction.confidence,
          documentProvider: extraction.audit.provider,
          documentProviderModel: extraction.audit.model,
          faceDistance: null,
          faceSimilarity: null,
        };
      }
    }

    if (hasFront && !hasBack && !hasCombined) {
      return {
        status: KYC_STATUS.NEEDS_REVIEW,
        reasonCode: "BACK_DOCUMENT_MISSING",
        documentType: extraction.parsedDocument.documentType,
        documentNumberHash: null,
        ...this.documentProfileFields(extraction),
        documentOcrConfidence: extraction.confidence,
        documentProvider: extraction.audit.provider,
        documentProviderModel: extraction.audit.model,
        faceDistance: null,
        faceSimilarity: null,
      };
    }

    if (hasBack && !hasFront && !hasCombined) {
      return {
        status: KYC_STATUS.NEEDS_REVIEW,
        reasonCode: "FRONT_DOCUMENT_MISSING",
        documentType: extraction.parsedDocument.documentType,
        documentNumberHash: null,
        ...this.documentProfileFields(extraction),
        documentOcrConfidence: extraction.confidence,
        documentProvider: extraction.audit.provider,
        documentProviderModel: extraction.audit.model,
        faceDistance: null,
        faceSimilarity: null,
      };
    }

    return null;
  }

  private evaluateDocument(extraction: DocumentExtractionResult): KycTerminalOutcome | null {
    if (extraction.parsedDocument.outcome === DOCUMENT_PARSE_OUTCOME.REJECT) {
      return {
        status: KYC_STATUS.REJECTED,
        reasonCode: extraction.parsedDocument.reasonCode,
        documentType: null,
        documentNumberHash: null,
        ...this.documentProfileFields(extraction),
        documentOcrConfidence: extraction.confidence,
        documentProvider: extraction.audit.provider,
        documentProviderModel: extraction.audit.model,
        faceDistance: null,
        faceSimilarity: null,
      };
    }

    if (extraction.confidence < this.configService.values.ocrMinimumConfidence) {
      return {
        status: KYC_STATUS.NEEDS_REVIEW,
        reasonCode: "OCR_CONFIDENCE_TOO_LOW",
        documentType: extraction.parsedDocument.documentType,
        documentNumberHash: null,
        ...this.documentProfileFields(extraction),
        documentOcrConfidence: extraction.confidence,
        documentProvider: extraction.audit.provider,
        documentProviderModel: extraction.audit.model,
        faceDistance: null,
        faceSimilarity: null,
      };
    }

    if (
      extraction.parsedDocument.outcome === DOCUMENT_PARSE_OUTCOME.REVIEW ||
      !extraction.parsedDocument.documentNumber
    ) {
      return {
        status: KYC_STATUS.NEEDS_REVIEW,
        reasonCode: extraction.parsedDocument.reasonCode,
        documentType: extraction.parsedDocument.documentType,
        documentNumberHash: null,
        ...this.documentProfileFields(extraction),
        documentOcrConfidence: extraction.confidence,
        documentProvider: extraction.audit.provider,
        documentProviderModel: extraction.audit.model,
        faceDistance: null,
        faceSimilarity: null,
      };
    }

    return null;
  }

  private evaluateFace(
    faceResult: FaceVerificationResult,
    extraction: DocumentExtractionResult,
  ): KycTerminalOutcome {
    const parsedDocument = extraction.parsedDocument;
    const documentNumber = parsedDocument.documentNumber;
    if (!documentNumber || !parsedDocument.documentType) {
      return this.processingFailedOutcome("DOCUMENT_PARSE_INVARIANT_FAILED");
    }

    const documentNumberHash = createHash("sha256")
      .update(`${this.configService.values.documentHashPepper}:${documentNumber}`)
      .digest("hex");

    return {
      status: faceResult.accepted ? KYC_STATUS.APPROVED : KYC_STATUS.REJECTED,
      reasonCode: faceResult.accepted ? "KYC_APPROVED" : "FACE_SIMILARITY_BELOW_THRESHOLD",
      documentType: parsedDocument.documentType,
      documentNumberHash,
      ...this.documentProfileFields(extraction),
      documentOcrConfidence: extraction.confidence,
      documentProvider: extraction.audit.provider,
      documentProviderModel: extraction.audit.model,
      faceDistance: faceResult.distance,
      faceSimilarity: faceResult.similarity,
    };
  }

  private processingFailedOutcome(reasonCode: string): KycTerminalOutcome {
    return {
      status: KYC_STATUS.PROCESSING_FAILED,
      reasonCode,
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
      documentProvider: this.documentExtractionProvider.audit.provider,
      documentProviderModel: this.documentExtractionProvider.audit.model,
      faceDistance: null,
      faceSimilarity: null,
    };
  }

  private remoteConsentRequiredOutcome(): KycTerminalOutcome {
    return {
      status: KYC_STATUS.NEEDS_REVIEW,
      reasonCode: KYC_PROCESSING_FAILURE.REMOTE_BIOMETRIC_CONSENT_REQUIRED,
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
    };
  }

  private requiresExternalProcessing(): boolean {
    return (
      this.configService.values.documentProvider === KYC_DOCUMENT_PROVIDER.GEMINI ||
      this.configService.values.documentProvider === KYC_DOCUMENT_PROVIDER.HUGGING_FACE ||
      this.configService.values.faceVerificationProvider === FACE_VERIFICATION_PROVIDER.FACE_SERVICE
    );
  }

  private documentProfileFields(
    extraction: DocumentExtractionResult,
  ): Pick<
    KycTerminalOutcome,
    | "documentFullName"
    | "documentNumber"
    | "documentBirthDate"
    | "documentIssueDate"
    | "documentSex"
    | "documentHeight"
    | "documentBloodType"
    | "documentBirthPlace"
    | "documentCheckResult"
  > {
    const parsedDocument = extraction.parsedDocument;
    if (parsedDocument.outcome === DOCUMENT_PARSE_OUTCOME.REJECT) {
      return {
        documentFullName: null,
        documentNumber: null,
        documentBirthDate: null,
        documentIssueDate: null,
        documentSex: null,
        documentHeight: null,
        documentBloodType: null,
        documentBirthPlace: null,
        documentCheckResult: parsedDocument.outcome,
      };
    }

    return {
      documentFullName: parsedDocument.fullName,
      documentNumber: parsedDocument.documentNumber,
      documentBirthDate: documentDateToDateOrNull(parsedDocument.birthDate),
      documentIssueDate: documentDateToDateOrNull(parsedDocument.issueDate),
      documentSex: parsedDocument.sex,
      documentHeight: parsedDocument.height,
      documentBloodType: parsedDocument.bloodType,
      documentBirthPlace: parsedDocument.birthPlace,
      documentCheckResult: parsedDocument.outcome,
    };
  }

  private async complete(
    job: ClaimedKycProcessingJob,
    verification: VerificationWithImages,
    outcome: KycTerminalOutcome,
  ): Promise<void> {
    assertKycTransition(verification.status as KycStatus, outcome.status);
    const jobStatus =
      outcome.status === KYC_STATUS.PROCESSING_FAILED
        ? KYC_JOB_STATUS.FAILED
        : KYC_JOB_STATUS.COMPLETED;

    try {
      await this.prismaService.$transaction(async (transaction) => {
        const jobCompletion = await transaction.kycProcessingJob.updateMany({
          where: {
            id: job.id,
            status: KYC_JOB_STATUS.RUNNING,
            lockToken: job.lockToken,
          },
          data: {
            status: jobStatus,
            lockedAt: null,
            lockToken: null,
            completedAt: new Date(),
            failureCode: outcome.status === KYC_STATUS.PROCESSING_FAILED ? outcome.reasonCode : null,
          },
        });
        if (jobCompletion.count !== 1) {
          throw new KycJobClaimLostError();
        }

        const verificationCompletion = await transaction.kycVerification.updateMany({
          where: { id: verification.id, status: KYC_STATUS.VALIDATING },
          data: {
            status: outcome.status,
            rejectionCode: outcome.reasonCode,
            documentType: outcome.documentType,
            documentNumberHash: outcome.documentNumberHash,
            documentFullName: outcome.documentFullName,
            documentNumber: outcome.documentNumber,
            documentBirthDate: outcome.documentBirthDate,
            documentIssueDate: outcome.documentIssueDate,
            documentSex: outcome.documentSex,
            documentHeight: outcome.documentHeight,
            documentBloodType: outcome.documentBloodType,
            documentBirthPlace: outcome.documentBirthPlace,
            documentCheckResult: outcome.documentCheckResult,
            documentOcrConfidence: outcome.documentOcrConfidence,
            documentProvider: outcome.documentProvider,
            documentProviderModel: outcome.documentProviderModel,
            faceDistance: outcome.faceDistance,
            faceSimilarity: outcome.faceSimilarity,
          },
        });
        if (verificationCompletion.count !== 1) {
          throw new KycJobClaimLostError();
        }
      });
    } catch (error: unknown) {
      if (error instanceof KycJobClaimLostError) {
        return;
      }

      throw error;
    }

    this.logger.log(
      JSON.stringify({
        event: "kyc_processing_completed",
        jobId: job.id,
        verificationId: verification.id,
        status: outcome.status,
        reasonCode: outcome.reasonCode,
        hasFaceResult: outcome.faceSimilarity !== null,
      }),
    );
  }

  private async markJobFailedWithoutVerification(
    job: ClaimedKycProcessingJob,
    reasonCode: string,
  ): Promise<void> {
    await this.prismaService.kycProcessingJob.updateMany({
      where: {
        id: job.id,
        status: KYC_JOB_STATUS.RUNNING,
        lockToken: job.lockToken,
      },
      data: {
        status: KYC_JOB_STATUS.FAILED,
        lockedAt: null,
        lockToken: null,
        completedAt: new Date(),
        failureCode: reasonCode,
      },
    });
  }
}
