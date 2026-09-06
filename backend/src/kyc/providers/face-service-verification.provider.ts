import { Injectable, Logger } from "@nestjs/common";
import {
  APP_ENVIRONMENT,
  type AppConfiguration,
} from "../../config/app-config.service";
import {
  FACE_CAPTURE_FAILURE_CODE,
  FaceCaptureError,
} from "./local-human-face-verification.provider";
import type { FaceCaptureFailureCode } from "./local-human-face-verification.provider";
import type {
  FaceVerificationProvider,
  FaceVerificationResult,
} from "./face-verification.provider";

export const FACE_SERVICE_QUALITY_PATH = "/face/quality";
export const FACE_SERVICE_COMPARE_PATH = "/face/compare";

export interface FaceServiceFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface FaceServiceFetch {
  (input: string, init: RequestInit): Promise<FaceServiceFetchResponse>;
}

export interface FaceServiceSleep {
  (delayMs: number): Promise<void>;
}

const GLOBAL_FETCH: FaceServiceFetch = (input, init) => fetch(input, init);
const sleep: FaceServiceSleep = (delayMs) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export const FACE_SERVICE_RETRY = {
  MAX_ATTEMPTS: 3,
  BACKOFF_MS: [250, 500],
} as const;

const FACE_SERVICE_RETRYABLE_STATUS = {
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

type FaceServiceRetryReason = "network_or_timeout" | "server_gateway";

export function isRetryableFaceServiceStatus(status: number): boolean {
  return (
    status === FACE_SERVICE_RETRYABLE_STATUS.BAD_GATEWAY ||
    status === FACE_SERVICE_RETRYABLE_STATUS.SERVICE_UNAVAILABLE ||
    status === FACE_SERVICE_RETRYABLE_STATUS.GATEWAY_TIMEOUT
  );
}

class FaceServiceTimeoutError extends Error {
  constructor() {
    super("Face service request timed out");
    this.name = "FaceServiceTimeoutError";
  }
}

interface FaceServiceRequest {
  document_face: string;
  selfie: string;
}

interface FaceServiceRequestResult {
  response: FaceServiceFetchResponse;
  responseText: string | null;
}

interface FaceServiceQualityItem {
  quality: FaceServiceQuality;
  reason: FaceServiceQualityReason;
  face_width_px: number | null;
  laplacian_variance: number | null;
  action: FaceServiceQualityAction;
}

interface FaceServiceQualityResponse {
  document: FaceServiceQualityItem;
  selfie: FaceServiceQualityItem;
}

interface FaceServiceCompareResponse {
  match: boolean;
  similarity: number | null;
  // Informational label derived from remote cosine similarity; it is not the
  // local Human detector confidence and must not be used as that threshold.
  confidence: FaceServiceConfidence | null;
  quality_document: FaceServiceQuality;
  quality_selfie: FaceServiceQuality;
  action: FaceServiceCompareAction;
  reasons: Record<FaceServiceQualitySide, FaceServiceQualityReason>;
}

const FACE_SERVICE_COMPARE_ACTION = {
  MATCHED: "MATCHED",
  NO_MATCH: "NO_MATCH",
  NEEDS_REVIEW: "NEEDS_REVIEW",
} as const;

type FaceServiceCompareAction =
  (typeof FACE_SERVICE_COMPARE_ACTION)[keyof typeof FACE_SERVICE_COMPARE_ACTION];

const FACE_SERVICE_QUALITY = {
  HIGH: "HIGH",
  LOW: "LOW",
} as const;

type FaceServiceQuality = (typeof FACE_SERVICE_QUALITY)[keyof typeof FACE_SERVICE_QUALITY];

const FACE_SERVICE_QUALITY_CONTRACT = {
  HIGH: "HIGH",
  OK: "OK",
} as const;

const FACE_SERVICE_QUALITY_ACTION = {
  OK: "OK",
  NEEDS_REVIEW: "NEEDS_REVIEW",
} as const;

type FaceServiceQualityAction =
  (typeof FACE_SERVICE_QUALITY_ACTION)[keyof typeof FACE_SERVICE_QUALITY_ACTION];

const FACE_SERVICE_CONFIDENCE = {
  HIGH: "high",
  LOW: "low",
} as const;

type FaceServiceConfidence =
  (typeof FACE_SERVICE_CONFIDENCE)[keyof typeof FACE_SERVICE_CONFIDENCE];

const FACE_SERVICE_QUALITY_REASON = {
  OK: "ok",
  NO_FACE: "no_face",
  FACE_RESOLUTION_TOO_SMALL: "face_resolution_too_small",
  BLURRY: "blurry",
  ERROR: "error",
} as const;

const FACE_SERVICE_QUALITY_SIDE = {
  DOCUMENT: "document",
  SELFIE: "selfie",
} as const;

type FaceServiceQualitySide =
  (typeof FACE_SERVICE_QUALITY_SIDE)[keyof typeof FACE_SERVICE_QUALITY_SIDE];
type FaceServiceQualityReason =
  (typeof FACE_SERVICE_QUALITY_REASON)[keyof typeof FACE_SERVICE_QUALITY_REASON];
type FaceServiceQualityFailureReason = Exclude<
  FaceServiceQualityReason,
  (typeof FACE_SERVICE_QUALITY_REASON)["OK"]
>;

const FACE_SERVICE_QUALITY_FAILURE_CODE = {
  document: {
    [FACE_SERVICE_QUALITY_REASON.NO_FACE]: FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_NO_FACE,
    [FACE_SERVICE_QUALITY_REASON.FACE_RESOLUTION_TOO_SMALL]:
      FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_FACE_RESOLUTION_TOO_SMALL,
    [FACE_SERVICE_QUALITY_REASON.BLURRY]: FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_BLURRY,
    [FACE_SERVICE_QUALITY_REASON.ERROR]: FACE_CAPTURE_FAILURE_CODE.QUALITY_DOCUMENT_ERROR,
  },
  selfie: {
    [FACE_SERVICE_QUALITY_REASON.NO_FACE]: FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_NO_FACE,
    [FACE_SERVICE_QUALITY_REASON.FACE_RESOLUTION_TOO_SMALL]:
      FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_FACE_RESOLUTION_TOO_SMALL,
    [FACE_SERVICE_QUALITY_REASON.BLURRY]: FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_BLURRY,
    [FACE_SERVICE_QUALITY_REASON.ERROR]: FACE_CAPTURE_FAILURE_CODE.QUALITY_SELFIE_ERROR,
  },
} as const;

const FACE_SERVICE_METRIC_RANGE = {
  MIN_SIMILARITY: -1,
  MAX_SIMILARITY: 1,
  MIN_DISTANCE: 0,
  MAX_DISTANCE: 2,
} as const;

export interface FaceServiceProviderConfiguration {
  values: Pick<
    AppConfiguration,
    | "environment"
    | "faceMinimumSimilarity"
    | "faceServiceUrl"
    | "faceServiceTimeoutMs"
    | "faceApiKey"
  >;
  // The local euclidean-distance and Human detector-confidence settings are
  // intentionally absent from this remote provider contract.
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

export function calculateFaceServiceDistance(similarity: number): number | null {
  const distance = 1 - similarity;
  if (
    !Number.isFinite(distance) ||
    distance < FACE_SERVICE_METRIC_RANGE.MIN_DISTANCE ||
    distance > FACE_SERVICE_METRIC_RANGE.MAX_DISTANCE
  ) {
    return null;
  }

  return distance;
}

function parseQualityItem(value: unknown): FaceServiceQualityItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const { quality, reason, face_width_px, laplacian_variance, action } = value;
  const faceWidth = parseOptionalFiniteNumber(face_width_px);
  const laplacianVariance = parseOptionalFiniteNumber(laplacian_variance);
  if (faceWidth === undefined || laplacianVariance === undefined) {
    return null;
  }
  if (
    (quality !== FACE_SERVICE_QUALITY.HIGH && quality !== FACE_SERVICE_QUALITY.LOW) ||
    !isFaceServiceQualityReason(reason) ||
    (action !== FACE_SERVICE_QUALITY_ACTION.OK &&
      action !== FACE_SERVICE_QUALITY_ACTION.NEEDS_REVIEW)
  ) {
    return null;
  }
  if (
    (quality === FACE_SERVICE_QUALITY.HIGH &&
      (reason !== FACE_SERVICE_QUALITY_REASON.OK ||
        action !== FACE_SERVICE_QUALITY_ACTION.OK)) ||
    (quality === FACE_SERVICE_QUALITY.LOW &&
      (reason === FACE_SERVICE_QUALITY_REASON.OK ||
        action !== FACE_SERVICE_QUALITY_ACTION.NEEDS_REVIEW))
  ) {
    return null;
  }

  return {
    quality,
    reason,
    face_width_px: faceWidth,
    laplacian_variance: laplacianVariance,
    action,
  };
}

function isFaceServiceQualityReason(value: unknown): value is FaceServiceQualityReason {
  return (
    value === FACE_SERVICE_QUALITY_REASON.OK ||
    value === FACE_SERVICE_QUALITY_REASON.NO_FACE ||
    value === FACE_SERVICE_QUALITY_REASON.FACE_RESOLUTION_TOO_SMALL ||
    value === FACE_SERVICE_QUALITY_REASON.BLURRY ||
    value === FACE_SERVICE_QUALITY_REASON.ERROR
  );
}

function isFaceServiceCompareAction(value: unknown): value is FaceServiceCompareAction {
  return (
    value === FACE_SERVICE_COMPARE_ACTION.MATCHED ||
    value === FACE_SERVICE_COMPARE_ACTION.NO_MATCH ||
    value === FACE_SERVICE_COMPARE_ACTION.NEEDS_REVIEW
  );
}

function isFaceServiceConfidence(value: unknown): value is FaceServiceConfidence {
  return (
    value === FACE_SERVICE_CONFIDENCE.HIGH || value === FACE_SERVICE_CONFIDENCE.LOW
  );
}

function qualityFailureCode(
  side: FaceServiceQualitySide,
  reason: FaceServiceQualityReason,
): FaceCaptureFailureCode | null {
  if (reason === FACE_SERVICE_QUALITY_REASON.OK) {
    return null;
  }

  return FACE_SERVICE_QUALITY_FAILURE_CODE[side][reason as FaceServiceQualityFailureReason];
}

function parseQualityResponse(value: unknown): FaceServiceQualityResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const document = parseQualityItem(value.document);
  const selfie = parseQualityItem(value.selfie);
  if (document === null || selfie === null) {
    return null;
  }

  return { document, selfie };
}

