import { Injectable } from "@nestjs/common";
import type { AppConfiguration } from "../../config/app-config.service";
import {
  DOCUMENT_EXTRACTION_INSTRUCTION,
  DOCUMENT_EXTRACTION_RESPONSE_FAILURE,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
  parseDocumentExtractionResponse,
  type DocumentExtractionResponseErrorFactory,
} from "./document-extraction-response";
import {
  ExternalDocumentProviderError,
  EXTERNAL_DOCUMENT_PROVIDER_FAILURE,
} from "./external-document-provider.error";
import type {
  DocumentExtractionProvider,
  DocumentExtractionResult,
  LabeledDocumentImage,
} from "./document-extraction.provider";

const HUGGING_FACE_DOCUMENT_PROVIDER = "huggingface";
export const HUGGING_FACE_CHAT_COMPLETIONS_URL =
  "https://router.huggingface.co/v1/chat/completions";

const HUGGING_FACE_HTTP_STATUS = {
  TOO_MANY_REQUESTS: 429,
} as const;

const HUGGING_FACE_CONTENT_TYPE = {
  TEXT: "text",
  IMAGE_URL: "image_url",
} as const;

type HuggingFaceContentType =
  (typeof HUGGING_FACE_CONTENT_TYPE)[keyof typeof HUGGING_FACE_CONTENT_TYPE];

const HUGGING_FACE_RESPONSE_FORMAT_TYPE = {
  JSON_SCHEMA: "json_schema",
} as const;

export const HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE = {
  API_TOKEN_MISSING: "API_TOKEN_MISSING",
  MODEL_MISSING: "MODEL_MISSING",
  NO_IMAGES_PROVIDED: "NO_IMAGES_PROVIDED",
  REQUEST_FAILED: "REQUEST_FAILED",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  INVALID_RESPONSE_ENVELOPE: "INVALID_RESPONSE_ENVELOPE",
  EMPTY_RESPONSE_CONTENT: "EMPTY_RESPONSE_CONTENT",
} as const;

export const HUGGING_FACE_DOCUMENT_EXTRACTION_ERROR_CODE = {
  ...HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE,
  ...DOCUMENT_EXTRACTION_RESPONSE_FAILURE,
} as const;

export type HuggingFaceDocumentExtractionErrorCode =
  (typeof HUGGING_FACE_DOCUMENT_EXTRACTION_ERROR_CODE)[keyof typeof HUGGING_FACE_DOCUMENT_EXTRACTION_ERROR_CODE];

interface HuggingFaceDocumentProviderConfig {
  values: Pick<
    AppConfiguration,
    "huggingFaceApiToken" | "huggingFaceDocumentModel" | "huggingFaceDocumentTimeoutMs"
  >;
}

export interface HuggingFaceFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface HuggingFaceFetch {
  (input: string, init: RequestInit): Promise<HuggingFaceFetchResponse>;
}

interface HuggingFaceImageUrl {
  url: string;
}

interface HuggingFaceMessageContent {
  type: HuggingFaceContentType;
  text?: string;
  image_url?: HuggingFaceImageUrl;
}

interface HuggingFaceChatMessage {
  role: string;
  content: HuggingFaceMessageContent[];
}

interface HuggingFaceJsonSchema {
  name: string;
  strict: boolean;
  schema: typeof DOCUMENT_EXTRACTION_RESPONSE_SCHEMA;
}

interface HuggingFaceResponseFormat {
  type: (typeof HUGGING_FACE_RESPONSE_FORMAT_TYPE)[keyof typeof HUGGING_FACE_RESPONSE_FORMAT_TYPE];
  json_schema: HuggingFaceJsonSchema;
}

interface HuggingFaceChatCompletionRequest {
  model: string;
  temperature: number;
  messages: HuggingFaceChatMessage[];
  response_format: HuggingFaceResponseFormat;
}

interface HuggingFaceChatCompletionEnvelope {
  choices: HuggingFaceChatCompletionChoice[];
}

interface HuggingFaceChatCompletionChoice {
  message: HuggingFaceChatCompletionMessage;
}

interface HuggingFaceChatCompletionMessage {
  content: string;
}

export class HuggingFaceDocumentExtractionError extends Error {
  constructor(readonly code: HuggingFaceDocumentExtractionErrorCode, readonly httpStatus?: number) {
    super(`Hugging Face document extraction failed: ${code}`);
    this.name = "HuggingFaceDocumentExtractionError";
  }
}

