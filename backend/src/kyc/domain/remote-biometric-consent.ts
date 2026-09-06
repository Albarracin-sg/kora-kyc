export const REMOTE_BIOMETRIC_CONSENT_VERSION = "remote-verification-v2";

export interface RemoteBiometricConsentFields {
  consentVersion: string | null;
  consentAcceptedAt: Date | null;
}

export function hasCurrentRemoteBiometricConsent(
  verification: RemoteBiometricConsentFields,
): boolean {
  return (
    verification.consentVersion === REMOTE_BIOMETRIC_CONSENT_VERSION &&
    verification.consentAcceptedAt instanceof Date
  );
}
