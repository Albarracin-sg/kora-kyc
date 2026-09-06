import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { KycImage, KycVerification } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import {
  AppConfigService,
  FACE_VERIFICATION_PROVIDER,
  KYC_DOCUMENT_PROVIDER,
} from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import { ImageNormalizationService } from "./image/image-normalization.service";
import { KYC_IMAGE_KIND, type KycImageKind } from "./domain/kyc-image-kind";
import {
  KYC_STATUS,
  assertKycTransition,
  type KycStatus,
} from "./domain/kyc-state";
import { DOCUMENT_SIDE, type DocumentSide } from "./domain/document-side";
import {
  hasCurrentRemoteBiometricConsent,
  REMOTE_BIOMETRIC_CONSENT_VERSION,
} from "./domain/remote-biometric-consent";
import { KYC_TOKENS } from "./kyc.tokens";
import type { FileStorage } from "./storage/file-storage.port";

const ACTIVE_KYC_STATUSES = [
  KYC_STATUS.CREATED,
  KYC_STATUS.DOCUMENT_UPLOADED,
  KYC_STATUS.SELFIE_UPLOADED,
  KYC_STATUS.VALIDATING,
] as const;

const MEDIA_ID_PATTERN = /^c[a-z0-9]{24}$/;
// Mirrors the safe-key rule enforced by LocalFileStorage.
const SAFE_STORAGE_KEY_PATTERN = /^[a-zA-Z0-9/_-]+\.jpg$/;
const COLOMBIAN_CEDULA_DOCUMENT_TYPE = "COLOMBIAN_CEDULA";
const COLOMBIAN_NATIONALITY = "COLOMBIAN";
const HISTORY_CURSOR_VERSION = 1;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;
const TERMINAL_KYC_STATUSES = [
  KYC_STATUS.APPROVED,
  KYC_STATUS.REJECTED,
  KYC_STATUS.NEEDS_REVIEW,
  KYC_STATUS.PROCESSING_FAILED,
] as const;

export interface KycImageMetadata {
  id: string;
  kind: KycImageKind;
  side: DocumentSide | null;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  uploadedAt: Date;
}

export interface OwnedMedia {
  buffer: Buffer;
  mimeType: string;
  byteSize: number;
}

interface KycImageWithOwner extends KycImage {
  verification: { userId: string; status: string; expiresAt: Date | null };
}

export interface KycPublicVerification {
  id: string;
  status: KycStatus;
  reasonCode: string | null;
  documentType: string | null;
  documentFullName: string | null;
  documentNumber: string | null;
  documentBirthDate: Date | null;
  documentIssueDate: Date | null;
  documentSex: string | null;
  documentHeight: string | null;
  documentBloodType: string | null;
  documentBirthPlace: string | null;
  documentCheckResult: string | null;
  documentNationality: string | null;
  faceSimilarity: number | null;
  faceAiVerdict: string | null;
  faceAiSimilarityPercent: number | null;
  faceAiSummary: string | null;
  frontPresent: boolean;
  backPresent: boolean;
  createdAt: Date;
  updatedAt: Date;
  images: KycImageMetadata[];
}

export interface KycConsentRequirements {
  requiresExternalProcessing: boolean;
  consentVersion: string | null;
}

export interface KycHistoryListInput {
  cursor?: string;
  limit?: number;
}

export interface KycHistoryItem {
  id: string;
  status: KycStatus;
  finalizedAt: Date;
  faceSimilarity: number | null;
  faceAiVerdict: string | null;
  faceAiSimilarityPercent: number | null;
  faceAiSummary: string | null;
}

export interface KycHistoryList {
  items: KycHistoryItem[];
  nextCursor: string | null;
}

export interface KycHistoryImage {
  id: string;
  kind: KycImageKind;
  side: DocumentSide | null;
}

export interface KycHistoryDetail extends KycHistoryItem {
  reasonCode: string | null;
  documentFullName: string | null;
  documentNumber: string | null;
  documentBirthDate: Date | null;
  documentIssueDate: Date | null;
  documentSex: string | null;
  documentHeight: string | null;
  documentBloodType: string | null;
  documentBirthPlace: string | null;
  documentCheckResult: string | null;
  documentNationality: string | null;
  images: KycHistoryImage[];
}

interface KycHistoryCursor {
  version: number;
  finalizedAt: string;
  id: string;
}

interface HistoryRetentionFields {
  finalizedAt: Date | null;
  expiresAt: Date | null;
}