function parseCompareResponse(value: unknown): FaceServiceCompareResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const { match, similarity, confidence, quality_document, quality_selfie, action, reasons } = value;
  if (typeof match !== "boolean") {
    return null;
  }
  const parsedSimilarity = parseOptionalFiniteNumber(similarity);
  if (parsedSimilarity === undefined) {
    return null;
  }
  if (
    parsedSimilarity !== null &&
    (parsedSimilarity < FACE_SERVICE_METRIC_RANGE.MIN_SIMILARITY ||
      parsedSimilarity > FACE_SERVICE_METRIC_RANGE.MAX_SIMILARITY ||
      calculateFaceServiceDistance(parsedSimilarity) === null)
  ) {
    return null;
  }
  if (confidence !== null && !isFaceServiceConfidence(confidence)) {
    return null;
  }
  if (
    (quality_document !== FACE_SERVICE_QUALITY.HIGH &&
      quality_document !== FACE_SERVICE_QUALITY.LOW) ||
    (quality_selfie !== FACE_SERVICE_QUALITY.HIGH &&
      quality_selfie !== FACE_SERVICE_QUALITY.LOW) ||
    !isFaceServiceCompareAction(action)
  ) {
    return null;
  }
  if (!isRecord(reasons)) {
    return null;
  }
  const reasonKeys = Object.keys(reasons);
  if (
    reasonKeys.length !== 2 ||
    !reasonKeys.includes(FACE_SERVICE_QUALITY_SIDE.DOCUMENT) ||
    !reasonKeys.includes(FACE_SERVICE_QUALITY_SIDE.SELFIE)
  ) {
    return null;
  }
  for (const reason of Object.values(reasons)) {
    if (!isFaceServiceQualityReason(reason)) {
      return null;
    }
  }
  const hasUsableQualityReasons =
    reasons[FACE_SERVICE_QUALITY_SIDE.DOCUMENT] === FACE_SERVICE_QUALITY_REASON.OK &&
    reasons[FACE_SERVICE_QUALITY_SIDE.SELFIE] === FACE_SERVICE_QUALITY_REASON.OK;
  if (action !== FACE_SERVICE_COMPARE_ACTION.NEEDS_REVIEW) {
    if (
      quality_document !== FACE_SERVICE_QUALITY.HIGH ||
      quality_selfie !== FACE_SERVICE_QUALITY.HIGH ||
      parsedSimilarity === null ||
      confidence === null ||
      !hasUsableQualityReasons
    ) {
      return null;
    }
  } else if (parsedSimilarity !== null || confidence !== null || match) {
    return null;
  }

  return {
    match,
    similarity: parsedSimilarity,
    confidence,
    quality_document,
    quality_selfie,
    action,
    reasons: reasons as Record<FaceServiceQualitySide, FaceServiceQualityReason>,
  };
}

