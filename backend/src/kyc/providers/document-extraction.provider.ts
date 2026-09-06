import type { DocumentSide } from "../domain/document-side";

export const DOCUMENT_PARSE_OUTCOME = {
  VALID: "VALID",
  REVIEW: "REVIEW",
  REJECT: "REJECT",
} as const;

export type DocumentParseOutcome =
  (typeof DOCUMENT_PARSE_OUTCOME)[keyof typeof DOCUMENT_PARSE_OUTCOME];

export interface ParsedColombianCedula {
  outcome: DocumentParseOutcome;
  documentType: string | null;
  documentNumber: string | null;
  fullName: string | null;
  birthDate: string | null;
  issueDate: string | null;
  sex: string | null;
  height: string | null;
  bloodType: string | null;
  birthPlace: string | null;
  reasonCode: string;
}

export interface DocumentProcessingAudit {
  provider: string;
  model: string;
}

export interface DocumentExtractionResult {
  confidence: number;
  parsedDocument: ParsedColombianCedula;
  frontPresent: boolean;
  backPresent: boolean;
  audit: DocumentProcessingAudit;
}

export interface LabeledDocumentImage {
  side: DocumentSide;
  buffer: Buffer;
}

export interface DocumentExtractionProvider {
  readonly audit: DocumentProcessingAudit;
  extract(images: LabeledDocumentImage[]): Promise<DocumentExtractionResult>;
}
