export const KYC_STATUS = {
  CREATED: "CREATED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  SELFIE_UPLOADED: "SELFIE_UPLOADED",
  VALIDATING: "VALIDATING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  PROCESSING_FAILED: "PROCESSING_FAILED",
} as const;

export type KycStatus = (typeof KYC_STATUS)[keyof typeof KYC_STATUS];

export type FaceAiVerdict = "same_person" | "different_person" | "needs_review";

export const KYC_PROCESSING_FAILURE = {
  DOCUMENT_PROVIDER_QUOTA_EXHAUSTED: "DOCUMENT_PROVIDER_QUOTA_EXHAUSTED",
} as const;

export type KycProcessingFailure =
  (typeof KYC_PROCESSING_FAILURE)[keyof typeof KYC_PROCESSING_FAILURE];

export const KYC_FACE_CAPTURE_FAILURE = {
  QUALITY_DOCUMENT_NO_FACE: "FACE_CAPTURE_QUALITY_DOCUMENT_NO_FACE",
  QUALITY_DOCUMENT_FACE_RESOLUTION_TOO_SMALL:
    "FACE_CAPTURE_QUALITY_DOCUMENT_FACE_RESOLUTION_TOO_SMALL",
  QUALITY_DOCUMENT_BLURRY: "FACE_CAPTURE_QUALITY_DOCUMENT_BLURRY",
  QUALITY_DOCUMENT_ERROR: "FACE_CAPTURE_QUALITY_DOCUMENT_ERROR",
  QUALITY_SELFIE_NO_FACE: "FACE_CAPTURE_QUALITY_SELFIE_NO_FACE",
  QUALITY_SELFIE_FACE_RESOLUTION_TOO_SMALL:
    "FACE_CAPTURE_QUALITY_SELFIE_FACE_RESOLUTION_TOO_SMALL",
  QUALITY_SELFIE_BLURRY: "FACE_CAPTURE_QUALITY_SELFIE_BLURRY",
  QUALITY_SELFIE_ERROR: "FACE_CAPTURE_QUALITY_SELFIE_ERROR",
} as const;

export type KycFaceCaptureFailure =
  (typeof KYC_FACE_CAPTURE_FAILURE)[keyof typeof KYC_FACE_CAPTURE_FAILURE];

export const KYC_FACE_COMPARISON_REASON = {
  APPROVED: "KYC_APPROVED",
  BELOW_THRESHOLD: "FACE_SIMILARITY_BELOW_THRESHOLD",
} as const;

export const KYC_IMAGE_KIND = {
  DOCUMENT: "DOCUMENT",
  SELFIE: "SELFIE",
} as const;

export type KycImageKind = (typeof KYC_IMAGE_KIND)[keyof typeof KYC_IMAGE_KIND];

export const DOCUMENT_SIDE = {
  FRONT: "FRONT",
  BACK: "BACK",
  COMBINED: "COMBINED",
} as const;

export type DocumentSide = (typeof DOCUMENT_SIDE)[keyof typeof DOCUMENT_SIDE];

export const REMOTE_BIOMETRIC_CONSENT_VERSION = "remote-verification-v2";

export interface KycConsentRequirements {
  requiresExternalProcessing: boolean;
  consentVersion: string | null;
}

export const DOCUMENT_CHECK_RESULT = {
  VALID: "VALID",
  REVIEW: "REVIEW",
  REJECT: "REJECT",
} as const;

export type DocumentCheckResult =
  (typeof DOCUMENT_CHECK_RESULT)[keyof typeof DOCUMENT_CHECK_RESULT];

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile extends AuthenticatedUser {
  createdAt: string;
}

export interface AuthResponse extends AuthTokens {
  user: AuthenticatedUser;
}

export interface KycImageMetadata {
  id: string;
  kind: KycImageKind;
  side: DocumentSide | null;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  uploadedAt: string;
}

export interface KycVerification {
  id: string;
  status: KycStatus;
  reasonCode: string | null;
  documentType: string | null;
  documentFullName: string | null;
  documentNumber: string | null;
  documentBirthDate: string | null;
  documentIssueDate: string | null;
  documentSex: string | null;
  documentHeight: string | null;
  documentBloodType: string | null;
  documentBirthPlace: string | null;
  documentCheckResult: DocumentCheckResult | null;
  documentNationality: string | null;
  faceSimilarity: number | null;
  faceAiVerdict?: FaceAiVerdict | null;
  faceAiSimilarityPercent?: number | null;
  faceAiSummary?: string | null;
  createdAt: string;
  updatedAt: string;
  images: KycImageMetadata[];
}

export interface KycHistoryItem {
  id: string;
  status: KycStatus;
  finalizedAt: string;
  faceSimilarity: number | null;
  faceAiVerdict?: FaceAiVerdict | null;
  faceAiSimilarityPercent?: number | null;
  faceAiSummary?: string | null;
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
  documentBirthDate: string | null;
  documentIssueDate: string | null;
  documentSex: string | null;
  documentHeight: string | null;
  documentBloodType: string | null;
  documentBirthPlace: string | null;
  documentCheckResult: DocumentCheckResult | null;
  documentNationality: string | null;
  images: KycHistoryImage[];
}

export interface ApiErrorPayload {
  message: string | string[] | undefined;
}
