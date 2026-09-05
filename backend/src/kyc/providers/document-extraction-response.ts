import {
  DOCUMENT_PARSE_OUTCOME,
  type DocumentExtractionResult,
  type DocumentParseOutcome,
  type ParsedColombianCedula,
} from "./document-extraction.provider";

export const DOCUMENT_EXTRACTION_RESPONSE_FIELDS = [
  "documentType",
  "documentNumber",
  "fullName",
  "birthDate",
  "issueDate",
  "sex",
  "height",
  "result",
  "reason",
  "confidence",
  "frontPresent",
  "backPresent",
] as const;

export const DOCUMENT_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...DOCUMENT_EXTRACTION_RESPONSE_FIELDS],
  properties: {
    documentType: { anyOf: [{ type: "string" }, { type: "null" }] },
    documentNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
    fullName: { anyOf: [{ type: "string" }, { type: "null" }] },
    birthDate: { anyOf: [{ type: "string" }, { type: "null" }] },
    issueDate: { anyOf: [{ type: "string" }, { type: "null" }] },
    sex: { anyOf: [{ type: "string" }, { type: "null" }] },
    height: { anyOf: [{ type: "string" }, { type: "null" }] },
    result: { type: "string", enum: ["VALID", "REVIEW", "REJECT"] },
    reason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    frontPresent: { type: "boolean" },
    backPresent: { type: "boolean" },
  },
} as const;

export const DOCUMENT_EXTRACTION_INSTRUCTION = `Analiza las imágenes adjuntas de una cédula colombiana. Cada imagen está etiquetada con FRONT, BACK o COMBINED. Devuelve exclusivamente JSON conforme al esquema.

Reglas de cobertura:
- Si una imagen etiquetada FRONT contiene el frente legible de la cédula, frontPresent debe ser true.
- Si una imagen etiquetada BACK contiene el reverso legible de la cédula, backPresent debe ser true.
- Si una imagen etiquetada COMBINED contiene ambos lados (frente y reverso) legibles, tanto frontPresent como backPresent deben ser true.
- Si la imagen COMBINED sólo contiene un lado, ese lado debe ser true y el otro false.
- Si no se puede determinar la presencia de un lado, ambos deben ser false.

Reglas de extracción:
- documentType debe ser COLOMBIAN_CEDULA sólo si el tipo es visible en cualquiera de las imágenes.
- documentNumber debe contener sólo 6 a 10 dígitos si es legible.
- fullName debe ser el nombre completo visible.
- birthDate debe usar YYYY-MM-DD sólo si es inequívoca.
- issueDate debe usar YYYY-MM-DD sólo si la fecha de expedición es inequívoca; si no es legible, usa null.
- sex debe ser exactamente "M" o "F" sólo si es inequívoco; si no es legible, usa null.
- height debe ser el texto normalizado de la estatura (por ejemplo "1,75 m" o "175 cm") sólo si es legible; si no es legible, usa null. Estos tres campos son opcionales y nunca deben inventarse.
- Usa VALID únicamente si frontPresent o backPresent son true Y el tipo, número, nombre completo y fecha de nacimiento son legibles y coherentes desde las imágenes disponibles.
- Usa REVIEW si la evidencia es insuficiente o ambigua.
- Usa REJECT si ninguna imagen corresponde a una cédula colombiana.
- reason debe ser un código breve en MAYÚSCULAS.
- confidence debe estar entre 0 y 1.`;

export const DOCUMENT_EXTRACTION_RESPONSE_FAILURE = {
  INVALID_JSON: "INVALID_JSON",
  INVALID_RESPONSE_SCHEMA: "INVALID_RESPONSE_SCHEMA",
  UNSUPPORTED_DOCUMENT_TYPE: "UNSUPPORTED_DOCUMENT_TYPE",
  INVALID_DOCUMENT_NUMBER: "INVALID_DOCUMENT_NUMBER",
  INVALID_FULL_NAME: "INVALID_FULL_NAME",
  INVALID_BIRTH_DATE: "INVALID_BIRTH_DATE",
  INSUFFICIENT_VALID_DOCUMENT_TEXT: "INSUFFICIENT_VALID_DOCUMENT_TEXT",
} as const;

export type DocumentExtractionResponseFailure =
  (typeof DOCUMENT_EXTRACTION_RESPONSE_FAILURE)[keyof typeof DOCUMENT_EXTRACTION_RESPONSE_FAILURE];

