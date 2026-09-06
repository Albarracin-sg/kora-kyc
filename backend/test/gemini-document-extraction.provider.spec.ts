jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
}));

import {
  ApiError,
  GenerateContentResponse,
  type GenerateContentParameters,
} from "@google/genai";
import {
  KYC_DOCUMENT_PROVIDER,
  createAppConfiguration,
} from "../src/config/app-config.service";
import { selectDocumentExtractionProvider } from "../src/kyc/providers/document-extraction-provider.factory";
import {
  GEMINI_DOCUMENT_EXTRACTION_FAILURE,
  GeminiDocumentExtractionError,
  GeminiDocumentExtractionProvider,
  type GeminiContentClient,
} from "../src/kyc/providers/gemini-document-extraction.provider";
import {
  DOCUMENT_EXTRACTION_INSTRUCTION,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
} from "../src/kyc/providers/document-extraction-response";
import {
  DOCUMENT_PARSE_OUTCOME,
  type DocumentExtractionProvider,
  type DocumentExtractionResult,
  type LabeledDocumentImage,
} from "../src/kyc/providers/document-extraction.provider";

const BASE_ENVIRONMENT: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://localhost:5432/kora",
  JWT_SECRET: "test-jwt-secret",
  KYC_DOCUMENT_HASH_PEPPER: "test-pepper",
  KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.GEMINI,
  GEMINI_API_KEY: "test-gemini-key",
};

const VALID_GEMINI_RESPONSE = JSON.stringify({
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
});

function createResponse(text: string): GenerateContentResponse {
  const response = new GenerateContentResponse();
  Object.defineProperty(response, "text", { value: text });
  return response;
}

function createClient(text: string): GeminiContentClient {
  return {
    models: {
      generateContent: jest.fn(
        async (_parameters: GenerateContentParameters): Promise<GenerateContentResponse> =>
          createResponse(text),
      ),
    },
  };
}

function createFailingClient(): GeminiContentClient {
  return {
    models: {
      generateContent: jest.fn(
        async (_parameters: GenerateContentParameters): Promise<GenerateContentResponse> => {
          throw new Error("provider transport failure");
        },
      ),
    },
  };
}

function createQuotaExhaustedClient(): GeminiContentClient {
  return {
    models: {
      generateContent: jest.fn(
        async (_parameters: GenerateContentParameters): Promise<GenerateContentResponse> => {
          throw new ApiError({ message: "synthetic", status: 429 });
        },
      ),
    },
  };
}

function createProvider(text: string): GeminiDocumentExtractionProvider {
  const configuration = createAppConfiguration(BASE_ENVIRONMENT, process.cwd());
  return new GeminiDocumentExtractionProvider({ values: configuration }, createClient(text));
}

function createProviderWithClient(client: GeminiContentClient): GeminiDocumentExtractionProvider {
  const configuration = createAppConfiguration(BASE_ENVIRONMENT, process.cwd());
  return new GeminiDocumentExtractionProvider({ values: configuration }, client);
}

function createStubProvider(): DocumentExtractionProvider {
  return {
    audit: { provider: "test", model: "test" },
    extract: async (): Promise<DocumentExtractionResult> => ({
      confidence: 0,
      parsedDocument: {
        outcome: DOCUMENT_PARSE_OUTCOME.REVIEW,
        documentType: null,
        documentNumber: null,
        fullName: null,
        birthDate: null,
        issueDate: null,
        sex: null,
        height: null,
        bloodType: null,
        birthPlace: null,
        reasonCode: "TEST_ONLY",
      },
      frontPresent: false,
      backPresent: false,
      audit: { provider: "test", model: "test" },
    }),
  };
}

function createLabeledImage(side: string): LabeledDocumentImage {
  return {
    side: side as LabeledDocumentImage["side"],
    buffer: Buffer.from("document"),
  };
}

