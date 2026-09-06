jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
  Logger: class {
    constructor(_context?: string) {}

    warn(): void {}
  },
}));

import {
  APP_ENVIRONMENT,
  FACE_VERIFICATION_PROVIDER,
  createAppConfiguration,
} from "../src/config/app-config.service";
import {
  FACE_CAPTURE_FAILURE_CODE,
  FaceCaptureError,
} from "../src/kyc/providers/local-human-face-verification.provider";
import {
  FACE_SERVICE_COMPARE_PATH,
  FACE_SERVICE_QUALITY_PATH,
  FACE_SERVICE_RETRY,
  FaceServiceVerificationProvider,
  calculateFaceServiceDistance,
  type FaceServiceFetch,
  type FaceServiceFetchResponse,
  type FaceServiceSleep,
  isRetryableFaceServiceStatus,
} from "../src/kyc/providers/face-service-verification.provider";

const BASE_ENVIRONMENT: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://localhost:5432/kora",
  JWT_SECRET: "test-jwt-secret",
  KYC_DOCUMENT_HASH_PEPPER: "test-pepper",
  KYC_DOCUMENT_PROVIDER: "local",
  FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
  FACE_API_KEY: "test-face-api-key",
  KYC_FACE_MIN_SIMILARITY: "0.72",
};

const DOCUMENT_IMAGE = Buffer.from("synthetic-document-image");
const SELFIE_IMAGE = Buffer.from("synthetic-selfie-image");

const QUALITY_OK_RESPONSE = JSON.stringify({
  document: {
    quality: "HIGH",
    reason: "ok",
    face_width_px: 210,
    laplacian_variance: 88.2,
    action: "OK",
  },
  selfie: {
    quality: "HIGH",
    reason: "ok",
    face_width_px: 738,
    laplacian_variance: 38.2,
    action: "OK",
  },
});

interface QualityPayload {
  quality: string;
  reason: string;
  face_width_px: number | null;
  laplacian_variance: number | null;
  action: string;
}

function createQualityResponse(
  document: Partial<QualityPayload>,
  selfie: Partial<QualityPayload>,
): string {
  return JSON.stringify({
    document: {
      quality: "HIGH",
      reason: "ok",
      face_width_px: 210,
      laplacian_variance: 88.2,
      action: "OK",
      ...document,
    },
    selfie: {
      quality: "HIGH",
      reason: "ok",
      face_width_px: 738,
      laplacian_variance: 38.2,
      action: "OK",
      ...selfie,
    },
  });
}

const COMPARE_MATCH_RESPONSE = JSON.stringify({
  match: true,
  similarity: 0.8,
  confidence: "low",
  quality_document: "HIGH",
  quality_selfie: "HIGH",
  action: "MATCHED",
  reasons: { document: "ok", selfie: "ok" },
});

const COMPARE_NO_MATCH_RESPONSE = JSON.stringify({
  match: false,
  similarity: 0.12,
  confidence: "low",
  quality_document: "HIGH",
  quality_selfie: "HIGH",
  action: "NO_MATCH",
  reasons: { document: "ok", selfie: "ok" },
});

interface CapturedFetchCall {
  input: string;
  init: RequestInit;
}

interface FetchStub {
  fetch: FaceServiceFetch;
  calls: CapturedFetchCall[];
}

function createFetchResponse(status: number, responseText: string): FaceServiceFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async (): Promise<string> => responseText,
  };
}

function createFetchStub(...responses: FaceServiceFetchResponse[]): FetchStub {
  const calls: CapturedFetchCall[] = [];
  let index = 0;
  return {
    fetch: async (input: string, init: RequestInit): Promise<FaceServiceFetchResponse> => {
      calls.push({ input, init });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response === undefined) {
        throw new Error("fetch stub exhausted");
      }
      return response;
    },
    calls,
  };
}

interface FaceServiceRequestBody {
  document_face: string;
  selfie: string;
}

function parseRequest(call: CapturedFetchCall | undefined): FaceServiceRequestBody {
  if (!call || typeof call.init.body !== "string") {
    throw new Error("Expected a JSON request body");
  }

  return JSON.parse(call.init.body) as FaceServiceRequestBody;
}

function createProvider(
  fetchImplementation: FaceServiceFetch,
  environment: NodeJS.ProcessEnv = {},
  sleepImplementation?: FaceServiceSleep,
): FaceServiceVerificationProvider {
  const configuration = createAppConfiguration(
    { ...BASE_ENVIRONMENT, ...environment },
    process.cwd(),
  );
  return new FaceServiceVerificationProvider(
    { values: configuration },
    fetchImplementation,
    sleepImplementation,
  );
}