@Injectable()
export class FaceServiceVerificationProvider implements FaceVerificationProvider {
  private readonly faceServiceUrl: string;
  private readonly faceServiceTimeoutMs: number;
  private readonly faceApiKey: string;
  private readonly faceMinimumSimilarity: number;
  private readonly logger = new Logger(FaceServiceVerificationProvider.name);
  private readonly sleepImplementation: FaceServiceSleep;

  constructor(
    configuration: FaceServiceProviderConfiguration,
    private readonly fetchImplementation: FaceServiceFetch = GLOBAL_FETCH,
    sleepImplementation: FaceServiceSleep = sleep,
  ) {
    this.faceServiceUrl = configuration.values.faceServiceUrl;
    this.faceServiceTimeoutMs = configuration.values.faceServiceTimeoutMs;
    this.faceApiKey = configuration.values.faceApiKey;
    this.faceMinimumSimilarity = configuration.values.faceMinimumSimilarity;
    this.sleepImplementation = sleepImplementation;

    if (
      configuration.values.environment === APP_ENVIRONMENT.PRODUCTION &&
      new URL(this.faceServiceUrl).protocol !== "https:"
    ) {
      throw new Error("FACE_SERVICE_URL must use https in production");
    }
  }

  async verify(documentImage: Buffer, selfieImage: Buffer): Promise<FaceVerificationResult> {
    const deadline = Date.now() + this.faceServiceTimeoutMs;
    const request: FaceServiceRequest = {
      document_face: documentImage.toString("base64"),
      selfie: selfieImage.toString("base64"),
    };

    const quality = await this.post(
      FACE_SERVICE_QUALITY_PATH,
      request,
      parseQualityResponse,
      deadline,
    );
    if (
      quality.document.quality !== FACE_SERVICE_QUALITY_CONTRACT.HIGH ||
      quality.document.action !== FACE_SERVICE_QUALITY_CONTRACT.OK
    ) {
      throw new FaceCaptureError(
        qualityFailureCode(FACE_SERVICE_QUALITY_SIDE.DOCUMENT, quality.document.reason) ??
          FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
      );
    }
    if (
      quality.selfie.quality !== FACE_SERVICE_QUALITY_CONTRACT.HIGH ||
      quality.selfie.action !== FACE_SERVICE_QUALITY_CONTRACT.OK
    ) {
      throw new FaceCaptureError(
        qualityFailureCode(FACE_SERVICE_QUALITY_SIDE.SELFIE, quality.selfie.reason) ??
          FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE,
      );
    }

    const compare = await this.post(
      FACE_SERVICE_COMPARE_PATH,
      request,
      parseCompareResponse,
      deadline,
    );
    if (compare.quality_document !== FACE_SERVICE_QUALITY_CONTRACT.HIGH) {
      throw new FaceCaptureError(
        qualityFailureCode(FACE_SERVICE_QUALITY_SIDE.DOCUMENT, compare.reasons.document) ??
          FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW,
      );
    }
    if (compare.quality_selfie !== FACE_SERVICE_QUALITY_CONTRACT.HIGH) {
      throw new FaceCaptureError(
        qualityFailureCode(FACE_SERVICE_QUALITY_SIDE.SELFIE, compare.reasons.selfie) ??
          FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW,
      );
    }
    if (compare.action === FACE_SERVICE_COMPARE_ACTION.NEEDS_REVIEW) {
      if (compare.match || compare.similarity !== null) {
        throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
      }
      // The service could not produce embeddings for a comparison. This is
      // equivalent to the local provider being unable to embed the faces.
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE);
    }
    if (
      compare.action !== FACE_SERVICE_COMPARE_ACTION.MATCHED &&
      compare.action !== FACE_SERVICE_COMPARE_ACTION.NO_MATCH
    ) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }
    if (compare.similarity === null) {
      // Fail closed: a match must never be approved without a numeric metric.
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }
    const distance = calculateFaceServiceDistance(compare.similarity);
    if (distance === null) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }
    const matchesThreshold = compare.similarity >= this.faceMinimumSimilarity;
    if (compare.match !== matchesThreshold) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }
    if (
      (compare.action === FACE_SERVICE_COMPARE_ACTION.MATCHED &&
        (!compare.match || !matchesThreshold)) ||
      (compare.action === FACE_SERVICE_COMPARE_ACTION.NO_MATCH &&
        (compare.match || matchesThreshold))
    ) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }

    return {
      documentFaceCount: 1,
      selfieFaceCount: 1,
      accepted: compare.match,
      similarity: compare.similarity,
      // The face service expresses similarity as a cosine in [-1, 1]. Its
      // equivalent distance keeps the "higher is farther apart" semantics of
      // the local euclidean metric (range [0, 2]).
      distance,
    };
  }

  private async post<T>(
    path: string,
    body: FaceServiceRequest,
    parse: (value: unknown) => T | null,
    deadline: number,
  ): Promise<T> {
    for (let attempt = 1; attempt <= FACE_SERVICE_RETRY.MAX_ATTEMPTS; attempt += 1) {
      const remainingBudgetMs = deadline - Date.now();
      if (remainingBudgetMs <= 0) {
        throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
      }

      const attemptsRemaining = FACE_SERVICE_RETRY.MAX_ATTEMPTS - attempt + 1;
      const attemptTimeoutMs = Math.max(
        1,
        Math.floor(remainingBudgetMs / attemptsRemaining),
      );

      try {
        const { response, responseText } = await this.fetchOnce(path, body, attemptTimeoutMs);
        if (!response.ok) {
          if (!isRetryableFaceServiceStatus(response.status)) {
            throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
          }
          if (attempt === FACE_SERVICE_RETRY.MAX_ATTEMPTS) {
            throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
          }

          await this.waitBeforeRetry(path, attempt, "server_gateway", deadline);
          continue;
        }

        let parsed: unknown;
        let value: T | null;
        try {
          parsed = JSON.parse(responseText ?? "");
          value = parse(parsed);
        } catch {
          throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
        }

        if (value === null) {
          throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
        }

        return value;
      } catch (error: unknown) {
        if (error instanceof FaceCaptureError) {
          throw error;
        }
        if (attempt === FACE_SERVICE_RETRY.MAX_ATTEMPTS || Date.now() >= deadline) {
          throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
        }

        await this.waitBeforeRetry(path, attempt, "network_or_timeout", deadline);
      }
    }

    throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
  }

  private async fetchOnce(
    path: string,
    body: FaceServiceRequest,
    timeoutMs: number,
  ): Promise<FaceServiceRequestResult> {
    const controller = new AbortController();
    let rejectTimeout: ((reason?: unknown) => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout?.(new FaceServiceTimeoutError());
    }, timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-API-Key": this.faceApiKey,
      };
      const response = await Promise.race([
        this.fetchImplementation(`${this.faceServiceUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      if (!response.ok) {
        return { response, responseText: null };
      }

      const responseText = await Promise.race([response.text(), timeoutPromise]);
      return { response, responseText };
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async waitBeforeRetry(
    path: string,
    attempt: number,
    reason: FaceServiceRetryReason,
    deadline: number,
  ): Promise<void> {
    const remainingBudgetMs = deadline - Date.now();
    if (remainingBudgetMs <= 0) {
      return;
    }

    const backoffMs = FACE_SERVICE_RETRY.BACKOFF_MS[attempt - 1] ?? 0;
    const delayMs = Math.min(backoffMs, remainingBudgetMs);
    this.logger.warn(
      `Face service transient failure path=${path} reason=${reason}; ` +
        `retry=${attempt + 1}/${FACE_SERVICE_RETRY.MAX_ATTEMPTS}`,
    );
    await this.sleepImplementation(delayMs);
  }
}
