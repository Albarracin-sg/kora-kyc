import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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

const OPENCODE_GO_DOCUMENT_PROVIDER = "opencode-go";
const OPENCODE_GO_MODEL_PREFIX = "opencode-go/";
const OPENCODE_GO_CONTENT_TYPE = {
  TEXT: "text",
  IMAGE_URL: "image_url",
} as const;
const OPENCODE_GO_RESPONSE_FORMAT_TYPE = {
  JSON_SCHEMA: "json_schema",
} as const;
const OPENCODE_GO_HTTP_STATUS = {
  TOO_MANY_REQUESTS: 429,
} as const;

export const OPENCODE_GO_CHAT_COMPLETIONS_PATH = "/chat/completions";
export const OPENCODE_GO_MAX_RESPONSE_BYTES = 256 * 1024;

export const OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE = {
  API_KEY_MISSING: "API_KEY_MISSING",
  BASE_URL_MISSING: "BASE_URL_MISSING",
  MODEL_MISSING: "MODEL_MISSING",
  NO_IMAGES_PROVIDED: "NO_IMAGES_PROVIDED",
  REQUEST_FAILED: "REQUEST_FAILED",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  INVALID_RESPONSE_ENVELOPE: "INVALID_RESPONSE_ENVELOPE",
  EMPTY_RESPONSE_ENVELOPE: "EMPTY_RESPONSE_ENVELOPE",
  EMPTY_RESPONSE_CONTENT: "EMPTY_RESPONSE_CONTENT",
} as const;

export const OPENCODE_GO_DOCUMENT_EXTRACTION_ERROR_CODE = {
  ...OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE,
  ...DOCUMENT_EXTRACTION_RESPONSE_FAILURE,
} as const;

export type OpenCodeGoDocumentExtractionErrorCode =
  (typeof OPENCODE_GO_DOCUMENT_EXTRACTION_ERROR_CODE)[keyof typeof OPENCODE_GO_DOCUMENT_EXTRACTION_ERROR_CODE];

interface OpenCodeGoDocumentProviderConfig {
  values: Pick<
    AppConfiguration,
    | "openCodeGoApiKey"
    | "openCodeGoBaseUrl"
    | "openCodeGoDocumentModel"
    | "openCodeGoDocumentTimeoutMs"
  >;
}

export interface OpenCodeGoFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface OpenCodeGoFetch {
  (input: string, init: RequestInit): Promise<OpenCodeGoFetchResponse>;
}

interface OpenCodeGoImageUrl {
  url: string;
}

interface OpenCodeGoMessageContent {
  type: OpenCodeGoContentType;
  text?: string;
  image_url?: OpenCodeGoImageUrl;
}

interface OpenCodeGoChatMessage {
  role: string;
  content: OpenCodeGoMessageContent[];
}

interface OpenCodeGoJsonSchema {
  name: string;
  strict: boolean;
  schema: typeof DOCUMENT_EXTRACTION_RESPONSE_SCHEMA;
}

interface OpenCodeGoResponseFormat {
  type: (typeof OPENCODE_GO_RESPONSE_FORMAT_TYPE)[keyof typeof OPENCODE_GO_RESPONSE_FORMAT_TYPE];
  json_schema: OpenCodeGoJsonSchema;
}

interface OpenCodeGoChatCompletionRequest {
  model: string;
  temperature: number;
  messages: OpenCodeGoChatMessage[];
  response_format: OpenCodeGoResponseFormat;
}

interface OpenCodeGoChatCompletionEnvelope {
  choices: OpenCodeGoChatCompletionChoice[];
}

interface OpenCodeGoChatCompletionChoice {
  message: OpenCodeGoChatCompletionMessage;
}

interface OpenCodeGoChatCompletionMessage {
  content: string;
}

type OpenCodeGoContentType =
  (typeof OPENCODE_GO_CONTENT_TYPE)[keyof typeof OPENCODE_GO_CONTENT_TYPE];

export class OpenCodeGoDocumentExtractionError extends Error {
  constructor(readonly code: OpenCodeGoDocumentExtractionErrorCode, readonly httpStatus?: number) {
    super(`OpenCode Go document extraction failed: ${code}`);
    this.name = "OpenCodeGoDocumentExtractionError";
  }
}

