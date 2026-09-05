import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { isDocumentationAsset } from "../http/route-kind";

/**
 * Global HTTP access logger.
 *
 * For every request it logs: HTTP method, route, response status code,
 * duration in milliseconds, remote IP and the user id (when authenticated).
 *
 * It NEVER logs:
 * - request bodies (so passwords, tokens and other credentials never reach the
 *   logs),
 * - multipart file content or the document/selfie uploads,
 * - response bodies (which contain KYC results and PII),
 * - the static assets of the documentation UIs, to keep access logs focused on
 *   application traffic (the `/docs` and `/api` HTML pages themselves are
 *   logged once each).
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    const method = request.method ?? "?";
    const url = request.originalUrl ?? request.url ?? "";
    const ip = request.ip ?? "unknown";

    if (isDocumentationAsset(url)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => this.logAccess(request, response, method, url, ip, startedAt),
        error: () => this.logAccess(request, response, method, url, ip, startedAt),
      }),
    );
  }

  private logAccess(
    request: Request,
    response: Response,
    method: string,
    url: string,
    ip: string,
    startedAt: bigint,
  ): void {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const status = response.statusCode;
    const userId = this.userIdOf(request);

    if (status >= 500) {
      this.logger.error(`${method} ${url} ${status} ${elapsedMs.toFixed(1)}ms ip=${ip}${userId}`);
    } else if (status >= 400) {
      this.logger.warn(`${method} ${url} ${status} ${elapsedMs.toFixed(1)}ms ip=${ip}${userId}`);
    } else {
      this.logger.log(`${method} ${url} ${status} ${elapsedMs.toFixed(1)}ms ip=${ip}${userId}`);
    }
  }

  private userIdOf(request: Request): string {
    const user = (request as Request & { user?: { id?: string } }).user;
    return user?.id ? ` user=${user.id}` : "";
  }
}
