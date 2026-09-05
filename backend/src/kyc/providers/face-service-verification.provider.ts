import { Injectable } from "@nestjs/common";
import type { AppConfiguration } from "../../config/app-config.service";
import {
  FACE_CAPTURE_FAILURE_CODE,
  FaceCaptureError,
} from "./local-human-face-verification.provider";
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

const GLOBAL_FETCH: FaceServiceFetch = (input, init) => fetch(input, init);

interface FaceServiceRequest {
  document_face: string;
  selfie: string;
}

interface FaceServiceQualityItem {
  quality: string;
  reason: string;
  face_width_px: number | null;
  laplacian_variance: number | null;
  action: string;
}

interface FaceServiceQualityResponse {
  document: FaceServiceQualityItem;
  selfie: FaceServiceQualityItem;
}

interface FaceServiceCompareResponse {
  match: boolean;
  similarity: number | null;
  confidence: string | null;
  quality_document: string;
  quality_selfie: string;
  action: string;
  reasons: Record<string, string>;
}

export interface FaceServiceProviderConfiguration {
  values: Pick<AppConfiguration, "faceServiceUrl" | "faceServiceTimeoutMs" | "faceApiKey">;
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
  if (typeof quality !== "string" || typeof reason !== "string" || typeof action !== "string") {
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
  if (confidence !== null && typeof confidence !== "string") {
    return null;
  }
  if (
    typeof quality_document !== "string" ||
    typeof quality_selfie !== "string" ||
    typeof action !== "string"
  ) {
    return null;
  }
  if (!isRecord(reasons)) {
    return null;
  }
  for (const reason of Object.values(reasons)) {
    if (typeof reason !== "string") {
      return null;
    }
  }

  return {
    match,
    similarity: parsedSimilarity,
    confidence: confidence as string | null,
    quality_document,
    quality_selfie,
    action,
    reasons: reasons as Record<string, string>,
  };
}

@Injectable()
export class FaceServiceVerificationProvider implements FaceVerificationProvider {
  private readonly faceServiceUrl: string;
  private readonly faceServiceTimeoutMs: number;
  private readonly faceApiKey: string;

  constructor(
    configuration: FaceServiceProviderConfiguration,
    private readonly fetchImplementation: FaceServiceFetch = GLOBAL_FETCH,
  ) {
    this.faceServiceUrl = configuration.values.faceServiceUrl;
    this.faceServiceTimeoutMs = configuration.values.faceServiceTimeoutMs;
    this.faceApiKey = configuration.values.faceApiKey;
  }

  async verify(documentImage: Buffer, selfieImage: Buffer): Promise<FaceVerificationResult> {
    const request: FaceServiceRequest = {
      document_face: documentImage.toString("base64"),
      selfie: selfieImage.toString("base64"),
    };

    const quality = await this.post(FACE_SERVICE_QUALITY_PATH, request, parseQualityResponse);
    if (quality.document.quality !== "HIGH" || quality.selfie.quality !== "HIGH") {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW);
    }

    const compare = await this.post(FACE_SERVICE_COMPARE_PATH, request, parseCompareResponse);
    if (compare.quality_document !== "HIGH" || compare.quality_selfie !== "HIGH") {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.QUALITY_LOW);
    }
    if (compare.action === "NEEDS_REVIEW") {
      // The service could not produce embeddings for a comparison. This is
      // equivalent to the local provider being unable to embed the faces.
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE);
    }
    if (compare.action !== "MATCHED" && compare.action !== "NO_MATCH") {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }
    if (compare.similarity === null) {
      // Fail closed: a match must never be approved without a numeric metric.
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
      distance: 1 - compare.similarity,
    };
  }

  private async post<T>(
    path: string,
    body: FaceServiceRequest,
    parse: (value: unknown) => T | null,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.faceServiceTimeoutMs);
    let response: FaceServiceFetchResponse;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-API-Key": this.faceApiKey,
      };
      response = await this.fetchImplementation(`${this.faceServiceUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
    }

    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.FACE_SERVICE_UNAVAILABLE);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }

    const value = parse(parsed);
    if (value === null) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.INVALID_RESPONSE);
    }

    return value;
  }
}
