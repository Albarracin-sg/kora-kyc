jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
}));

import {
  KYC_DOCUMENT_PROVIDER,
  createAppConfiguration,
} from "../src/config/app-config.service";
import { selectDocumentExtractionProvider } from "../src/kyc/providers/document-extraction-provider.factory";
import {
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
} from "../src/kyc/providers/document-extraction-response";
import {
  EXTERNAL_DOCUMENT_PROVIDER_FAILURE,
  ExternalDocumentProviderError,
} from "../src/kyc/providers/external-document-provider.error";
import {
  OPENCODE_GO_CHAT_COMPLETIONS_PATH,
  OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE,
  OPENCODE_GO_MAX_RESPONSE_BYTES,
  OpenCodeGoDocumentExtractionError,
  OpenCodeGoDocumentExtractionProvider,
  type OpenCodeGoFetch,
  type OpenCodeGoFetchResponse,
} from "../src/kyc/providers/opencode-go-document-extraction.provider";
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
  KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.OPENCODE_GO,
  OPENCODE_GO_API_KEY: "test-opencode-go-key",
  OPENCODE_GO_BASE_URL: "https://provider.example.test/zen/go/v1",
  OPENCODE_GO_DOCUMENT_MODEL: "opencode-go/deepseek-v4-flash-vision-exp",
  OPENCODE_GO_DOCUMENT_TIMEOUT_MS: "1000",
};

const VALID_DOCUMENT_RESPONSE = JSON.stringify({
  documentType: "COLOMBIAN_CEDULA",
  documentNumber: "123456",
  fullName: "SYNTHETIC PERSON",
  birthDate: "1990-05-16",
  issueDate: "2005-11-20",
  sex: "M",
  height: "1,75 m",
  bloodType: "A+",
  birthPlace: "Synthetic City",
  result: "VALID",
  reason: "DOCUMENT_PARSED",
  confidence: 0.94,
  frontPresent: true,
  backPresent: true,
});

interface CapturedFetchCall {
  input: string;
  init: RequestInit;
}

interface FetchStub {
  fetch: OpenCodeGoFetch;
  calls: CapturedFetchCall[];
}

interface RequestBody {
  model: string;
  temperature: number;
  messages: RequestMessage[];
  response_format: RequestResponseFormat;
}

interface RequestMessage {
  role: string;
  content: RequestContent[];
}

interface RequestContent {
  type: string;
  text?: string;
  image_url?: RequestImageUrl;
}

interface RequestImageUrl {
  url: string;
}

interface RequestResponseFormat {
  type: string;
  json_schema: RequestJsonSchema;
}

interface RequestJsonSchema {
  name: string;
  strict: boolean;
  schema: typeof DOCUMENT_EXTRACTION_RESPONSE_SCHEMA;
}

function createFetchResponse(status: number, responseText: string): OpenCodeGoFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async (): Promise<string> => responseText,
  };
}

function createFetchStub(response: OpenCodeGoFetchResponse): FetchStub {
  const calls: CapturedFetchCall[] = [];
  return {
    fetch: async (input: string, init: RequestInit): Promise<OpenCodeGoFetchResponse> => {
      calls.push({ input, init });
      return response;
    },
    calls,
  };
}