describe("Gemini document extraction", () => {
  it("selects Gemini or local only through explicit configuration", () => {
    const geminiProvider = createStubProvider();
    const huggingFaceProvider = createStubProvider();
    const localProvider = createStubProvider();
    const createGeminiProvider = jest.fn(() => geminiProvider);
    const createHuggingFaceProvider = jest.fn(() => huggingFaceProvider);

    const createOpenCodeGoProvider = jest.fn(() => localProvider);
    expect(
      selectDocumentExtractionProvider(
        { documentProvider: KYC_DOCUMENT_PROVIDER.GEMINI },
        createGeminiProvider,
        createHuggingFaceProvider,
        createOpenCodeGoProvider,
        localProvider,
      ),
    ).toBe(geminiProvider);
    expect(
      selectDocumentExtractionProvider(
        { documentProvider: KYC_DOCUMENT_PROVIDER.HUGGING_FACE },
        createGeminiProvider,
        createHuggingFaceProvider,
        createOpenCodeGoProvider,
        localProvider,
      ),
    ).toBe(huggingFaceProvider);
    expect(
      selectDocumentExtractionProvider(
        { documentProvider: KYC_DOCUMENT_PROVIDER.LOCAL },
        createGeminiProvider,
        createHuggingFaceProvider,
        createOpenCodeGoProvider,
        localProvider,
      ),
    ).toBe(localProvider);
    expect(createGeminiProvider).toHaveBeenCalledTimes(1);
    expect(createHuggingFaceProvider).toHaveBeenCalledTimes(1);
    expect(createOpenCodeGoProvider).not.toHaveBeenCalled();
  });

  it("fails configuration clearly when Gemini is selected without an API key", () => {
    const environment = { ...BASE_ENVIRONMENT };
    delete environment.GEMINI_API_KEY;

    expect(() => createAppConfiguration(environment, process.cwd())).toThrow(
      "GEMINI_API_KEY is required when KYC_DOCUMENT_PROVIDER=gemini",
    );
  });

  it("keeps OpenCode Go as the default even when legacy variables are present", () => {
    const environment: NodeJS.ProcessEnv = {
      ...BASE_ENVIRONMENT,
      OPENCODE_GO_API_KEY: "test-opencode-go-key",
      HUGGINGFACE_API_TOKEN: "test-huggingface-token",
      HUGGINGFACE_DOCUMENT_MODEL: "Organization/DocumentModel:provider",
    };
    delete environment.KYC_DOCUMENT_PROVIDER;

    expect(createAppConfiguration(environment, process.cwd()).documentProvider).toBe(
      KYC_DOCUMENT_PROVIDER.OPENCODE_GO,
    );
  });

  it("accepts a valid structured Gemini response through a typed client mock", async () => {
    const result = await createProvider(VALID_GEMINI_RESPONSE).extract([
      createLabeledImage("FRONT"),
      createLabeledImage("BACK"),
    ]);

    expect(result.confidence).toBe(0.94);
    expect(result.parsedDocument).toEqual({
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "1234567890",
      fullName: "MARIA ELENA GOMEZ",
      birthDate: "1990-05-16",
      issueDate: "2010-05-15",
      sex: "F",
      height: "1,64 m",
      bloodType: "O+",
      birthPlace: "Bogotá",
      reasonCode: "DOCUMENT_PARSED",
    });
    expect(result.frontPresent).toBe(true);
    expect(result.backPresent).toBe(true);
    expect(result.audit).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
  });

  it("sends the shared classification instruction and strict nullable schema", async () => {
    let capturedParameters: GenerateContentParameters | undefined;
    const generateContent = jest.fn(
      async (parameters: GenerateContentParameters): Promise<GenerateContentResponse> => {
        capturedParameters = parameters;
        return createResponse(VALID_GEMINI_RESPONSE);
      },
    );
    const client: GeminiContentClient = { models: { generateContent } };

    await new GeminiDocumentExtractionProvider(
      { values: createAppConfiguration(BASE_ENVIRONMENT, process.cwd()) },
      client,
    ).extract([createLabeledImage("FRONT")]);

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(capturedParameters?.config?.responseJsonSchema).toEqual(
      DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
    );
    expect(JSON.stringify(capturedParameters)).toContain(
      DOCUMENT_EXTRACTION_INSTRUCTION.slice(0, 120),
    );
  });

  it("fails closed when Gemini returns invalid JSON", async () => {
    await expect(
      createProvider("not-json").extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      name: "GeminiDocumentExtractionError",
      code: "INVALID_JSON",
    } satisfies Partial<GeminiDocumentExtractionError>);
  });

  it("preserves a model rejection and fails closed on insufficient valid text", async () => {
    const rejection = JSON.stringify({
      documentType: null,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      result: "REJECT",
      reason: "DOCUMENT_TYPE_NOT_RECOGNIZED",
      confidence: 0.9,
      frontPresent: false,
      backPresent: false,
    });
    const insufficientValidText = JSON.stringify({
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: null,
      fullName: null,
      birthDate: null,
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      result: "VALID",
      reason: "DOCUMENT_PARSED",
      confidence: 0.9,
      frontPresent: true,
      backPresent: true,
    });

    await expect(
      createProvider(rejection).extract([createLabeledImage("FRONT")]),
    ).resolves.toMatchObject({
      parsedDocument: { outcome: DOCUMENT_PARSE_OUTCOME.REJECT },
    });
    await expect(
      createProvider(insufficientValidText).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_VALID_DOCUMENT_TEXT" } satisfies Partial<
      GeminiDocumentExtractionError
    >);
  });

  it("redacts provider failures into a controlled processing error", async () => {
    await expect(
      createProviderWithClient(createFailingClient()).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({ code: "REQUEST_FAILED" } satisfies Partial<GeminiDocumentExtractionError>);
  });

  it("classifies an HTTP 429 as a safe quota exhaustion code", async () => {
    await expect(
      createProviderWithClient(createQuotaExhaustedClient()).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      code: GEMINI_DOCUMENT_EXTRACTION_FAILURE.REQUEST_QUOTA_EXHAUSTED,
    } satisfies Partial<GeminiDocumentExtractionError>);
  });

  it("fails when no images are provided", async () => {
    await expect(
      createProvider(VALID_GEMINI_RESPONSE).extract([]),
    ).rejects.toMatchObject({ code: "NO_IMAGES_PROVIDED" } satisfies Partial<
      GeminiDocumentExtractionError
    >);
  });

  it("accepts a valid response where the optional profile fields are null", async () => {
    const nullOptionalFields = JSON.stringify({
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "1234567890",
      fullName: "MARIA ELENA GOMEZ",
      birthDate: "1990-05-16",
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      result: "VALID",
      reason: "DOCUMENT_PARSED",
      confidence: 0.94,
      frontPresent: true,
      backPresent: true,
    });

    const result = await createProvider(nullOptionalFields).extract([
      createLabeledImage("FRONT"),
      createLabeledImage("BACK"),
    ]);

    expect(result.parsedDocument).toEqual({
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "1234567890",
      fullName: "MARIA ELENA GOMEZ",
      birthDate: "1990-05-16",
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      reasonCode: "DOCUMENT_PARSED",
    });
  });

  it("coerces invalid optional profile values to null without failing the verdict", async () => {
    const invalidOptionalFields = JSON.stringify({
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "1234567890",
      fullName: "MARIA ELENA GOMEZ",
      birthDate: "1990-05-16",
      issueDate: "15/05/2010",
      sex: "X",
      height: " ".repeat(64),
      bloodType: "ABO",
      birthPlace: "123456",
      result: "VALID",
      reason: "DOCUMENT_PARSED",
      confidence: 0.94,
      frontPresent: true,
      backPresent: true,
    });

    const result = await createProvider(invalidOptionalFields).extract([
      createLabeledImage("FRONT"),
      createLabeledImage("BACK"),
    ]);

    expect(result.parsedDocument).toEqual({
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "1234567890",
      fullName: "MARIA ELENA GOMEZ",
      birthDate: "1990-05-16",
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      reasonCode: "DOCUMENT_PARSED",
    });
  });
});
