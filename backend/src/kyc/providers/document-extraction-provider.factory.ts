import {
  KYC_DOCUMENT_PROVIDER,
  type AppConfiguration,
} from "../../config/app-config.service";
import type { DocumentExtractionProvider } from "./document-extraction.provider";

export function selectDocumentExtractionProvider(
  configuration: Pick<AppConfiguration, "documentProvider">,
  createGeminiProvider: () => DocumentExtractionProvider,
  createHuggingFaceProvider: () => DocumentExtractionProvider,
  createOpenCodeGoProvider: () => DocumentExtractionProvider,
  localProvider: DocumentExtractionProvider,
): DocumentExtractionProvider {
  switch (configuration.documentProvider) {
    case KYC_DOCUMENT_PROVIDER.OPENCODE_GO:
      return createOpenCodeGoProvider();
    case KYC_DOCUMENT_PROVIDER.GEMINI:
      return createGeminiProvider();
    case KYC_DOCUMENT_PROVIDER.HUGGING_FACE:
      return createHuggingFaceProvider();
    case KYC_DOCUMENT_PROVIDER.LOCAL:
      return localProvider;
  }
}
