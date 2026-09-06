import {
  DOCUMENT_EXTRACTION_INSTRUCTION,
  DOCUMENT_EXTRACTION_REASON_CODE,
  DOCUMENT_EXTRACTION_RESPONSE_FIELDS,
  DOCUMENT_EXTRACTION_RESPONSE_FAILURE,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
  parseDocumentExtractionResponse,
} from "../src/kyc/providers/document-extraction-response";
import { DOCUMENT_PARSE_OUTCOME } from "../src/kyc/providers/document-extraction.provider";

const BASE_RESPONSE = {
  documentType: "COLOMBIAN_CEDULA",
  documentNumber: "1234567890",
  fullName: "MARIA ELENA GOMEZ",
  birthDate: "1990-05-16",
  issueDate: "2010-05-15",
  sex: "F",
  height: "1,64 m",
  bloodType: "O+",
  birthPlace: "Bogotá",
  result: "VALID",
  reason: "DOCUMENT_PARSED",
  confidence: 0.94,
  frontPresent: true,
  backPresent: true,
};

function parseResponse(overrides: Record<string, unknown> = {}) {
  return parseDocumentExtractionResponse(JSON.stringify({ ...BASE_RESPONSE, ...overrides }), {
    create: (code) => new Error(code),
  });
}

describe("document extraction response contract", () => {
  it("requires nullable blood type and birth place fields and rejects additional fields", () => {
    expect(DOCUMENT_EXTRACTION_RESPONSE_FIELDS).toEqual(
      expect.arrayContaining(["bloodType", "birthPlace"]),
    );
    expect(DOCUMENT_EXTRACTION_RESPONSE_SCHEMA.additionalProperties).toBe(false);
    expect(DOCUMENT_EXTRACTION_RESPONSE_SCHEMA.required).toEqual(
      expect.arrayContaining(["bloodType", "birthPlace"]),
    );
    expect(DOCUMENT_EXTRACTION_RESPONSE_SCHEMA.properties.bloodType).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(DOCUMENT_EXTRACTION_RESPONSE_SCHEMA.properties.birthPlace).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });

    const missingField: Record<string, unknown> = { ...BASE_RESPONSE };
    delete missingField.bloodType;
    expect(() =>
      parseDocumentExtractionResponse(JSON.stringify(missingField), {
        create: (code) => new Error(code),
      }),
    ).toThrow(
      DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_RESPONSE_SCHEMA,
    );

    expect(() => parseResponse({ extraField: "not allowed" })).toThrow(
      DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_RESPONSE_SCHEMA,
    );
  });

  it.each(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])(
    "accepts blood type %s",
    (bloodType) => {
      expect(parseResponse({ bloodType }).parsedDocument.bloodType).toBe(bloodType);
    },
  );

  it("normalizes blood type to uppercase", () => {
    expect(parseResponse({ bloodType: "  ab- " }).parsedDocument.bloodType).toBe("AB-");
  });

  it.each(["ABO", "A", "A +", "", "O POSITIVE"])(
    "coerces invalid blood type %j to null",
    (bloodType) => {
      expect(parseResponse({ bloodType }).parsedDocument.bloodType).toBeNull();
    },
  );

  it("preserves null blood type", () => {
    expect(parseResponse({ bloodType: null }).parsedDocument.bloodType).toBeNull();
  });

  it("trims and collapses whitespace in a valid birth place", () => {
    expect(parseResponse({ birthPlace: "  Bogotá   D.C.  " }).parsedDocument.birthPlace).toBe(
      "Bogotá D.C.",
    );
  });

  it.each(["123456", "   ", "\u0000Bogotá", "x".repeat(121)])(
    "coerces invalid birth place %j to null",
    (birthPlace) => {
      expect(parseResponse({ birthPlace }).parsedDocument.birthPlace).toBeNull();
    },
  );

  it("preserves null birth place", () => {
    expect(parseResponse({ birthPlace: null }).parsedDocument.birthPlace).toBeNull();
  });

  it.each(Object.values(DOCUMENT_EXTRACTION_REASON_CODE))(
    "accepts canonical reason code %s",
    (reason) => {
      expect(parseResponse({ reason }).parsedDocument.reasonCode).toBe(reason);
    },
  );

  it.each([
    "DOCUMENT_NUMBER_12345678",
    "BIRTH_DATE_1990-05-16",
    "FULL_NAME_MARIA_ELENA_GOMEZ",
    "document number exposed",
  ])("rejects dynamic or PII-bearing reason %j", (reason) => {
    const create = jest.fn((code: string) => new Error(code));

    expect(() =>
      parseDocumentExtractionResponse(JSON.stringify({ ...BASE_RESPONSE, reason }), { create }),
    ).toThrow(DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_RESPONSE_SCHEMA);
    expect(create).toHaveBeenCalledWith(
      DOCUMENT_EXTRACTION_RESPONSE_FAILURE.INVALID_RESPONSE_SCHEMA,
    );
    expect(create).not.toHaveBeenCalledWith(expect.stringContaining("12345678"));
    expect(create).not.toHaveBeenCalledWith(expect.stringContaining("MARIA"));
    expect(create).not.toHaveBeenCalledWith(expect.stringContaining("1990-05-16"));
  });

  it("classifies unsupported evidence as REJECT and ambiguous evidence as REVIEW", () => {
    expect(
      parseResponse({
        documentType: null,
        documentNumber: null,
        fullName: null,
        birthDate: null,
        issueDate: null,
        sex: null,
        height: null,
        bloodType: null,
        birthPlace: null,
        result: DOCUMENT_PARSE_OUTCOME.REJECT,
        reason: "DOCUMENT_TYPE_NOT_RECOGNIZED",
        frontPresent: false,
        backPresent: false,
      }).parsedDocument.outcome,
    ).toBe(DOCUMENT_PARSE_OUTCOME.REJECT);

    expect(
      parseResponse({
        result: DOCUMENT_PARSE_OUTCOME.REVIEW,
        reason: "AMBIGUOUS_DOCUMENT_TYPE",
      }).parsedDocument.outcome,
    ).toBe(DOCUMENT_PARSE_OUTCOME.REVIEW);
  });

  it("accepts a non-Colombian REJECT and removes its unsupported profile", () => {
    expect(
      parseResponse({
        documentType: "PASSPORT",
        result: DOCUMENT_PARSE_OUTCOME.REJECT,
        reason: DOCUMENT_EXTRACTION_REASON_CODE.DOCUMENT_TYPE_NOT_RECOGNIZED,
      }).parsedDocument,
    ).toEqual({
      outcome: DOCUMENT_PARSE_OUTCOME.REJECT,
      documentType: null,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      reasonCode: DOCUMENT_EXTRACTION_REASON_CODE.DOCUMENT_TYPE_NOT_RECOGNIZED,
    });
  });

  it.each([DOCUMENT_PARSE_OUTCOME.VALID, DOCUMENT_PARSE_OUTCOME.REVIEW])(
    "fails closed for a non-Colombian %s response",
    (result) => {
      const create = jest.fn((code: string) => new Error(code));

      expect(() =>
        parseDocumentExtractionResponse(
          JSON.stringify({ ...BASE_RESPONSE, documentType: "PASSPORT", result }),
          { create },
        ),
      ).toThrow(
        DOCUMENT_EXTRACTION_RESPONSE_FAILURE.UNSUPPORTED_DOCUMENT_TYPE,
      );
      expect(create).toHaveBeenCalledWith(
        DOCUMENT_EXTRACTION_RESPONSE_FAILURE.UNSUPPORTED_DOCUMENT_TYPE,
      );
    },
  );

  it("instructs providers to classify evidence instead of assuming a cédula", () => {
    expect(DOCUMENT_EXTRACTION_INSTRUCTION).toMatch(
      /NO asumas que las imágenes son una cédula colombiana/i,
    );
    expect(DOCUMENT_EXTRACTION_INSTRUCTION).toMatch(/REJECT si ninguna imagen corresponde/i);
    expect(DOCUMENT_EXTRACTION_INSTRUCTION).toMatch(/REVIEW si la evidencia es ambigua/i);
    expect(DOCUMENT_EXTRACTION_INSTRUCTION).toMatch(/no es una comprobación antifraude/i);
  });
});
