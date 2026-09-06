jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
}));

import {
  KYC_DOCUMENT_PROVIDER,
  createAppConfiguration,
} from "../src/config/app-config.service";
import {
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
} from "../src/kyc/providers/document-extraction-response";
import {
  ExternalDocumentProviderError,
  EXTERNAL_DOCUMENT_PROVIDER_FAILURE,
} from "../src/kyc/providers/external-document-provider.error";
import {
  HUGGING_FACE_CHAT_COMPLETIONS_URL,
  HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE,
  HUGGING_FACE_MAX_RESPONSE_BYTES,
  HuggingFaceDocumentExtractionError,
  HuggingFaceDocumentExtractionProvider,
  type HuggingFaceFetch,
  type HuggingFaceFetchResponse,
} from "../src/kyc/providers/hugging-face-document-extraction.provider";
import {
  DOCUMENT_PARSE_OUTCOME,
  type LabeledDocumentImage,
} from "../src/kyc/providers/document-extraction.provider";

const BASE_ENVIRONMENT: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://localhost:5432/kora",
  JWT_SECRET: "test-jwt-secret",
  KYC_DOCUMENT_HASH_PEPPER: "test-pepper",
  KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.HUGGING_FACE,
  HUGGINGFACE_API_TOKEN: "test-huggingface-token",
  HUGGINGFACE_DOCUMENT_MODEL: "Organization/DocumentModel:provider",
  HUGGINGFACE_DOCUMENT_TIMEOUT_MS: "1000",
};

const VALID_DOCUMENT_RESPONSE = JSON.stringify({
  documentType: "COLOMBIAN_CEDULA",
  documentNumber: "123456",
  fullName: "TEST PERSON",
  birthDate: "1990-05-16",
  issueDate: "2005-11-20",
  sex: "M",
  height: "1,75 m",
  bloodType: "A+",
  birthPlace: "Medellín",
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
  fetch: HuggingFaceFetch;
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

function createFetchResponse(status: number, responseText: string): HuggingFaceFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async (): Promise<string> => responseText,
  };
}