function expectFaceCaptureError(
  promise: Promise<unknown>,
  code: (typeof FACE_CAPTURE_FAILURE_CODE)[keyof typeof FACE_CAPTURE_FAILURE_CODE],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: "FaceCaptureError",
    code,
  } satisfies Partial<FaceCaptureError>);
}

describe("Face service verification provider", () => {
  it("sends both images as base64 JSON to the quality and compare endpoints", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, COMPARE_MATCH_RESPONSE),
    );

    await createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);

    expect(fetchStub.calls).toHaveLength(2);
    const [qualityCall, compareCall] = fetchStub.calls;
    expect(qualityCall?.input).toBe(`http://localhost:8000${FACE_SERVICE_QUALITY_PATH}`);
    expect(compareCall?.input).toBe(`http://localhost:8000${FACE_SERVICE_COMPARE_PATH}`);
    expect(qualityCall?.init.method).toBe("POST");
    expect(compareCall?.init.method).toBe("POST");
    expect(qualityCall?.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-API-Key": "test-face-api-key",
    });
    expect(compareCall?.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-API-Key": "test-face-api-key",
    });

    const expectedBody: FaceServiceRequestBody = {
      document_face: DOCUMENT_IMAGE.toString("base64"),
      selfie: SELFIE_IMAGE.toString("base64"),
    };
    expect(parseRequest(qualityCall)).toEqual(expectedBody);
    expect(parseRequest(compareCall)).toEqual(expectedBody);
  });

  it("sends an X-API-Key header on every call when FACE_API_KEY is set", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, COMPARE_MATCH_RESPONSE),
    );

    await createProvider(fetchStub.fetch, { FACE_API_KEY: "test-face-api-key" }).verify(
      DOCUMENT_IMAGE,
      SELFIE_IMAGE,
    );

    expect(fetchStub.calls).toHaveLength(2);
    for (const call of fetchStub.calls) {
      expect(call.init.headers).toEqual({
        "Content-Type": "application/json",
        "X-API-Key": "test-face-api-key",
      });
    }
  });

  it("returns a match with cosine similarity and its equivalent distance", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, COMPARE_MATCH_RESPONSE),
    );

    const result = await createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);

    expect(result.accepted).toBe(true);
    expect(result.similarity).toBeCloseTo(0.8, 12);
    expect(result.distance).toBeCloseTo(0.2, 12);
    expect(result.documentFaceCount).toBe(1);
    expect(result.selfieFaceCount).toBe(1);
  });

  it("uses remote quality and cosine similarity without applying local-only thresholds", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(
        200,
        JSON.stringify({
          match: true,
          similarity: 0.72,
          confidence: "low",
          quality_document: "HIGH",
          quality_selfie: "HIGH",
          action: "MATCHED",
          reasons: { document: "ok", selfie: "ok" },
        }),
      ),
    );

    const result = await createProvider(fetchStub.fetch, {
      KYC_LOCAL_FACE_MAX_DISTANCE: "0.01",
      KYC_LOCAL_FACE_MIN_CONFIDENCE: "1",
    }).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);

    expect(result.accepted).toBe(true);
    expect(result.similarity).toBe(0.72);
    expect(result.distance).toBeCloseTo(0.28, 12);
  });

  it("fails closed when the submitted document image is not HIGH quality", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(
        200,
        createQualityResponse({ quality: "LOW", reason: "blurry", action: "NEEDS_REVIEW" }, {}),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_BLURRY,
    );

    expect(fetchStub.calls).toHaveLength(1);
  });

  it("fails closed when the submitted selfie is not HIGH quality", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(
        200,
        createQualityResponse({}, { quality: "LOW", reason: "blurry", action: "NEEDS_REVIEW" }),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_BLURRY,
    );
  });

  it.each([
    ["document", "no_face", FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_NO_FACE],
    [
      "document",
      "face_resolution_too_small",
      FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_FACE_RESOLUTION_TOO_SMALL,
    ],
    ["document", "blurry", FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_BLURRY],
    ["document", "error", FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_ERROR],
    ["selfie", "no_face", FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_NO_FACE],
    [
      "selfie",
      "face_resolution_too_small",
      FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_FACE_RESOLUTION_TOO_SMALL,
    ],
    ["selfie", "blurry", FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_BLURRY],
    ["selfie", "error", FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_ERROR],
  ] as const)("maps %s %s to its canonical safe failure code", async (side, reason, code) => {
    const lowQuality = { quality: "LOW", reason, action: "NEEDS_REVIEW" };
    const document = side === "document" ? lowQuality : {};
    const selfie = side === "selfie" ? lowQuality : {};
    const fetchStub = createFetchStub(
      createFetchResponse(200, createQualityResponse(document, selfie)),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      code,
    );
    expect(fetchStub.calls).toHaveLength(1);
  });

  it("does not compare when HIGH quality is paired with a non-OK action", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(
        200,
        createQualityResponse({ action: "NEEDS_REVIEW" }, {}),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );

    expect(fetchStub.calls).toHaveLength(1);
  });

  it("fails closed when the compare response downgrades a side to LOW quality", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(
        200,
        JSON.stringify({
          match: true,
          similarity: 0.8,
          confidence: "low",
          quality_document: "LOW",
          quality_selfie: "HIGH",
          action: "NEEDS_REVIEW",
          reasons: { document: "blurry", selfie: "ok" },
        }),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it.each([
    ["document", { document: "blurry", selfie: "ok" }],
    ["selfie", { document: "ok", selfie: "no_face" }],
  ] as const)("rejects a terminal compare response with a non-OK %s reason", (_side, reasons) => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(
        200,
        JSON.stringify({
          match: true,
          similarity: 0.8,
          confidence: "high",
          quality_document: "HIGH",
          quality_selfie: "HIGH",
          action: "MATCHED",
          reasons,
        }),
      ),
    );

    return expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("fails closed when the face service cannot produce a comparison", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(
        200,
        JSON.stringify({
          match: false,
          similarity: null,
          confidence: null,
          quality_document: "HIGH",
          quality_selfie: "HIGH",
          action: "NEEDS_REVIEW",
          reasons: { document: "ok", selfie: "ok" },
        }),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("fails closed on an HTTP error from the face service", async () => {
    const fetchStub = createFetchStub(createFetchResponse(500, "internal error"));

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE,
    );
  });

  it.each([502, 503, 504])("retries a transient gateway status (%s)", async (status) => {
    const fetchStub = createFetchStub(
      createFetchResponse(status, "gateway unavailable"),
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, COMPARE_MATCH_RESPONSE),
    );

    const result = await createProvider(fetchStub.fetch, {}, async () => undefined).verify(
      DOCUMENT_IMAGE,
      SELFIE_IMAGE,
    );

    expect(result.accepted).toBe(true);
    expect(fetchStub.calls).toHaveLength(3);
  });

  it.each([400, 401, 403, 500])("does not retry non-transient HTTP status (%s)", async (status) => {
    const fetchStub = createFetchStub(createFetchResponse(status, "request failed"));

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch, {}, async () => undefined).verify(
        DOCUMENT_IMAGE,
        SELFIE_IMAGE,
      ),
      FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE,
    );

    expect(fetchStub.calls).toHaveLength(1);
  });

  it("retries a network failure and then continues with the normal comparison", async () => {
    let attempts = 0;
    const fetchImplementation: FaceServiceFetch = async (
      input: string,
      init: RequestInit,
    ): Promise<FaceServiceFetchResponse> => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("connection refused");
      }
      const response =
        attempts === 2
          ? createFetchResponse(200, QUALITY_OK_RESPONSE)
          : createFetchResponse(200, COMPARE_MATCH_RESPONSE);
      void input;
      void init;
      return response;
    };

    const result = await createProvider(fetchImplementation, {}, async () => undefined).verify(
      DOCUMENT_IMAGE,
      SELFIE_IMAGE,
    );

    expect(result.accepted).toBe(true);
    expect(attempts).toBe(3);
  });

  it("exposes only the configured gateway statuses as retryable", () => {
    expect(isRetryableFaceServiceStatus(502)).toBe(true);
    expect(isRetryableFaceServiceStatus(503)).toBe(true);
    expect(isRetryableFaceServiceStatus(504)).toBe(true);
    expect(isRetryableFaceServiceStatus(500)).toBe(false);
    expect(isRetryableFaceServiceStatus(401)).toBe(false);
  });

  it("fails closed when the face service is unreachable", async () => {
    const unreachableFetch: FaceServiceFetch = async (): Promise<FaceServiceFetchResponse> => {
      throw new Error("connection refused");
    };

    await expectFaceCaptureError(
      createProvider(unreachableFetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE,
    );
  });

  it("retries timed-out requests within the single bounded verification budget", async () => {
    jest.useFakeTimers();
    try {
      let fetchAttempts = 0;
      const timeoutFetch: FaceServiceFetch =
        async (_input: string, init: RequestInit): Promise<FaceServiceFetchResponse> => {
          fetchAttempts += 1;
          return new Promise<FaceServiceFetchResponse>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("synthetic request abort")),
              { once: true },
            );
          });
        };
      const verification = createProvider(timeoutFetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);
      const expectedTimeout = expectFaceCaptureError(
        verification,
        FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE,
      );

      await jest.advanceTimersByTimeAsync(30_000);

      await expectedTimeout;

      expect(fetchAttempts).toBe(FACE_SERVICE_RETRY.MAX_ATTEMPTS);
    } finally {
      jest.useRealTimers();
    }
  });

  it("times out when response headers arrive but the response body never resolves", async () => {
    jest.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | null = null;
      const hangingBodyFetch: FaceServiceFetch = async (
        _input: string,
        init: RequestInit,
      ): Promise<FaceServiceFetchResponse> => {
        capturedSignal = init.signal ?? null;
        return {
          ok: true,
          status: 200,
          text: (): Promise<string> => new Promise<string>(() => undefined),
        };
      };

      const verification = createProvider(hangingBodyFetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);
      const expectedTimeout = expectFaceCaptureError(
        verification,
        FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE,
      );

      await jest.advanceTimersByTimeAsync(30_000);
      await expectedTimeout;

      expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects an HTTP face service URL before sending credentials in production", () => {
    expect(
      () =>
        new FaceServiceVerificationProvider({
          values: {
            environment: APP_ENVIRONMENT.PRODUCTION,
            faceMinimumSimilarity: 0.72,
            faceServiceUrl: "http://face.internal",
            faceServiceTimeoutMs: 30_000,
            faceApiKey: "test-face-api-key",
          },
        }),
    ).toThrow("FACE_SERVICE_URL must use https in production");
  });

  it("fails closed on a malformed response body", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, "not-json"),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("never approves a match without a numeric similarity", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(
        200,
        JSON.stringify({
          match: true,
          similarity: null,
          confidence: "low",
          quality_document: "HIGH",
          quality_selfie: "HIGH",
          action: "MATCHED",
          reasons: { document: "ok", selfie: "ok" },
        }),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("rejects a MATCHED response below the configured similarity threshold", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: true,
        similarity: 0.01,
        confidence: "low",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "MATCHED",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("accepts similarity exactly at the configured inclusive threshold", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: true,
        similarity: 0.72,
        confidence: "high",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "MATCHED",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    const result = await createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);

    expect(result.accepted).toBe(true);
    expect(result.similarity).toBe(0.72);
  });

  it("rejects a NO_MATCH response when similarity is above the threshold", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: false,
        similarity: 0.8,
        confidence: "high",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "NO_MATCH",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("rejects NEEDS_REVIEW when it contains a numeric similarity", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: false,
        similarity: 0.01,
        confidence: "low",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "NEEDS_REVIEW",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it.each([2, -2])("rejects similarity outside the cosine range: %s", async (similarity) => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: true,
        similarity,
        confidence: "low",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "MATCHED",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("rejects a MATCHED response when match is false", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: false,
        similarity: 0.8,
        confidence: "high",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "MATCHED",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("rejects a NO_MATCH response when match is true", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: true,
        similarity: 0.8,
        confidence: "high",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "NO_MATCH",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it("rejects a NEEDS_REVIEW response when match is true", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, JSON.stringify({
        match: true,
        similarity: 0.8,
        confidence: "high",
        quality_document: "HIGH",
        quality_selfie: "HIGH",
        action: "NEEDS_REVIEW",
        reasons: { document: "ok", selfie: "ok" },
      })),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -2, 2])(
    "rejects an invalid derived distance for similarity %s",
    (similarity) => {
      expect(calculateFaceServiceDistance(similarity)).toBeNull();
    },
  );

  it("returns a no-match without approving the verification", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, COMPARE_NO_MATCH_RESPONSE),
    );

    const result = await createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);

    expect(result.accepted).toBe(false);
    expect(result.similarity).toBeCloseTo(0.12, 12);
    expect(result.distance).toBeCloseTo(0.88, 12);
    expect(result.documentFaceCount).toBe(1);
    expect(result.selfieFaceCount).toBe(1);
  });

  it("fails closed when the quality response does not match the schema", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(
        200,
        JSON.stringify({
          document: { quality: "HIGH" },
          selfie: { quality: "HIGH" },
        }),
      ),
    );

    await expectFaceCaptureError(
      createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
    );
  });
});
