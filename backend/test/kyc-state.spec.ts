import {
  KYC_STATUS,
  assertKycTransition,
  canTransitionKycStatus,
} from "../src/kyc/domain/kyc-state";

describe("KYC state transitions", () => {
  it("allows the explicit happy-path transitions", () => {
    expect(canTransitionKycStatus(KYC_STATUS.CREATED, KYC_STATUS.DOCUMENT_UPLOADED)).toBe(true);
    expect(canTransitionKycStatus(KYC_STATUS.DOCUMENT_UPLOADED, KYC_STATUS.SELFIE_UPLOADED)).toBe(true);
    expect(canTransitionKycStatus(KYC_STATUS.SELFIE_UPLOADED, KYC_STATUS.VALIDATING)).toBe(true);
    expect(canTransitionKycStatus(KYC_STATUS.VALIDATING, KYC_STATUS.APPROVED)).toBe(true);
  });

  it("rejects attempts to approve before validation", () => {
    expect(canTransitionKycStatus(KYC_STATUS.DOCUMENT_UPLOADED, KYC_STATUS.APPROVED)).toBe(false);
    expect(() => assertKycTransition(KYC_STATUS.DOCUMENT_UPLOADED, KYC_STATUS.APPROVED)).toThrow(
      "Invalid KYC status transition",
    );
  });

  it("makes all terminal states final", () => {
    expect(canTransitionKycStatus(KYC_STATUS.APPROVED, KYC_STATUS.CREATED)).toBe(false);
    expect(canTransitionKycStatus(KYC_STATUS.REJECTED, KYC_STATUS.VALIDATING)).toBe(false);
    expect(canTransitionKycStatus(KYC_STATUS.NEEDS_REVIEW, KYC_STATUS.APPROVED)).toBe(false);
    expect(canTransitionKycStatus(KYC_STATUS.PROCESSING_FAILED, KYC_STATUS.VALIDATING)).toBe(false);
  });
});
