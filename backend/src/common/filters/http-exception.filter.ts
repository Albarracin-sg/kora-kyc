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
    const request = host
      .switchToHttp()
      .getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const path = request.originalUrl ?? request.url ?? "";

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawBody = exception.getResponse();
      const message = this.extractMessage(rawBody);

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

  private extractMessage(rawBody: unknown): string | string[] {
    if (rawBody && typeof rawBody === "object" && "message" in rawBody) {
      const message = (rawBody as { message: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
      if (Array.isArray(message) && message.every((item) => typeof item === "string")) {
        return message;
      }
    }
    if (typeof rawBody === "string") {
      return rawBody;
    }
    return "Request failed";
  }

  private stackOf(exception: unknown): string | undefined {
    if (this.configService.values.environment === "production") {
      return undefined;
    }
    return exception instanceof Error ? exception.stack : undefined;
  }
}
