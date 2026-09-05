import {
  DOCUMENT_SIDE,
  isValidDocumentSide,
} from "../src/kyc/domain/document-side";

describe("DocumentSide", () => {
  it("defines only the supported sides", () => {
    expect(Object.values(DOCUMENT_SIDE)).toEqual(["FRONT", "BACK", "COMBINED"]);
  });

  it.each(["FRONT", "BACK", "COMBINED"])("accepts %s as a valid side", (side) => {
    expect(isValidDocumentSide(side)).toBe(true);
  });

  it.each(["front", "SELFIE", "", "COMBINED "])(
    "rejects %j as an invalid side",
    (side) => {
      expect(isValidDocumentSide(side)).toBe(false);
    },
  );
});