function createEnvelope(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

function createLabeledImage(side: LabeledDocumentImage["side"]): LabeledDocumentImage {
  return {
    side,
    buffer: Buffer.from(`synthetic-${side}`),
  };
}

function createProvider(fetchImplementation: OpenCodeGoFetch): OpenCodeGoDocumentExtractionProvider {
  const configuration = createAppConfiguration(BASE_ENVIRONMENT, process.cwd());
  return new OpenCodeGoDocumentExtractionProvider({ values: configuration }, fetchImplementation);
}

function parseRequest(call: CapturedFetchCall | undefined): RequestBody {
  if (!call || typeof call.init.body !== "string") {
    throw new Error("Expected a JSON request body");
  }

  return JSON.parse(call.init.body) as RequestBody;
}

describe("OpenCode Go document extraction", () => {
  it("selects OpenCode Go explicitly and does not instantiate another provider", () => {
    const selectedProvider = { audit: { provider: "opencode-go", model: "test" }, extract: jest.fn() };
    const createGeminiProvider = jest.fn(() => selectedProvider);
    const createHuggingFaceProvider = jest.fn(() => selectedProvider);
    const createOpenCodeGoProvider = jest.fn(() => selectedProvider);
    const localProvider: DocumentExtractionProvider = {
      audit: { provider: "local", model: "test" },
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
          reasonCode: "DOCUMENT_REASON_UNSPECIFIED",
        },
        frontPresent: false,
        backPresent: false,
        audit: { provider: "local", model: "test" },
      }),
    };

    expect(
      selectDocumentExtractionProvider(
        { documentProvider: KYC_DOCUMENT_PROVIDER.OPENCODE_GO },
        createGeminiProvider,
        createHuggingFaceProvider,
        createOpenCodeGoProvider,
        localProvider,
      ),
    ).toBe(selectedProvider);
    expect(createOpenCodeGoProvider).toHaveBeenCalledTimes(1);
    expect(createGeminiProvider).not.toHaveBeenCalled();
    expect(createHuggingFaceProvider).not.toHaveBeenCalled();
  });

  it("sends only labeled document images, the bare API model, strict JSON schema, and safe headers", async () => {
    const fetchStub = createFetchStub(createFetchResponse(200, createEnvelope(VALID_DOCUMENT_RESPONSE)));
    const result = await createProvider(fetchStub.fetch).extract([
      createLabeledImage("FRONT"),
      createLabeledImage("BACK"),
    ]);
    const call = fetchStub.calls[0];
    const request = parseRequest(call);
    const requestText = JSON.stringify(request).toLowerCase();
    const imageParts = request.messages[0]?.content.filter((part) => part.type === "image_url");

    expect(call?.input).toBe(
      `https://provider.example.test/zen/go/v1${OPENCODE_GO_CHAT_COMPLETIONS_PATH}`,
    );
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-opencode-go-key",
        "Content-Type": "application/json",
      }),
    );
    expect((call?.init.headers as Record<string, string>)["x-opencode-session"]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(request.model).toBe("deepseek-v4-flash-vision-exp");
    expect(request.temperature).toBe(0);
    expect(imageParts?.map((part) => part.image_url?.url)).toEqual([
      `data:image/jpeg;base64,${Buffer.from("synthetic-FRONT").toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.from("synthetic-BACK").toString("base64")}`,
    ]);
    expect(requestText).not.toContain("selfie");
    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "colombian_cedula_document_extraction",
        strict: true,
        schema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
      },
    });
    expect(result.audit).toEqual({
      provider: "opencode-go",
      model: "opencode-go/deepseek-v4-flash-vision-exp",
    });
    expect(result.parsedDocument.documentNumber).toBe("123456");
  });

  it.each([402, 500])("fails closed for OpenCode Go HTTP %s", async (status) => {
    const fetchStub = createFetchStub(createFetchResponse(status, "sensitive provider body"));

    await expect(createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")])).rejects.toMatchObject({
      name: "OpenCodeGoDocumentExtractionError",
      code: OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
      httpStatus: status,
    } satisfies Partial<OpenCodeGoDocumentExtractionError>);
  });

  it("maps HTTP 429 to the existing typed rate-limit error", async () => {
    const fetchStub = createFetchStub(createFetchResponse(429, "sensitive provider body"));

    await expect(createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")])).rejects.toMatchObject({
      name: "ExternalDocumentProviderError",
      code: EXTERNAL_DOCUMENT_PROVIDER_FAILURE.RATE_LIMITED,
      httpStatus: 429,
    } satisfies Partial<ExternalDocumentProviderError>);
  });

  it.each([
    ["empty response", "", OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.EMPTY_RESPONSE_ENVELOPE],
    ["malformed envelope", "not-json", OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE],
    ["markdown content", createEnvelope(`\`\`\`json\n${VALID_DOCUMENT_RESPONSE}\n\`\`\``), "INVALID_JSON"],
    [
      "schema-invalid content",
      createEnvelope(JSON.stringify({ ...JSON.parse(VALID_DOCUMENT_RESPONSE), unexpected: "field" })),
      "INVALID_RESPONSE_SCHEMA",
    ],
  ])("fails closed for %s", async (_caseName, responseText, expectedCode) => {
    const fetchStub = createFetchStub(createFetchResponse(200, responseText));

    await expect(createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")])).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it("aborts a timed-out request without retrying", async () => {
    jest.useFakeTimers();
    try {
      let fetchAttempts = 0;
      const timeoutFetch: OpenCodeGoFetch = async (
        _input: string,
        init: RequestInit,
      ): Promise<OpenCodeGoFetchResponse> => {
        fetchAttempts += 1;
        return new Promise<OpenCodeGoFetchResponse>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("synthetic request abort")),
            { once: true },
          );
        });
      };
      const extraction = createProvider(timeoutFetch).extract([createLabeledImage("FRONT")]);
      const expectedTimeout = expect(extraction).rejects.toMatchObject({
        code: OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await expectedTimeout;
      expect(fetchAttempts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects oversized response bodies before parsing", async () => {
    const oversizedBody = "x".repeat(OPENCODE_GO_MAX_RESPONSE_BYTES + 1);
    const fetchStub = createFetchStub(createFetchResponse(200, oversizedBody));

    await expect(createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")])).rejects.toMatchObject({
      code: OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    });
  });
});
