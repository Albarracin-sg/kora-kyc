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

const KYC_STATUS_TRANSITIONS: Record<KycStatus, readonly KycStatus[]> = {
  [KYC_STATUS.CREATED]: [KYC_STATUS.DOCUMENT_UPLOADED],
  [KYC_STATUS.DOCUMENT_UPLOADED]: [KYC_STATUS.DOCUMENT_UPLOADED, KYC_STATUS.SELFIE_UPLOADED],
  [KYC_STATUS.SELFIE_UPLOADED]: [KYC_STATUS.SELFIE_UPLOADED, KYC_STATUS.VALIDATING],
  [KYC_STATUS.VALIDATING]: [
    KYC_STATUS.APPROVED,
    KYC_STATUS.REJECTED,
    KYC_STATUS.NEEDS_REVIEW,
    KYC_STATUS.PROCESSING_FAILED,
  ],
  [KYC_STATUS.APPROVED]: [],
  [KYC_STATUS.REJECTED]: [],
  [KYC_STATUS.NEEDS_REVIEW]: [],
  [KYC_STATUS.PROCESSING_FAILED]: [],
};

export function canTransitionKycStatus(from: KycStatus, to: KycStatus): boolean {
  return KYC_STATUS_TRANSITIONS[from].includes(to);
}

export function assertKycTransition(from: KycStatus, to: KycStatus): void {
  if (!canTransitionKycStatus(from, to)) {
    throw new Error(`Invalid KYC status transition: ${from} -> ${to}`);
  }
}

export function isTerminalKycStatus(status: KycStatus): boolean {
  return KYC_STATUS_TRANSITIONS[status].length === 0;
}