interface KycVerificationWithImages extends KycVerification {
  images: KycImage[];
}

@Injectable()
export class KycService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly imageNormalizationService: ImageNormalizationService,
    @Inject(KYC_TOKENS.FILE_STORAGE) private readonly fileStorage: FileStorage,
    private readonly configService: AppConfigService,
  ) {}

  async start(user: AuthenticatedUser, consentVersion?: string): Promise<KycPublicVerification> {
    this.assertRemoteVerificationConsent(consentVersion);
    const activeVerification = await this.prismaService.kycVerification.findFirst({
      where: {
        userId: user.id,
        status: { in: [...ACTIVE_KYC_STATUSES] },
      },
      include: { images: true },
      orderBy: { createdAt: "desc" },
    });

    if (activeVerification) {
      if (
        this.requiresExternalProcessing() &&
        !hasCurrentRemoteBiometricConsent(activeVerification)
      ) {
        const updatedVerification = await this.prismaService.kycVerification.update({
          where: { id: activeVerification.id },
          data: {
            consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
            consentAcceptedAt: new Date(),
          },
          include: { images: true },
        });
        return this.toPublicVerification(updatedVerification);
      }
      return this.toPublicVerification(activeVerification);
    }

    const verification = await this.prismaService.kycVerification.create({
      data: this.requiresExternalProcessing()
        ? {
            userId: user.id,
            status: KYC_STATUS.CREATED,
            consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
            consentAcceptedAt: new Date(),
          }
        : { userId: user.id, status: KYC_STATUS.CREATED },
      include: { images: true },
    });

    return this.toPublicVerification(verification);
  }

  async uploadDocument(
    user: AuthenticatedUser,
    upload: Buffer,
    side: DocumentSide,
  ): Promise<KycPublicVerification> {
    return this.uploadImage(user, KYC_IMAGE_KIND.DOCUMENT, upload, side);
  }

  async uploadSelfie(user: AuthenticatedUser, upload: Buffer): Promise<KycPublicVerification> {
    return this.uploadImage(user, KYC_IMAGE_KIND.SELFIE, upload, null);
  }

  async verify(user: AuthenticatedUser): Promise<KycPublicVerification> {
    const verification = await this.findCurrentVerification(user.id);
    if (!verification) {
      throw new NotFoundException("Start a KYC verification before requesting validation");
    }

    this.assertVerificationHasRemoteBiometricConsent(verification);

    const currentStatus = verification.status as KycStatus;
    if (currentStatus === KYC_STATUS.VALIDATING) {
      return this.toPublicVerification(verification);
    }

    if (currentStatus !== KYC_STATUS.SELFIE_UPLOADED) {
      throw new ConflictException("A document and selfie must be uploaded before validation");
    }

    const hasDocument = verification.images.some((image) => image.kind === KYC_IMAGE_KIND.DOCUMENT);
    const hasSelfie = verification.images.some((image) => image.kind === KYC_IMAGE_KIND.SELFIE);
    if (!hasDocument || !hasSelfie) {
      throw new ConflictException("A document and selfie must be uploaded before validation");
    }

    assertKycTransition(currentStatus, KYC_STATUS.VALIDATING);
    try {
      await this.prismaService.$transaction(async (transaction) => {
        const transition = await transaction.kycVerification.updateMany({
          where: {
            id: verification.id,
            userId: user.id,
            status: KYC_STATUS.SELFIE_UPLOADED,
          },
          data: {
            status: KYC_STATUS.VALIDATING,
            rejectionCode: null,
          },
        });

        if (transition.count !== 1) {
          throw new ConflictException("The KYC verification changed while validation was requested");
        }

        await transaction.kycProcessingJob.upsert({
          where: { verificationId: verification.id },
          create: { verificationId: verification.id, status: "PENDING" },
          update: {
            status: "PENDING",
            lockedAt: null,
            lockToken: null,
            completedAt: null,
            failureCode: null,
          },
        });
      });
    } catch (error: unknown) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }

      const refreshedVerification = await this.findCurrentVerification(user.id);
      if (refreshedVerification?.status === KYC_STATUS.VALIDATING) {
        return this.toPublicVerification(refreshedVerification);
      }

      throw error;
    }

    const updatedVerification = await this.findCurrentVerification(user.id);
    if (!updatedVerification) {
      throw new NotFoundException("KYC verification is no longer available");
    }

    return this.toPublicVerification(updatedVerification);
  }

  async getCurrent(user: AuthenticatedUser): Promise<KycPublicVerification | null> {
    const verification = await this.findCurrentVerification(user.id);
    return verification ? this.toPublicVerification(verification) : null;
  }

  async listHistory(user: AuthenticatedUser, input: KycHistoryListInput): Promise<KycHistoryList> {
    const limit = this.parseHistoryLimit(input.limit);
    const cursor = input.cursor ? this.parseHistoryCursor(input.cursor) : null;
    const now = new Date();
    const where = {
      userId: user.id,
      status: { in: [...TERMINAL_KYC_STATUSES] },
      finalizedAt: { not: null },
      expiresAt: { gt: now },
      ...(cursor
        ? {
            OR: [
              { finalizedAt: { lt: new Date(cursor.finalizedAt) } },
              { finalizedAt: new Date(cursor.finalizedAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prismaService.kycVerification.findMany({
      where,
      orderBy: [{ finalizedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        status: true,
        finalizedAt: true,
        faceSimilarity: true,
        faceAiVerdict: true,
        faceAiSimilarityPercent: true,
        faceAiSummary: true,
      },
    } as never);
    const page = rows.slice(0, limit) as unknown as Array<{
      id: string;
      status: KycStatus;
      finalizedAt: Date | null;
      faceSimilarity: number | null;
      faceAiVerdict: string | null;
      faceAiSimilarityPercent: number | null;
      faceAiSummary: string | null;
    }>;
    const items = page.map((row) => this.toHistoryItem(row));
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && lastItem
          ? this.createHistoryCursor(lastItem.finalizedAt, lastItem.id)
          : null,
    };
  }

  async getHistoryDetail(user: AuthenticatedUser, verificationId: string): Promise<KycHistoryDetail> {
    const row = await this.prismaService.kycVerification.findFirst({
      where: { id: verificationId },
      select: {
        id: true, userId: true, status: true, rejectionCode: true, documentType: true,
        documentFullName: true, documentNumber: true, documentBirthDate: true,
        documentIssueDate: true, documentSex: true, documentHeight: true,
         documentBloodType: true, documentBirthPlace: true, documentCheckResult: true,
         faceSimilarity: true, faceAiVerdict: true, faceAiSimilarityPercent: true,
         faceAiSummary: true, finalizedAt: true, expiresAt: true,
        images: { select: { id: true, kind: true, side: true } },
      },
    } as never) as (Record<string, unknown> & HistoryRetentionFields) | null;
    if (!row) throw new NotFoundException("KYC history entry not found");
    if (row.userId !== user.id) throw new ForbiddenException("KYC history entry is not available to this user");
    if (!this.isAvailableHistoryRow(row)) throw new NotFoundException("KYC history entry not found");

    return {
      ...this.toHistoryItem(row as never),
      reasonCode: typeof row.rejectionCode === "string" ? row.rejectionCode : null,
      documentFullName: this.stringOrNull(row.documentFullName),
      documentNumber: this.stringOrNull(row.documentNumber),
      documentBirthDate: this.dateOrNull(row.documentBirthDate),
      documentIssueDate: this.dateOrNull(row.documentIssueDate),
      documentSex: this.stringOrNull(row.documentSex),
      documentHeight: this.stringOrNull(row.documentHeight),
      documentBloodType: this.stringOrNull(row.documentBloodType),
      documentBirthPlace: this.stringOrNull(row.documentBirthPlace),
      documentCheckResult: this.stringOrNull(row.documentCheckResult),
      documentNationality: row.documentType === COLOMBIAN_CEDULA_DOCUMENT_TYPE ? COLOMBIAN_NATIONALITY : null,
      faceAiVerdict: this.stringOrNull(row.faceAiVerdict),
      faceAiSimilarityPercent: this.safeFaceAiSimilarity(row.faceAiSimilarityPercent),
      faceAiSummary: this.stringOrNull(row.faceAiSummary),
      images: Array.isArray(row.images)
        ? row.images.map((image) => this.toHistoryImage(image))
        : [],
    };
  }

  getConsentRequirements(): KycConsentRequirements {
    return {
      requiresExternalProcessing: this.requiresExternalProcessing(),
      consentVersion: this.requiresExternalProcessing() ? REMOTE_BIOMETRIC_CONSENT_VERSION : null,
    };
  }

  async readOwnedMedia(user: AuthenticatedUser, mediaId: string): Promise<OwnedMedia> {
    if (!MEDIA_ID_PATTERN.test(mediaId)) {
      throw new BadRequestException("Invalid media identifier");
    }

    const image = (await this.prismaService.kycImage.findUnique({
      where: { id: mediaId },
      include: { verification: { select: { userId: true, status: true, expiresAt: true } } },
    } as never)) as KycImageWithOwner | null;

    if (!image) {
      throw new NotFoundException("Media not found");
    }

    if (image.verification.userId !== user.id) {
      throw new ForbiddenException("Media is not available to this user");
    }
    if (
      !this.isTerminalStatus(image.verification.status) ||
      !image.verification.expiresAt ||
      image.verification.expiresAt <= new Date()
    ) {
      throw new NotFoundException("Media not found");
    }

    if (!SAFE_STORAGE_KEY_PATTERN.test(image.storageKey)) {
      throw new NotFoundException("Media not found");
    }

    const buffer = await this.fileStorage.read(image.storageKey);
    return {
      buffer,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
    };
  }

  private async uploadImage(
    user: AuthenticatedUser,
    kind: KycImageKind,
    upload: Buffer,
    side: DocumentSide | null,
  ): Promise<KycPublicVerification> {
    const verification = await this.findCurrentVerification(user.id);
    if (!verification) {
      throw new NotFoundException("Start a KYC verification before uploading an image");
    }

    this.assertVerificationHasRemoteBiometricConsent(verification);

    this.assertUploadAllowed(verification.status as KycStatus, kind);
    const normalizedImage = await this.imageNormalizationService.normalize(upload);
    const sidePath = side ? side.toLowerCase() : kind.toLowerCase();
    const storageKey = `${user.id}/${verification.id}/${sidePath}/${randomUUID()}.jpg`;
    let imageWasStored = false;

    try {
      await this.fileStorage.write({ key: storageKey, body: normalizedImage.buffer });
      imageWasStored = true;

      const nextStatus =
        kind === KYC_IMAGE_KIND.DOCUMENT
          ? KYC_STATUS.DOCUMENT_UPLOADED
          : KYC_STATUS.SELFIE_UPLOADED;

      const updatedVerification = await this.prismaService.$transaction(async (transaction) => {
        const current = await transaction.kycVerification.findFirst({
          where: { id: verification.id, userId: user.id },
          include: { images: true },
        });

        if (!current) {
          throw new NotFoundException("KYC verification is no longer available");
        }

        this.assertUploadAllowed(current.status as KycStatus, kind);

        if (kind === KYC_IMAGE_KIND.DOCUMENT) {
          this.assertDocumentSideAllowed(current.images, side!);
        }

        assertKycTransition(current.status as KycStatus, nextStatus);

        if (kind === KYC_IMAGE_KIND.DOCUMENT && side) {
          await transaction.kycImage.upsert({
            where: {
              verificationId_kind_side: {
                verificationId: current.id,
                kind,
                side,
              },
            },
            create: {
              verificationId: current.id,
              kind,
              side,
              storageKey,
              mimeType: normalizedImage.mimeType,
              byteSize: normalizedImage.byteSize,
              width: normalizedImage.width,
              height: normalizedImage.height,
              sha256: normalizedImage.sha256,
            },
            update: {
              storageKey,
              mimeType: normalizedImage.mimeType,
              byteSize: normalizedImage.byteSize,
              width: normalizedImage.width,
              height: normalizedImage.height,
              sha256: normalizedImage.sha256,
            },
          });
        } else {
          const existingSelfie = current.images.find(
            (image) => image.kind === kind && image.side === null,
          );
          await transaction.kycImage.upsert({
            where: { id: existingSelfie?.id ?? "" },
            create: {
              verificationId: current.id,
              kind,
              side: null,
              storageKey,
              mimeType: normalizedImage.mimeType,
              byteSize: normalizedImage.byteSize,
              width: normalizedImage.width,
              height: normalizedImage.height,
              sha256: normalizedImage.sha256,
            },
            update: {
              storageKey,
              mimeType: normalizedImage.mimeType,
              byteSize: normalizedImage.byteSize,
              width: normalizedImage.width,
              height: normalizedImage.height,
              sha256: normalizedImage.sha256,
            },
          });
        }

        const frontPresent = this.hasSide(current.images, DOCUMENT_SIDE.FRONT) || side === DOCUMENT_SIDE.FRONT;
        const backPresent = this.hasSide(current.images, DOCUMENT_SIDE.BACK) || side === DOCUMENT_SIDE.BACK;

        return transaction.kycVerification.update({
          where: { id: current.id },
          data: {
            status: nextStatus,
            frontPresent,
            backPresent,
          },
          include: { images: true },
        });
      });

      const previousImage = verification.images.find(
        (image) => image.kind === kind && image.side === side,
      );
      if (previousImage && previousImage.storageKey !== storageKey) {
        await this.removeStoredImageWithoutMaskingSuccess(previousImage.storageKey);
      }

      return this.toPublicVerification(updatedVerification);
    } catch (error: unknown) {
      if (imageWasStored) {
        await this.removeStoredImageWithoutMaskingSuccess(storageKey);
      }

      throw error;
    }
  }

  private assertDocumentSideAllowed(images: KycImage[], newSide: DocumentSide): void {
    if (newSide === DOCUMENT_SIDE.COMBINED) {
      const hasFront = images.some((image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === DOCUMENT_SIDE.FRONT);
      const hasBack = images.some((image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === DOCUMENT_SIDE.BACK);
      if (hasFront || hasBack) {
        throw new ConflictException(
          "Cannot upload COMBINED evidence when FRONT or BACK already exists. Remove the existing evidence first.",
        );
      }
    }

    if (newSide === DOCUMENT_SIDE.FRONT || newSide === DOCUMENT_SIDE.BACK) {
      const hasCombined = images.some(
        (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === DOCUMENT_SIDE.COMBINED,
      );
      if (hasCombined) {
        throw new ConflictException(
          `Cannot upload ${newSide} evidence when COMBINED already exists. Remove the COMBINED evidence first.`,
        );
      }
    }
  }

  private hasSide(images: KycImage[], side: DocumentSide): boolean {
    return images.some((image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === side);
  }

  private assertUploadAllowed(status: KycStatus, kind: KycImageKind): void {
    const documentUploadAllowed =
      kind === KYC_IMAGE_KIND.DOCUMENT &&
      (status === KYC_STATUS.CREATED || status === KYC_STATUS.DOCUMENT_UPLOADED);
    const selfieUploadAllowed =
      kind === KYC_IMAGE_KIND.SELFIE &&
      (status === KYC_STATUS.DOCUMENT_UPLOADED || status === KYC_STATUS.SELFIE_UPLOADED);

    if (!documentUploadAllowed && !selfieUploadAllowed) {
      throw new ConflictException("This image cannot be uploaded in the current KYC state");
    }
  }

  private isRemoteFaceService(): boolean {
    return this.configService.values.faceVerificationProvider === FACE_VERIFICATION_PROVIDER.FACE_SERVICE;
  }

  private requiresExternalProcessing(): boolean {
    return (
      this.configService.values.documentProvider !== KYC_DOCUMENT_PROVIDER.LOCAL ||
      this.isRemoteFaceService()
    );
  }

  private assertRemoteVerificationConsent(consentVersion: string | undefined): void {
    if (this.requiresExternalProcessing() && consentVersion !== REMOTE_BIOMETRIC_CONSENT_VERSION) {
      throw new ConflictException("Remote verification consent is required before starting KYC");
    }
  }

  private assertVerificationHasRemoteBiometricConsent(verification: KycVerification): void {
    if (this.requiresExternalProcessing() && !hasCurrentRemoteBiometricConsent(verification)) {
      throw new ConflictException("Remote verification consent is required before continuing KYC");
    }
  }

  private async findCurrentVerification(userId: string): Promise<KycVerificationWithImages | null> {
    return this.prismaService.kycVerification.findFirst({
      where: { userId },
      include: { images: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async removeStoredImageWithoutMaskingSuccess(storageKey: string): Promise<void> {
    try {
      await this.fileStorage.remove(storageKey);
    } catch {
      return;
    }
  }

  private parseHistoryLimit(value: number | undefined): number {
    if (value === undefined) return HISTORY_DEFAULT_LIMIT;
    if (!Number.isInteger(value) || value < 1 || value > HISTORY_MAX_LIMIT) {
      throw new BadRequestException("History limit must be an integer between 1 and 50");
    }
    return value;
  }

  private parseHistoryCursor(value: string): KycHistoryCursor {
    try {
      const decoded = Buffer.from(value, "base64url").toString("utf8");
      const cursor = JSON.parse(decoded) as unknown;
      if (
        typeof cursor !== "object" || cursor === null ||
        !("version" in cursor) || !("finalizedAt" in cursor) || !("id" in cursor) ||
        cursor.version !== HISTORY_CURSOR_VERSION || typeof cursor.finalizedAt !== "string" ||
        typeof cursor.id !== "string" || !cursor.id || !Number.isFinite(new Date(cursor.finalizedAt).getTime())
      ) throw new Error("Invalid cursor");
      return cursor as KycHistoryCursor;
    } catch {
      throw new BadRequestException("Invalid history cursor");
    }
  }

  private createHistoryCursor(finalizedAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ version: HISTORY_CURSOR_VERSION, finalizedAt: finalizedAt.toISOString(), id })).toString("base64url");
  }

  private toHistoryItem(row: {
    id: string;
    status: KycStatus;
    finalizedAt: Date | null;
    faceSimilarity: number | null;
    faceAiVerdict: string | null;
    faceAiSimilarityPercent: number | null;
    faceAiSummary: string | null;
  }): KycHistoryItem {
    if (!row.finalizedAt) throw new NotFoundException("KYC history entry not found");
    return {
      id: row.id,
      status: row.status,
      finalizedAt: row.finalizedAt,
      faceSimilarity: this.safeFaceSimilarity(row.faceSimilarity),
      faceAiVerdict: this.stringOrNull(row.faceAiVerdict),
      faceAiSimilarityPercent: this.safeFaceAiSimilarity(row.faceAiSimilarityPercent),
      faceAiSummary: this.stringOrNull(row.faceAiSummary),
    };
  }

  private toHistoryImage(image: unknown): KycHistoryImage {
    const value = image as { id: string; kind: KycImageKind; side: DocumentSide | null };
    return { id: value.id, kind: value.kind, side: value.side ?? null };
  }

  private safeFaceSimilarity(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1 ? value : null;
  }

  private safeFaceAiSimilarity(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }

  private isAvailableHistoryRow(row: Record<string, unknown> & HistoryRetentionFields): boolean {
    return this.isTerminalStatus(row.status) && row.finalizedAt instanceof Date && row.expiresAt instanceof Date && row.expiresAt > new Date();
  }

  private isTerminalStatus(status: unknown): status is (typeof TERMINAL_KYC_STATUSES)[number] {
    return typeof status === "string" && (TERMINAL_KYC_STATUSES as readonly string[]).includes(status);
  }

  private stringOrNull(value: unknown): string | null { return typeof value === "string" ? value : null; }
  private dateOrNull(value: unknown): Date | null { return value instanceof Date ? value : null; }

  private toPublicVerification(verification: KycVerificationWithImages): KycPublicVerification {
    return {
      id: verification.id,
      status: verification.status as KycStatus,
      reasonCode: verification.rejectionCode,
      documentType: verification.documentType,
      documentFullName: verification.documentFullName,
      documentNumber: verification.documentNumber,
      documentBirthDate: verification.documentBirthDate,
      documentIssueDate: verification.documentIssueDate,
      documentSex: verification.documentSex,
      documentHeight: verification.documentHeight,
      documentBloodType: verification.documentBloodType,
      documentBirthPlace: verification.documentBirthPlace,
      documentCheckResult: verification.documentCheckResult,
      documentNationality:
        verification.documentType === COLOMBIAN_CEDULA_DOCUMENT_TYPE
          ? COLOMBIAN_NATIONALITY
          : null,
      faceSimilarity: verification.faceSimilarity,
      faceAiVerdict: typeof verification.faceAiVerdict === "string" ? verification.faceAiVerdict : null,
      faceAiSimilarityPercent:
        typeof verification.faceAiSimilarityPercent === "number" &&
        Number.isFinite(verification.faceAiSimilarityPercent) &&
        verification.faceAiSimilarityPercent >= 0 &&
        verification.faceAiSimilarityPercent <= 100
          ? verification.faceAiSimilarityPercent
          : null,
      faceAiSummary: typeof verification.faceAiSummary === "string" ? verification.faceAiSummary : null,
      frontPresent: verification.frontPresent,
      backPresent: verification.backPresent,
      createdAt: verification.createdAt,
      updatedAt: verification.updatedAt,
      images: verification.images.map((image) => ({
        id: image.id,
        kind: image.kind as KycImageKind,
        side: (image.side as DocumentSide) ?? null,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
        uploadedAt: image.createdAt,
      })),
    };
  }
}
