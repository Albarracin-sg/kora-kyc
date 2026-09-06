import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { AppConfigService } from "../../config/app-config.service";

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  path: string;
  timestamp: string;
}

interface HttpRequestForErrorHandling {
  method?: string;
  originalUrl?: string;
  url?: string;
  query?: unknown;
  params?: unknown;
  body?: unknown;
}

/**
 * Central exception filter that normalizes every error into a consistent JSON
 * envelope: `{ statusCode, message, path, timestamp }`.
 *
 * Safety rules:
 * - Never exposes a stack trace or internal error detail to the client. The
 *   stack is only written to the server log when not running in production.
 * - Never echoes request bodies, multipart content, credentials or KYC results.
 * - Unknown errors are reported as a generic 500 message even though the real
 *   error is logged server-side.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly configService: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<HttpRequestForErrorHandling>();
    const path = pathWithoutQuery(request.originalUrl ?? request.url ?? "");

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawBody = exception.getResponse();
      const message = this.extractMessage(rawBody, request);

      const body: ErrorBody = {
        statusCode: status,
        message,
        path,
        timestamp: new Date().toISOString(),
      };

      this.logger.warn(`${request.method ?? "?"} ${path} -> ${status}`);
      response.status(status).json(body);
      return;
    }

    // Unknown / non-HTTP error.
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error(`Unhandled error on ${request.method ?? "?"} ${path}`, this.stackOf(exception));

    response.status(status).json({
      statusCode: status,
      message: "Internal server error",
      path,
      timestamp: new Date().toISOString(),
    } satisfies ErrorBody);
  }

  private extractMessage(rawBody: unknown, request: HttpRequestForErrorHandling): string | string[] {
    if (rawBody && typeof rawBody === "object" && "message" in rawBody) {
      const message = (rawBody as { message: unknown }).message;
      if (typeof message === "string") {
        return this.withoutRequestInput(message, request);
      }
      if (Array.isArray(message) && message.every((item) => typeof item === "string")) {
        return this.withoutRequestInput(message, request);
      }
    }
    if (typeof rawBody === "string") {
      return this.withoutRequestInput(rawBody, request);
    }
    return "Request failed";
  }

  private withoutRequestInput(
    message: string | string[],
    request: HttpRequestForErrorHandling,
  ): string | string[] {
    const inputValues = [request.query, request.params, request.body]
      .flatMap((input) => this.stringValuesOf(input))
      .filter((value) => value.length > 0);
    const messages = Array.isArray(message) ? message : [message];

    if (inputValues.some((inputValue) => messages.some((item) => item.includes(inputValue)))) {
      return "Request failed";
    }

    return message;
  }

  private stringValuesOf(value: unknown): string[] {
    if (typeof value === "string") {
      return [value];
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return [String(value)];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.stringValuesOf(item));
    }
    if (value && typeof value === "object") {
      return Object.values(value).flatMap((item) => this.stringValuesOf(item));
    }
    return [];
  }

  private stackOf(exception: unknown): string | undefined {
    if (this.configService.values.environment === "production") {
      return undefined;
    }
    return exception instanceof Error ? exception.stack : undefined;
  }
}

function pathWithoutQuery(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}