export interface DocumentExtractionResponseErrorFactory {
  create(code: DocumentExtractionResponseFailure): Error;
}

interface DocumentExtractionModelResponse {
  documentType: string | null;
  documentNumber: string | null;
  fullName: string | null;
  birthDate: string | null;
  issueDate: string | null;
  sex: string | null;
  height: string | null;
  result: DocumentParseOutcome;
  reason: string;
  confidence: number;
  frontPresent: boolean;
  backPresent: boolean;
}

const DOCUMENT_EXTRACTION_RESPONSE_FIELD_SET = new Set<string>(
  DOCUMENT_EXTRACTION_RESPONSE_FIELDS,
);

export function parseDocumentExtractionResponse(
  responseText: string,
  errorFactory: DocumentExtractionResponseErrorFactory,
): Omit<DocumentExtractionResult, "audit"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    throw errorFactory.create(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_JSON);
  }

  if (!isDocumentExtractionModelResponse(parsed)) {
    throw errorFactory.create(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_RESPONSE_SCHEMA);
  }

  return {
    confidence: parsed.confidence,
    parsedDocument: toParsedDocument(parsed, errorFactory),
    frontPresent: parsed.frontPresent,
    backPresent: parsed.backPresent,
  };
}

function isDocumentExtractionModelResponse(value: unknown): value is DocumentExtractionModelResponse {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== DOCUMENT_EXTRACTION_RESPONSE_FIELDS.length ||
    keys.some((key) => !DOCUMENT_EXTRACTION_RESPONSE_FIELD_SET.has(key))
  ) {
    return false;
  }

  return (
    isNullableString(value.documentType) &&
    isNullableString(value.documentNumber) &&
    isNullableString(value.fullName) &&
    isNullableString(value.birthDate) &&
    isNullableString(value.issueDate) &&
    isNullableString(value.sex) &&
    isNullableString(value.height) &&
    isDocumentParseOutcome(value.result) &&
    typeof value.reason === "string" &&
    isReasonCode(value.reason) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    typeof value.frontPresent === "boolean" &&
    typeof value.backPresent === "boolean"
  );
}

function toParsedDocument(
  response: DocumentExtractionModelResponse,
  errorFactory: DocumentExtractionResponseErrorFactory,
): ParsedColombianCedula {
  const documentType = response.documentType?.trim() || null;
  const documentNumber = response.documentNumber?.trim() || null;
  const fullName = response.fullName?.trim() || null;
  const birthDate = response.birthDate?.trim() || null;
  const issueDate = response.issueDate?.trim() || null;
  const sex = response.sex?.trim() || null;
  const height = response.height?.trim() || null;

  if (documentType !== null && documentType !== "COLOMBIAN_CEDULA") {
    throw errorFactory.create(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.UNSUPPORTED_DOCUMENT_TYPE);
  }
  if (documentNumber !== null && !/^\d{6,10}$/.test(documentNumber)) {
    throw errorFactory.create(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_DOCUMENT_NUMBER);
  }
  if (fullName !== null && !isSufficientName(fullName)) {
    throw errorFactory.create(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_FULL_NAME);
  }
  if (birthDate !== null && !isIsoDate(birthDate)) {
    throw errorFactory.create(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_BIRTH_DATE);
  }
  if (
    response.result === DOCUMENT_PARSE_OUTCOME.VALID &&
    (!documentType || !documentNumber || !fullName || !birthDate)
  ) {
    throw errorFactory.create(
      DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INSUFFICIENT_VALID_DOCUMENT_TEXT,
    );
  }

  return {
    outcome: response.result,
    documentType,
    documentNumber,
    fullName,
    birthDate,
    issueDate: isValidIssueDate(issueDate) ? issueDate : null,
    sex: isValidSex(sex) ? sex : null,
    height: isValidHeight(height) ? height : null,
    reasonCode: response.reason,
  };
}

function isValidIssueDate(value: string | null): value is string {
  return value !== null && isIsoDate(value);
}

function isValidSex(value: string | null): value is "M" | "F" {
  return value === "M" || value === "F";
}

function isValidHeight(value: string | null): value is string {
  return value !== null && value.length <= 32;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isDocumentParseOutcome(value: unknown): value is DocumentParseOutcome {
  return Object.values(DOCUMENT_PARSE_OUTCOME).includes(value as DocumentParseOutcome);
}

function isReasonCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
}

function isSufficientName(value: string): boolean {
  return value.length >= 3 && /\p{L}/u.test(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
