import {
  getDocumentImages,
  getKycRoute,
  getSelfieImage,
  isTerminalKycStatus,
} from "./kyc-flow";
import { APP_ROUTE } from "../navigation/routes";
import {
  DOCUMENT_SIDE,
  KYC_IMAGE_KIND,
  KYC_PROCESSING_FAILURE,
  KYC_STATUS,
  type KycImageMetadata,
  type KycVerification,
} from "../types/api";

function createVerification(
  status: KycVerification["status"],
  reasonCode: string | null = null,
): KycVerification {
  return {
    id: "verification-opaque-id",
    status,
    reasonCode,
    documentType: null,
    documentFullName: null,
    documentNumber: null,
    documentBirthDate: null,
    documentIssueDate: null,
    documentSex: null,
    documentHeight: null,
    documentBloodType: null,
    documentBirthPlace: null,
    documentNationality: null,
    documentCheckResult: null,
    faceSimilarity: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    images: [],
  };
}

function createImageMetadata(
  overrides: Partial<KycImageMetadata>,
): KycImageMetadata {
  return {
    id: "image-opaque-id",
    kind: KYC_IMAGE_KIND.DOCUMENT,
    side: DOCUMENT_SIDE.FRONT,
    mimeType: "image/jpeg",
    byteSize: 1024,
    width: 800,
    height: 600,
    uploadedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("KYC hydration flow", () => {
  it.each([
    KYC_STATUS.VALIDATING,
    KYC_STATUS.APPROVED,
    KYC_STATUS.REJECTED,
    KYC_STATUS.NEEDS_REVIEW,
    KYC_STATUS.PROCESSING_FAILED,
  ])("restores %s at the persisted result screen", (status) => {
    expect(getKycRoute(createVerification(status))).toBe(APP_ROUTE.KYC_PROCESSING_RESULT);
  });

  it("marks processing failure as terminal without exposing evidence details", () => {
    expect(isTerminalKycStatus(KYC_STATUS.PROCESSING_FAILED)).toBe(true);
  });

  it("hydrates a quota exhaustion result at the terminal result screen", () => {
    const verification = createVerification(
      KYC_STATUS.PROCESSING_FAILED,
      KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED,
    );

    expect(getKycRoute(verification)).toBe(APP_ROUTE.KYC_PROCESSING_RESULT);
    expect(isTerminalKycStatus(verification.status)).toBe(true);
  });

  it("uses safe evidence metadata to resume document capture", () => {
    const verification = createVerification(KYC_STATUS.DOCUMENT_UPLOADED);
    verification.images = [
      createImageMetadata({ id: "document-front-id" }),
    ];

    expect(getKycRoute(verification)).toBe(APP_ROUTE.DOCUMENT_SCAN);
  });
});

describe("evidence selectors for the digital cédula", () => {
  it("orders document evidence as FRONT then BACK by default", () => {
    const front = createImageMetadata({ id: "document-front-id" });
    const back = createImageMetadata({
      id: "document-back-id",
      side: DOCUMENT_SIDE.BACK,
    });

    expect(getDocumentImages([back, front])).toEqual([front, back]);
    expect(getDocumentImages([])).toEqual([]);
  });

  it("prefers a single COMBINED document image over separate sides", () => {
    const front = createImageMetadata({ id: "document-front-id" });
    const back = createImageMetadata({
      id: "document-back-id",
      side: DOCUMENT_SIDE.BACK,
    });
    const combined = createImageMetadata({
      id: "document-combined-id",
      side: DOCUMENT_SIDE.COMBINED,
    });

    expect(getDocumentImages([front, back, combined])).toEqual([combined]);
  });

  it("finds the selfie among the evidence", () => {
    const selfie = createImageMetadata({
      id: "selfie-id",
      kind: KYC_IMAGE_KIND.SELFIE,
      side: null,
    });
    const front = createImageMetadata({ id: "document-front-id" });

    expect(getSelfieImage([front, selfie])).toBe(selfie);
    expect(getSelfieImage([front])).toBeNull();
  });
});