function createFetchStub(response: HuggingFaceFetchResponse): FetchStub {
  const calls: CapturedFetchCall[] = [];
  return {
    fetch: async (input: string, init: RequestInit): Promise<HuggingFaceFetchResponse> => {
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

function createProvider(fetchImplementation: HuggingFaceFetch): HuggingFaceDocumentExtractionProvider {
  const configuration = createAppConfiguration(BASE_ENVIRONMENT, process.cwd());
  return new HuggingFaceDocumentExtractionProvider({ values: configuration }, fetchImplementation);
}

function parseRequest(call: CapturedFetchCall | undefined): RequestBody {
  if (!call || typeof call.init.body !== "string") {
    throw new Error("Expected a JSON request body");
  }

  return JSON.parse(call.init.body) as RequestBody;
}

describe("Hugging Face document extraction", () => {
  it("sends only labeled normalized document images in one strict-schema request", async () => {
    const fetchStub = createFetchStub(createFetchResponse(200, createEnvelope(VALID_DOCUMENT_RESPONSE)));
    const result = await createProvider(fetchStub.fetch).extract([
      createLabeledImage("FRONT"),
      createLabeledImage("BACK"),
      createLabeledImage("COMBINED"),
    ]);
    const call = fetchStub.calls[0];
    const request = parseRequest(call);
    const requestText = JSON.stringify(request).toLowerCase();
    const imageParts = request.messages[0]?.content.filter((part) => part.type === "image_url");
    const sideLabels = request.messages[0]?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text));

    expect(fetchStub.calls).toHaveLength(1);
    expect(call?.input).toBe(HUGGING_FACE_CHAT_COMPLETIONS_URL);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({
      Authorization: "Bearer test-huggingface-token",
      "Content-Type": "application/json",
    });
    expect(request.model).toBe("Organization/DocumentModel:provider");
    expect(request.temperature).toBe(0);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]?.role).toBe("user");
    expect(imageParts).toHaveLength(3);
    expect(imageParts?.map((part) => part.image_url?.url)).toEqual([
      `data:image/jpeg;base64,${Buffer.from("synthetic-FRONT").toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.from("synthetic-BACK").toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.from("synthetic-COMBINED").toString("base64")}`,
    ]);
    expect(sideLabels).toEqual(
      expect.arrayContaining([
        "Document evidence side: FRONT",
        "Document evidence side: BACK",
        "Document evidence side: COMBINED",
      ]),
    );
    expect(requestText).not.toContain("selfie");
    expect(requestText).toContain("bloodtype");
    expect(requestText).toContain("birthplace");
    expect(requestText).toContain("no asumas que las imágenes son una cédula colombiana");
    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "colombian_cedula_document_extraction",
        strict: true,
        schema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
      },
    });
    expect(result).toEqual({
      confidence: 0.94,
      parsedDocument: {
        outcome: DOCUMENT_PARSE_OUTCOME.VALID,
        documentType: "COLOMBIAN_CEDULA",
        documentNumber: "123456",
        fullName: "TEST PERSON",
        birthDate: "1990-05-16",
        issueDate: "2005-11-20",
        sex: "M",
        height: "1,75 m",
        bloodType: "A+",
        birthPlace: "Medellín",
        reasonCode: "DOCUMENT_PARSED",
      },
      frontPresent: true,
      backPresent: true,
      audit: { provider: "huggingface", model: "Organization/DocumentModel:provider" },
    });
  });

  it("parses a valid response that omits unreadable optional profile fields", async () => {
    const responseWithoutOptionalFields = JSON.parse(VALID_DOCUMENT_RESPONSE) as Record<
      string,
      unknown
    >;
    for (const field of ["issueDate", "sex", "height", "bloodType", "birthPlace"]) {
      delete responseWithoutOptionalFields[field];
    }
    const fetchStub = createFetchStub(
      createFetchResponse(200, createEnvelope(JSON.stringify(responseWithoutOptionalFields))),
    );

    const result = await createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")]);

    expect(result.parsedDocument).toEqual({
      outcome: DOCUMENT_PARSE_OUTCOME.VALID,
      documentType: "COLOMBIAN_CEDULA",
      documentNumber: "123456",
      fullName: "TEST PERSON",
      birthDate: "1990-05-16",
      issueDate: null,
      sex: null,
      height: null,
      bloodType: null,
      birthPlace: null,
      reasonCode: "DOCUMENT_PARSED",
    });
  });

  it.each([
    "DOCUMENT_NUMBER_12345678",
    "TEST PERSON 1990-05-16",
  ])("maps an unrecognized reason %j to the safe fallback", async (reason) => {
    const responseWithUnknownReason = {
      ...(JSON.parse(VALID_DOCUMENT_RESPONSE) as Record<string, unknown>),
      reason,
    };
    const fetchStub = createFetchStub(
      createFetchResponse(200, createEnvelope(JSON.stringify(responseWithUnknownReason))),
    );

    const result = await createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")]);

    expect(result.parsedDocument.reasonCode).toBe("DOCUMENT_REASON_UNSPECIFIED");
    expect(JSON.stringify(result)).not.toContain(reason);
  });

  it("fails closed for malformed envelopes, malformed content, and unexpected content fields", async () => {
    const malformedEnvelope = createFetchStub(createFetchResponse(200, "not-json"));
    await expect(
      createProvider(malformedEnvelope.fetch).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      code: HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    } satisfies Partial<HuggingFaceDocumentExtractionError>);

    const malformedContent = createFetchStub(createFetchResponse(200, createEnvelope("not-json")));
    await expect(
      createProvider(malformedContent.fetch).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({ code: "INVALID_JSON" } satisfies Partial<HuggingFaceDocumentExtractionError>);

    const responseWithUnexpectedField = JSON.stringify({
      ...JSON.parse(VALID_DOCUMENT_RESPONSE) as Record<string, unknown>,
      unexpected: "value",
    });
    const unexpectedField = createFetchStub(
      createFetchResponse(200, createEnvelope(responseWithUnexpectedField)),
    );
    await expect(
      createProvider(unexpectedField.fetch).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE_SCHEMA",
    } satisfies Partial<HuggingFaceDocumentExtractionError>);
  });

  it.each([401, 402])("preserves HTTP %s on a non-rate-limit provider failure", async (status) => {
    const fetchStub = createFetchStub(createFetchResponse(status, "sensitive provider body"));

    await expect(
      createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      name: "HuggingFaceDocumentExtractionError",
      code: HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
      httpStatus: status,
    } satisfies Partial<HuggingFaceDocumentExtractionError>);
  });

  it("maps an external HTTP 429 to the generic rate-limit error and preserves its status", async () => {
    const fetchStub = createFetchStub(createFetchResponse(429, "sensitive provider body"));

    await expect(
      createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      name: "ExternalDocumentProviderError",
      code: EXTERNAL_DOCUMENT_PROVIDER_FAILURE.RATE_LIMITED,
      httpStatus: 429,
    } satisfies Partial<ExternalDocumentProviderError>);
  });

  it("aborts a timed-out request without retrying", async () => {
    jest.useFakeTimers();
    try {
      let fetchAttempts = 0;
      const timeoutFetch: HuggingFaceFetch =
        async (_input: string, init: RequestInit): Promise<HuggingFaceFetchResponse> => {
          fetchAttempts += 1;
          return new Promise<HuggingFaceFetchResponse>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("synthetic request abort")),
              { once: true },
            );
          });
        };
      const extraction = createProvider(timeoutFetch).extract([createLabeledImage("FRONT")]);
      const expectedTimeout = expect(extraction).rejects.toMatchObject({
        code: HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
      } satisfies Partial<HuggingFaceDocumentExtractionError>);

      await jest.advanceTimersByTimeAsync(1_000);

      await expectedTimeout;

      expect(fetchAttempts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("times out when response headers arrive but the response body never resolves", async () => {
    jest.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | null = null;
      const hangingBodyFetch: HuggingFaceFetch = async (
        _input: string,
        init: RequestInit,
      ): Promise<HuggingFaceFetchResponse> => {
        capturedSignal = init.signal ?? null;
        return {
          ok: true,
          status: 200,
          text: (): Promise<string> => new Promise<string>(() => undefined),
        };
      };

      const extraction = createProvider(hangingBodyFetch).extract([createLabeledImage("FRONT")]);
      const expectedTimeout = expect(extraction).rejects.toMatchObject({
        code: HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
      } satisfies Partial<HuggingFaceDocumentExtractionError>);

      await jest.advanceTimersByTimeAsync(1_000);
      await expectedTimeout;

      expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects a response body that exceeds the structured-response limit", async () => {
    const oversizedBody = "x".repeat(HUGGING_FACE_MAX_RESPONSE_BYTES + 1);
    const fetchStub = createFetchStub(createFetchResponse(200, oversizedBody));

    await expect(
      createProvider(fetchStub.fetch).extract([createLabeledImage("FRONT")]),
    ).rejects.toMatchObject({
      code: HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    } satisfies Partial<HuggingFaceDocumentExtractionError>);
  });

  it("requires an explicit Hugging Face token, model/provider pair, and sane timeout", () => {
    const missingToken = { ...BASE_ENVIRONMENT };
    delete missingToken.HUGGINGFACE_API_TOKEN;
    expect(() => createAppConfiguration(missingToken, process.cwd())).toThrow(
      "HUGGINGFACE_API_TOKEN is required when KYC_DOCUMENT_PROVIDER=huggingface",
    );

    const missingModel = { ...BASE_ENVIRONMENT };
    delete missingModel.HUGGINGFACE_DOCUMENT_MODEL;
    expect(() => createAppConfiguration(missingModel, process.cwd())).toThrow(
      "HUGGINGFACE_DOCUMENT_MODEL is required when KYC_DOCUMENT_PROVIDER=huggingface",
    );

    expect(() =>
      createAppConfiguration(
        { ...BASE_ENVIRONMENT, HUGGINGFACE_DOCUMENT_MODEL: "Organization/DocumentModel:fastest" },
        process.cwd(),
      ),
    ).toThrow("HUGGINGFACE_DOCUMENT_MODEL must name an explicit model and provider");

    expect(() =>
      createAppConfiguration(
        { ...BASE_ENVIRONMENT, HUGGINGFACE_DOCUMENT_MODEL: "Organization/DocumentModel:cheapest" },
        process.cwd(),
      ),
    ).toThrow("HUGGINGFACE_DOCUMENT_MODEL must name an explicit model and provider");

    expect(() =>
      createAppConfiguration(
        { ...BASE_ENVIRONMENT, HUGGINGFACE_DOCUMENT_MODEL: "Organization/DocumentModel:preferred" },
        process.cwd(),
      ),
    ).toThrow("HUGGINGFACE_DOCUMENT_MODEL must name an explicit model and provider");

    expect(() =>
      createAppConfiguration(
        { ...BASE_ENVIRONMENT, HUGGINGFACE_DOCUMENT_TIMEOUT_MS: "120001" },
        process.cwd(),
      ),
    ).toThrow("HUGGINGFACE_DOCUMENT_TIMEOUT_MS must be between 1000 and 120000");
  });
});
