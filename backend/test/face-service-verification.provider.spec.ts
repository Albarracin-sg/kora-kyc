jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
}));

import {
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
  FaceServiceVerificationProvider,
  type FaceServiceFetch,
  type FaceServiceFetchResponse,
} from "../src/kyc/providers/face-service-verification.provider";

const BASE_ENVIRONMENT: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://localhost:5432/kora",
  JWT_SECRET: "test-jwt-secret",
  KYC_DOCUMENT_HASH_PEPPER: "test-pepper",
  KYC_DOCUMENT_PROVIDER: "local",
  FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
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
  similarity: 0.4360883173082909,
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
): FaceServiceVerificationProvider {
  const configuration = createAppConfiguration(BASE_ENVIRONMENT, process.cwd());
  return new FaceServiceVerificationProvider({ values: configuration }, fetchImplementation);
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
    expect(qualityCall?.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(compareCall?.init.headers).toEqual({ "Content-Type": "application/json" });

    const expectedBody: FaceServiceRequestBody = {
      document_face: DOCUMENT_IMAGE.toString("base64"),
      selfie: SELFIE_IMAGE.toString("base64"),
    };
    expect(parseRequest(qualityCall)).toEqual(expectedBody);
    expect(parseRequest(compareCall)).toEqual(expectedBody);
  });

  it("returns a match with cosine similarity and its equivalent distance", async () => {
    const fetchStub = createFetchStub(
      createFetchResponse(200, QUALITY_OK_RESPONSE),
      createFetchResponse(200, COMPARE_MATCH_RESPONSE),
    );

    const result = await createProvider(fetchStub.fetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE);

    expect(result.accepted).toBe(true);
    expect(result.similarity).toBeCloseTo(0.4360883173082909, 12);
    expect(result.distance).toBeCloseTo(0.5639116826917091, 12);
    expect(result.documentFaceCount).toBe(1);
    expect(result.selfieFaceCount).toBe(1);
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
      FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW,
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
      FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW,
    );
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
      FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW,
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

  it("fails closed when the face service is unreachable", async () => {
    const unreachableFetch: FaceServiceFetch = async (): Promise<FaceServiceFetchResponse> => {
      throw new Error("connection refused");
    };

    await expectFaceCaptureError(
      createProvider(unreachableFetch).verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE,
    );
  });

  it("aborts a timed-out request without retrying", async () => {
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

      expect(fetchAttempts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
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