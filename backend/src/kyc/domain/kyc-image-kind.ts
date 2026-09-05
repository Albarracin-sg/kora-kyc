export const KYC_IMAGE_KIND = {
  DOCUMENT: "DOCUMENT",
  SELFIE: "SELFIE",
} as const;

export type KycImageKind = (typeof KYC_IMAGE_KIND)[keyof typeof KYC_IMAGE_KIND];
