import {
  ApiError,
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { Injectable } from "@nestjs/common";
import type { AppConfiguration } from "../../config/app-config.service";
import {
  type DocumentExtractionProvider,
  type DocumentExtractionResult,
  type LabeledDocumentImage,
} from "./document-extraction.provider";
import {
  DOCUMENT_EXTRACTION_INSTRUCTION,
  DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
  parseDocumentExtractionResponse,
} from "./document-extraction-response";

const GEMINI_DOCUMENT_PROVIDER = "gemini";
const GEMINI_HTTP_STATUS = {
  TOO_MANY_REQUESTS: 429,
} as const;

export const GEMINI_DOCUMENT_EXTRACTION_FAILURE = {
  REQUEST_QUOTA_EXHAUSTED: "REQUEST_QUOTA_EXHAUSTED",
} as const;

interface GeminiDocumentProviderConfig {
  values: Pick<AppConfiguration, "geminiApiKey" | "geminiModel">;
}

export interface GeminiContentClient {
  models: {
    generateContent(parameters: GenerateContentParameters): Promise<GenerateContentResponse>;
  };
}

export class GeminiDocumentExtractionError extends Error {
  constructor(readonly code: string) {
    super(`Gemini document extraction failed: ${code}`);
    this.name = "GeminiDocumentExtractionError";
  }
}

@Injectable()
export class GeminiDocumentExtractionProvider implements DocumentExtractionProvider {
  private readonly client: GeminiContentClient;
  private readonly model: string;
  readonly audit: { provider: string; model: string };

  constructor(config: GeminiDocumentProviderConfig, client?: GeminiContentClient) {
    const apiKey = config.values.geminiApiKey;
    if (!apiKey) {
      throw new GeminiDocumentExtractionError("API_KEY_MISSING");
    }

    this.client = client ?? new GoogleGenAI({ apiKey });
    this.model = config.values.geminiModel;
    this.audit = { provider: GEMINI_DOCUMENT_PROVIDER, model: this.model };
  }

  async extract(images: LabeledDocumentImage[]): Promise<DocumentExtractionResult> {
    if (images.length === 0) {
      throw new GeminiDocumentExtractionError("NO_IMAGES_PROVIDED");
    }

    try {
      const parts = images.flatMap((image) => [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: image.buffer.toString("base64"),
          },
        },
        { text: `[${image.side}]` },
      ]);
      parts.push({ text: DOCUMENT_EXTRACTION_INSTRUCTION });

      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: DOCUMENT_EXTRACTION_RESPONSE_SCHEMA,
        },
      });

      return this.toExtractionResult(response.text);
    } catch (error: unknown) {
      if (error instanceof GeminiDocumentExtractionError) {
        throw error;
      }

      if (error instanceof ApiError && error.status === GEMINI_HTTP_STATUS.TOO_MANY_REQUESTS) {
        throw new GeminiDocumentExtractionError(
          GEMINI_DOCUMENT_EXTRACTION_FAILURE.REQUEST_QUOTA_EXHAUSTED,
        );
      }

      throw new GeminiDocumentExtractionError("REQUEST_FAILED");
    }
  }

  private toExtractionResult(responseText: string | undefined): DocumentExtractionResult {
    if (!responseText) {
      throw new GeminiDocumentExtractionError("EMPTY_RESPONSE");
    }

    return {
      ...parseGeminiDocumentResponse(responseText),
      audit: this.audit,
    };
  }
}

export function parseGeminiDocumentResponse(responseText: string): Omit<DocumentExtractionResult, "audit"> {
  return parseDocumentExtractionResponse(responseText, {
    create: (code) => new GeminiDocumentExtractionError(code),
  });
}