@Injectable()
export class HuggingFaceDocumentExtractionProvider implements DocumentExtractionProvider {
  private readonly apiToken: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: HuggingFaceFetch;
  readonly audit: { provider: string; model: string };

  constructor(config: HuggingFaceDocumentProviderConfig, fetchImplementation?: HuggingFaceFetch) {
    const apiToken = config.values.huggingFaceApiToken;
    const model = config.values.huggingFaceDocumentModel;
    if (!apiToken) {
      throw new HuggingFaceDocumentExtractionError(
        HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.API_TOKEN_MISSING,
      );
    }
    if (!model) {
      throw new HuggingFaceDocumentExtractionError(
        HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.MODEL_MISSING,
      );
    }

    this.apiToken = apiToken;
    this.model = model;
    this.timeoutMs = config.values.huggingFaceDocumentTimeoutMs;
    this.fetchImplementation = fetchImplementation ?? defaultHuggingFaceFetch;
    this.audit = { provider: HUGGING_FACE_DOCUMENT_PROVIDER, model: this.model };
  }

  async extract(images: LabeledDocumentImage[]): Promise<DocumentExtractionResult> {
    if (images.length === 0) {
      throw new HuggingFaceDocumentExtractionError(
        HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.NO_IMAGES_PROVIDED,
      );
    }

    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImplementation(HUGGING_FACE_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.createRequest(images)),
        signal: controller.signal,
      });

      if (response.status === HUGGING_FACE_HTTP_STATUS.TOO_MANY_REQUESTS) {
        throw new ExternalDocumentProviderError(
          EXTERNAL_DOCUMENT_PROVIDER_FAILURE.RATE_LIMITED,
          response.status,
        );
      }
      if (!response.ok) {
        throw new HuggingFaceDocumentExtractionError(
          HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
          response.status,
        );
      }

      const responseContent = parseHuggingFaceChatCompletionEnvelope(await response.text());
      return {
        ...parseDocumentExtractionResponse(responseContent, huggingFaceResponseErrorFactory),
        audit: this.audit,
      };
    } catch (error: unknown) {
      if (
        error instanceof HuggingFaceDocumentExtractionError ||
        error instanceof ExternalDocumentProviderError
      ) {
        throw error;
      }
      if (didTimeout) {
        throw new HuggingFaceDocumentExtractionError(
          HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
        );
      }

      throw new HuggingFaceDocumentExtractionError(
        HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private createRequest(images: LabeledDocumentImage[]): HuggingFaceChatCompletionRequest {
    const content: HuggingFaceMessageContent[] = [];
    for (const image of images) {
      content.push({
        type: HUGGING_FACE_CONTENT_TYPE.TEXT,
        text: `Document evidence side: ${image.side}`,
      });
      content.push({
        type: HUGGING_FACE_CONTENT_TYPE.IMAGE_URL,
        image_url: {
          url: `data:image/jpeg;base64,${image.buffer.toString("base64")}`,
        },
      });
    }
    content.push({ type: HUGGING_FACE_CONTENT_TYPE.TEXT, text: DOCUMENT_EXTRACTION_INSTRUCTION });

    return {
      model: this.model,
      temperature: 0,
      messages: [{ role: "user", content }],
      response_format: {
        type: HUGGING_FACE_RESPONSE_FORMAT_TYPE.JSON_SCHEMA,
        json_schema: {
          name: "colombian_cedula_document_extraction",
          strict: true,
          schema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
        },
      },
    };
  }
}

const defaultHuggingFaceFetch: HuggingFaceFetch = (input, init) => fetch(input, init);

const huggingFaceResponseErrorFactory: DocumentExtractionResponseErrorFactory = {
  create: (code): HuggingFaceDocumentExtractionError =>
    new HuggingFaceDocumentExtractionError(code),
};

function parseHuggingFaceChatCompletionEnvelope(responseText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    throw new HuggingFaceDocumentExtractionError(
      HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    );
  }

  if (!isHuggingFaceChatCompletionEnvelope(parsed)) {
    throw new HuggingFaceDocumentExtractionError(
      HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    );
  }

  const responseContent = parsed.choices[0]?.message.content.trim();
  if (!responseContent) {
    throw new HuggingFaceDocumentExtractionError(
      HUGGING_FACE_DOCUMENT_EXTRACTION_FAILURE.EMPTY_RESPONSE_CONTENT,
    );
  }

  return responseContent;
}

function isHuggingFaceChatCompletionEnvelope(
  value: unknown,
): value is HuggingFaceChatCompletionEnvelope {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length !== 1) {
    return false;
  }

  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return false;
  }

  return typeof choice.message.content === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