@Injectable()
export class OpenCodeGoDocumentExtractionProvider implements DocumentExtractionProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiModel: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: OpenCodeGoFetch;
  readonly audit: { provider: string; model: string };

  constructor(config: OpenCodeGoDocumentProviderConfig, fetchImplementation?: OpenCodeGoFetch) {
    const apiKey = config.values.openCodeGoApiKey;
    const baseUrl = config.values.openCodeGoBaseUrl;
    const model = config.values.openCodeGoDocumentModel;
    if (!apiKey) {
      throw new OpenCodeGoDocumentExtractionError(
        OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.API_KEY_MISSING,
      );
    }
    if (!baseUrl) {
      throw new OpenCodeGoDocumentExtractionError(
        OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.BASE_URL_MISSING,
      );
    }
    if (!model) {
      throw new OpenCodeGoDocumentExtractionError(
        OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.MODEL_MISSING,
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.apiModel = toApiModel(model);
    this.timeoutMs = config.values.openCodeGoDocumentTimeoutMs;
    this.fetchImplementation = fetchImplementation ?? defaultOpenCodeGoFetch;
    this.audit = { provider: OPENCODE_GO_DOCUMENT_PROVIDER, model: this.model };
  }

  async extract(images: LabeledDocumentImage[]): Promise<DocumentExtractionResult> {
    if (images.length === 0) {
      throw new OpenCodeGoDocumentExtractionError(
        OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.NO_IMAGES_PROVIDED,
      );
    }

    const controller = new AbortController();
    let didTimeout = false;
    const deadline = Date.now() + this.timeoutMs;
    let rejectTimeout: ((reason?: unknown) => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      rejectTimeout?.(new Error("OpenCode Go document request timed out"));
    }, this.timeoutMs);

    try {
      const response = await Promise.race([
        this.fetchImplementation(this.chatCompletionsUrl(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "x-opencode-session": randomUUID(),
          },
          body: JSON.stringify(this.createRequest(images)),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);

      if (response.status === OPENCODE_GO_HTTP_STATUS.TOO_MANY_REQUESTS) {
        throw new ExternalDocumentProviderError(
          EXTERNAL_DOCUMENT_PROVIDER_FAILURE.RATE_LIMITED,
          response.status,
        );
      }
      if (!response.ok) {
        throw new OpenCodeGoDocumentExtractionError(
          OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
          response.status,
        );
      }

      const responseText = await Promise.race([response.text(), timeoutPromise]);
      if (Buffer.byteLength(responseText, "utf8") > OPENCODE_GO_MAX_RESPONSE_BYTES) {
        throw new OpenCodeGoDocumentExtractionError(
          OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
        );
      }
      if (!responseText.trim()) {
        throw new OpenCodeGoDocumentExtractionError(
          OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.EMPTY_RESPONSE_ENVELOPE,
        );
      }
      if (didTimeout || Date.now() >= deadline) {
        throw new OpenCodeGoDocumentExtractionError(
          OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
        );
      }

      const responseContent = parseOpenCodeGoChatCompletionEnvelope(responseText);
      const parsedDocument = parseDocumentExtractionResponse(
        responseContent,
        openCodeGoResponseErrorFactory,
      );
      if (didTimeout || Date.now() >= deadline) {
        throw new OpenCodeGoDocumentExtractionError(
          OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
        );
      }

      return {
        ...parsedDocument,
        audit: this.audit,
      };
    } catch (error: unknown) {
      if (didTimeout || Date.now() >= deadline) {
        throw new OpenCodeGoDocumentExtractionError(
          OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_TIMEOUT,
        );
      }
      if (
        error instanceof OpenCodeGoDocumentExtractionError ||
        error instanceof ExternalDocumentProviderError
      ) {
        throw error;
      }
      throw new OpenCodeGoDocumentExtractionError(
        OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.REQUEST_FAILED,
      );
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private chatCompletionsUrl(): string {
    return `${this.baseUrl}${OPENCODE_GO_CHAT_COMPLETIONS_PATH}`;
  }

  private createRequest(images: LabeledDocumentImage[]): OpenCodeGoChatCompletionRequest {
    const content: OpenCodeGoMessageContent[] = [];
    for (const image of images) {
      content.push({
        type: OPENCODE_GO_CONTENT_TYPE.TEXT,
        text: `Document evidence side: ${image.side}`,
      });
      content.push({
        type: OPENCODE_GO_CONTENT_TYPE.IMAGE_URL,
        image_url: {
          url: `data:image/jpeg;base64,${image.buffer.toString("base64")}`,
        },
      });
    }
    content.push({ type: OPENCODE_GO_CONTENT_TYPE.TEXT, text: DOCUMENT_EXTRACTION_INSTRUCTION });

    return {
      model: this.apiModel,
      temperature: 0,
      messages: [{ role: "user", content }],
      response_format: {
        type: OPENCODE_GO_RESPONSE_FORMAT_TYPE.JSON_SCHEMA,
        json_schema: {
          name: "colombian_cedula_document_extraction",
          strict: true,
          schema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
        },
      },
    };
  }
}

const defaultOpenCodeGoFetch: OpenCodeGoFetch = (input, init) => fetch(input, init);

const openCodeGoResponseErrorFactory: DocumentExtractionResponseErrorFactory = {
  create: (code): OpenCodeGoDocumentExtractionError =>
    new OpenCodeGoDocumentExtractionError(code),
};

function toApiModel(model: string): string {
  return model.startsWith(OPENCODE_GO_MODEL_PREFIX)
    ? model.slice(OPENCODE_GO_MODEL_PREFIX.length)
    : model;
}

function parseOpenCodeGoChatCompletionEnvelope(responseText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch {
    throw new OpenCodeGoDocumentExtractionError(
      OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    );
  }

  if (!isOpenCodeGoChatCompletionEnvelope(parsed)) {
    throw new OpenCodeGoDocumentExtractionError(
      OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.INVALID_RESPONSE_ENVELOPE,
    );
  }

  const responseContent = parsed.choices[0]?.message.content.trim();
  if (!responseContent) {
    throw new OpenCodeGoDocumentExtractionError(
      OPENCODE_GO_DOCUMENT_EXTRACTION_FAILURE.EMPTY_RESPONSE_CONTENT,
    );
  }

  return responseContent;
}

function isOpenCodeGoChatCompletionEnvelope(
  value: unknown,
): value is OpenCodeGoChatCompletionEnvelope {
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
