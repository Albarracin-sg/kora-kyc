import { Injectable, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModuleOptions, type ThrottlerStorage } from "@nestjs/throttler";
import type { Request } from "express";
import { isDocumentationRequest } from "../http/route-kind";

/**
 * Global rate limiting guard.
 *
 * It extends the ThrottlerGuard from `@nestjs/throttler` to:
 * - Skip the interactive documentation pages (Scalar `/docs`, Swagger `/api`
 *   and the raw OpenAPI document) so they never disrupt legitimate browsing.
 * - Resolve the client IP behind reverse proxies / load balancers so limits
 *   are attributed to the real caller instead of the proxy.
 *
 * Limits themselves are configured centrally in `src/common/http/throttler.module.ts`
 * from the `AppConfigService` and can be overridden per route with the
 * `@Throttle({ name: { limit, ttl, blockDuration } })` decorator.
 *
 * Tracking is per IP. User-based tracking would require the JWT guard to run
 * before this guard, but global guards run before controller guards, so the
 * authenticated user is not yet available when throttling happens. IP tracking
 * is the practical and robust choice for this MVP.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request && isDocumentationRequest(request.originalUrl ?? request.url)) {
      return Promise.resolve(true);
    }
    return super.shouldSkip(context);
  }

  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const req = request as unknown as Request;
    const ip = extractClientIp(req);
    return Promise.resolve(ip);
  }
}

/**
 * Extracts the real client IP when the service runs behind a reverse proxy
 * (NestJS is deployed behind Railway's edge with X-Forwarded-For). It uses the
 * rightmost untrusted hop so a spoofed header cannot bypass the limit.
 */
function extractClientIp(request: Request): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const hops = forwarded.split(",").map((hop) => hop.trim());
    const lastHop = hops[hops.length - 1];
    if (lastHop && lastHop.length > 0) {
      return lastHop;
    }
  }

  return request.ip ?? "unknown";
}
