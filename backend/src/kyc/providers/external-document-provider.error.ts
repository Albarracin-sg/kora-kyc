export const EXTERNAL_DOCUMENT_PROVIDER_FAILURE = {
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type ExternalDocumentProviderFailure =
  (typeof EXTERNAL_DOCUMENT_PROVIDER_FAILURE)[keyof typeof EXTERNAL_DOCUMENT_PROVIDER_FAILURE];

export class ExternalDocumentProviderError extends Error {
  constructor(readonly code: ExternalDocumentProviderFailure) {
    super(`External document provider failed: ${code}`);
    this.name = "ExternalDocumentProviderError";
  }
}
