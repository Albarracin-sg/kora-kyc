import {
  DOCUMENT_PARSE_OUTCOME,
  type ParsedColombianCedula,
} from "./document-extraction.provider";

const COLOMBIAN_CEDULA_TYPE = "COLOMBIAN_CEDULA";
const CEDULA_CONTEXT = ["CEDULA DE CIUDADANIA", "CEDULA", "REPUBLICA DE COLOMBIA"] as const;
const LABELED_DOCUMENT_NUMBER =
  /(?:NUIP|NUMERO(?:\s+DE\s+IDENTIFICACION)?|IDENTIFICACION|N(?:UMERO)?[Oº°]?)\s*[:#.-]*\s*([0-9][0-9 .-]{4,14}[0-9])/g;
const UNLABELED_DOCUMENT_NUMBER = /\b\d{6,10}\b/g;

function normalizeOcrText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeDocumentNumber(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 10) {
    return null;
  }

  return digits;
}

function uniqueCandidates(matches: IterableIterator<RegExpMatchArray>): string[] {
  const candidates = new Set<string>();
  for (const match of matches) {
    const source = match[1] ?? match[0];
    const candidate = normalizeDocumentNumber(source);
    if (candidate) {
      candidates.add(candidate);
    }
  }

  return [...candidates];
}

export function parseColombianCedula(ocrText: string): ParsedColombianCedula {
  const normalizedText = normalizeOcrText(ocrText);
  const hasCedulaContext =
    normalizedText.includes(CEDULA_CONTEXT[0]) ||
    (normalizedText.includes(CEDULA_CONTEXT[1]) && normalizedText.includes(CEDULA_CONTEXT[2]));

  if (!hasCedulaContext) {
    return {
      outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
      documentType: null,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      reasonCode: "DOCUMENT_TYPE_NOT_RECOGNIZED",
    };
  }

  const labeledCandidates = uniqueCandidates(normalizedText.matchAll(LABELED_DOCUMENT_NUMBER));
  if (labeledCandidates.length === 1) {
    return {
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: COLOMBIAN_CEDULA_TYPE,
      documentNumber: labeledCandidates[0] ?? null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      reasonCode: "DOCUMENT_PARSED",
    };
  }

  if (labeledCandidates.length > 1) {
    return {
      outcome: DOCUMENT_PARSE_OUTCOME.REVIEW,
      documentType: COLOMBIAN_CEDULA_TYPE,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      reasonCode: "AMBIGUOUS_DOCUMENT_NUMBER",
    };
  }

  const unlabelledCandidates = uniqueCandidates(normalizedText.matchAll(UNLABELED_DOCUMENT_NUMBER));
  if (unlabelledCandidates.length === 1) {
    return {
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: COLOMBIAN_CEDULA_TYPE,
      documentNumber: unlabelledCandidates[0] ?? null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      reasonCode: "DOCUMENT_PARSED_UNLABELED",
    };
  }

  return {
    outcome: DOCUMENT_PARSE_OUTCOME.REVIEW,
    documentType: COLOMBIAN_CEDULA_TYPE,
    documentNumber: null,
    fullName: null,
    birthDate: null,
    issueDate: null,
    sex: null,
    height: null,
    reasonCode: "DOCUMENT_NUMBER_UNAVAILABLE",
  };
}
