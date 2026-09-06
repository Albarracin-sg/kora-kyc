import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AppConfiguration } from "../../config/app-config.service";

const OPENCODE_GO_PROVIDER = "opencode-go";
const OPENCODE_GO_MODEL_PREFIX = "opencode-go/";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MAX_RESPONSE_BYTES = 64 * 1024;

export const FACE_AI_VERDICT = {
  SAME_PERSON: "same_person",
  DIFFERENT_PERSON: "different_person",
  NEEDS_REVIEW: "needs_review",
} as const;

export type FaceAiVerdict = (typeof FACE_AI_VERDICT)[keyof typeof FACE_AI_VERDICT];

export interface FaceAiVerificationResult {
  verdict: FaceAiVerdict;
  similarityPercent: number | null;
  summary: string;
  provider: string;
  model: string;
}

export interface FaceAiVerificationProvider {
  verify(documentFront: Buffer, selfie: Buffer): Promise<FaceAiVerificationResult>;
}

export interface FaceAiFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface FaceAiFetch {
  (input: string, init: RequestInit): Promise<FaceAiFetchResponse>;
}

export const FACE_AI_FAILURE = {
  API_KEY_MISSING: "API_KEY_MISSING",
  BASE_URL_MISSING: "BASE_URL_MISSING",
  MODEL_MISSING: "MODEL_MISSING",
  REQUEST_FAILED: "REQUEST_FAILED",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
} as const;

export type FaceAiFailureCode = (typeof FACE_AI_FAILURE)[keyof typeof FACE_AI_FAILURE];

export class FaceAiVerificationError extends Error {
  constructor(readonly code: FaceAiFailureCode, readonly httpStatus?: number) {
    super(`AI face verification failed: ${code}`);
    this.name = "FaceAiVerificationError";
  }
}

const FACE_AI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: [FACE_AI_VERDICT.SAME_PERSON, FACE_AI_VERDICT.DIFFERENT_PERSON, FACE_AI_VERDICT.NEEDS_REVIEW],
    },
    similarity_percent: {
      anyOf: [
        { type: "number", minimum: 0, maximum: 100 },
        { type: "null" },
      ],
    },
    summary: { type: "string", minLength: 1, maxLength: 800 },
  },
  required: ["verdict", "similarity_percent", "summary"],
  additionalProperties: false,
} as const;

interface FaceAiProviderConfig {
  values: Pick<
    AppConfiguration,
    | "openCodeGoApiKey"
    | "openCodeGoBaseUrl"
    | "openCodeGoDocumentModel"
    | "openCodeGoDocumentTimeoutMs"
  >;
}

interface ChatMessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ChatCompletionRequest {
  model: string;
  temperature: number;
  messages: Array<{ role: "user"; content: ChatMessageContent[] }>;
  response_format: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: true;
      schema: typeof FACE_AI_RESPONSE_SCHEMA;
    };
  };
}

