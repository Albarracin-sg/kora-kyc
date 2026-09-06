jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
}));

import { LocalTesseractDocumentExtractionProvider } from "../src/kyc/providers/local-tesseract-document-extraction.provider";

describe("LocalTesseractDocumentExtractionProvider", () => {
  it("returns null for blood type and birth place when no document is available", async () => {
    const provider = new LocalTesseractDocumentExtractionProvider({} as never, {} as never);

    const result = await provider.extract([]);

    expect(result.parsedDocument).toEqual(
      expect.objectContaining({
        bloodType: null,
        birthPlace: null,
      }),
    );
  });
});
