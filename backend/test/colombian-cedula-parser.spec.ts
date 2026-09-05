import {
  DOCUMENT_PARSE_OUTCOME,
} from "../src/kyc/providers/document-extraction.provider";
import { parseColombianCedula } from "../src/kyc/providers/colombian-cedula-parser";

describe("parseColombianCedula", () => {
  it("extracts one labelled Colombian cédula number", () => {
    const result = parseColombianCedula(`
      REPÚBLICA DE COLOMBIA
      CÉDULA DE CIUDADANÍA
      NÚMERO 1.234.567.890
      APELLIDOS Y NOMBRES
    `);

    expect(result.outcome).toBe(DOCUMENT_PARSE_OUTCOME.VALID);
    expect(result.documentType).toBe("COLOMBIAN_CEDULA");
    expect(result.documentNumber).toBe("1234567890");
  });

  it("routes ambiguous document numbers to review", () => {
    const result = parseColombianCedula(`
      REPUBLICA DE COLOMBIA
      CEDULA DE CIUDADANIA
      NUMERO 1000000000
      NUIP 1000000001
    `);

    expect(result.outcome).toBe(DOCUMENT_PARSE_OUTCOME.REVIEW);
    expect(result.documentNumber).toBeNull();
  });

  it("rejects a document without Colombian cédula context", () => {
    const result = parseColombianCedula("PASSPORT 123456789");

    expect(result.outcome).toBe(DOCUMENT_PARSE_OUTCOME.REJECT);
    expect(result.documentNumber).toBeNull();
  });
});