@Injectable()
export class OpenCodeGoFaceAiVerificationProvider implements FaceAiVerificationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiModel: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FaceAiFetch;

  constructor(config: FaceAiProviderConfig, fetchImplementation?: FaceAiFetch) {
    const { openCodeGoApiKey, openCodeGoBaseUrl, openCodeGoDocumentModel, openCodeGoDocumentTimeoutMs } =
      config.values;
    if (!openCodeGoApiKey) throw new FaceAiVerificationError(FACE_AI_FAILURE.API_KEY_MISSING);
    if (!openCodeGoBaseUrl) throw new FaceAiVerificationError(FACE_AI_FAILURE.BASE_URL_MISSING);
    if (!openCodeGoDocumentModel) throw new FaceAiVerificationError(FACE_AI_FAILURE.MODEL_MISSING);

    this.apiKey = openCodeGoApiKey;
    this.baseUrl = openCodeGoBaseUrl;
    this.model = openCodeGoDocumentModel;
    this.apiModel = toApiModel(openCodeGoDocumentModel);
    this.timeoutMs = openCodeGoDocumentTimeoutMs;
    this.fetchImplementation = fetchImplementation ?? ((input, init) => fetch(input, init));
  }

  async verify(documentFront: Buffer, selfie: Buffer): Promise<FaceAiVerificationResult> {
    const controller = new AbortController();
    let didTimeout = false;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(new FaceAiVerificationError(FACE_AI_FAILURE.REQUEST_TIMEOUT));
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.fetchImplementation(`${this.baseUrl}${CHAT_COMPLETIONS_PATH}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "x-opencode-session": randomUUID(),
          },
          body: JSON.stringify(this.createRequest(documentFront, selfie)),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      if (!response.ok) {
        throw new FaceAiVerificationError(FACE_AI_FAILURE.REQUEST_FAILED, response.status);
      }

      const responseText = await Promise.race([response.text(), timeoutPromise]);
      if (!responseText.trim() || Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) {
        throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
      }
      const parsed = parseResponse(responseText);
      if (didTimeout) throw new FaceAiVerificationError(FACE_AI_FAILURE.REQUEST_TIMEOUT);
      return {
        ...parsed,
        provider: OPENCODE_GO_PROVIDER,
        model: this.model,
      };
    } catch (error: unknown) {
      if (error instanceof FaceAiVerificationError) throw error;
      throw new FaceAiVerificationError(FACE_AI_FAILURE.REQUEST_FAILED);
    } finally {
      controller.abort();
    }
  }

  private createRequest(documentFront: Buffer, selfie: Buffer): ChatCompletionRequest {
    return {
      model: this.apiModel,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Image 1 is the FRONT of an identity document." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${documentFront.toString("base64")}` } },
          { type: "text", text: "Image 2 is a selfie of the person." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${selfie.toString("base64")}` } },
          {
            type: "text",
            text: [
              "Act as a cautious visual face-comparison assistant.",
              "Compare only the visible face in the FRONT document image with the visible face in the selfie.",
              "Use facial structure and landmarks such as eye spacing, nose, mouth, jawline, face shape, and overall proportions.",
              "Do not use names, document numbers, OCR text, gender, clothing, background, or other identity fields as evidence.",
              "First assess whether both faces are clear, frontal enough, and sufficiently visible.",
              "When both faces are usable, return an APPROXIMATE visual similarity percentage from 0 to 100; it is an estimate, not proof or a calibrated probability.",
              "Use same_person only for a strong visual match with reliable image quality.",
              "Use different_person only for a clear visual mismatch with reliable image quality.",
              "Use needs_review whenever either face is missing, too small, blurry, obstructed, or the comparison is uncertain; in that case similarity_percent must be null.",
              "When similarity_percent is numeric, the Spanish summary must be one or two concise sentences and state that approximate percentage and the main visual reason.",
              "When similarity_percent is null, the Spanish summary must say that there is no reliable percentage estimate and explain why.",
              "Never include names, document numbers, OCR text, or any other personal data in the summary.",
            ].join(" "),
          },
        ],
      }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "face_identity_comparison",
          strict: true,
          schema: FACE_AI_RESPONSE_SCHEMA,
        },
      },
    };
  }
}

function parseResponse(responseText: string): Pick<FaceAiVerificationResult, "verdict" | "similarityPercent" | "summary"> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(responseText) as unknown;
  } catch {
    throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
  }
  if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) {
    throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
  }
  const choice = envelope.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
  }
  let value: unknown;
  try {
    value = JSON.parse(choice.message.content) as unknown;
  } catch {
    throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
  }
  if (!isRecord(value)) throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
  const verdict = value.verdict;
  const similarityPercent = value.similarity_percent;
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const hasValidSimilarity =
    similarityPercent === null ||
    (typeof similarityPercent === "number" &&
      Number.isFinite(similarityPercent) &&
      similarityPercent >= 0 &&
      similarityPercent <= 100);
  if (
    (verdict !== FACE_AI_VERDICT.SAME_PERSON &&
      verdict !== FACE_AI_VERDICT.DIFFERENT_PERSON &&
      verdict !== FACE_AI_VERDICT.NEEDS_REVIEW) ||
    !hasValidSimilarity ||
    summary.length === 0 ||
    summary.length > 800
  ) {
    throw new FaceAiVerificationError(FACE_AI_FAILURE.INVALID_RESPONSE);
  }
  return { verdict, similarityPercent, summary };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toApiModel(model: string): string {
  return model.startsWith(OPENCODE_GO_MODEL_PREFIX)
    ? model.slice(OPENCODE_GO_MODEL_PREFIX.length)
    : model;
}
