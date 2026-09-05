import { Module, type ExecutionContext, type DynamicModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppConfigService } from "../../config/app-config.service";
import type { RouteKind } from "./route-kind";
import { classifyRoute, ROUTE } from "./route-kind";
export { ROUTE, classifyRoute, type RouteKind } from "./route-kind";

/**
 * Builds the throttler options from the application configuration.
 *
 * Three named throttlers are defined, each limited to a single route class so
 * that a request is counted exactly once against the limit that applies to it:
 *
 * - `default`: general authenticated traffic.
 * - `auth`: the stricter limit applied to public registration/login to slow
 *   down brute force and abuse.
 * - `kyc`: a moderate limit applied to document/selfie uploads to prevent
 *   repeated uploads without breaking legitimate flows.
 *
 * Each throttler uses `skipIf` so it only engages its matching route class.
 * The interactive documentation pages are always skipped here and by the
 * `AppThrottlerGuard`.
 *
 * All limits are configurable via environment variables with the defaults
 * declared in `AppConfigService`; see `backend/.env.example`.
 */

function routeMatcher(
  kind: RouteKind,
  enabled: boolean,
): (context: ExecutionContext) => boolean {
  return (context: ExecutionContext): boolean => {
    if (!enabled) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const url = request.originalUrl ?? request.url ?? "";
    return classifyRoute(url) !== kind;
  };
}

export function createThrottlerOptions(configService: AppConfigService) {
  const enabled = configService.values.rateLimitEnabled;
  const throttlers = [
    {
      name: "default",
      ttl: configService.values.rateLimitDefaultTtlMs,
      limit: configService.values.rateLimitDefaultLimit,
      skipIf: routeMatcher(ROUTE.GENERAL, enabled),
    },
    {
      name: "auth",
      ttl: configService.values.rateLimitAuthTtlMs,
      limit: configService.values.rateLimitAuthLimit,
      blockDuration: configService.values.rateLimitAuthBlockMs,
      skipIf: routeMatcher(ROUTE.AUTH, enabled),
    },
    {
      name: "kyc",
      ttl: configService.values.rateLimitKycTtlMs,
      limit: configService.values.rateLimitKycLimit,
      blockDuration: configService.values.rateLimitKycBlockMs,
      skipIf: routeMatcher(ROUTE.KYC, enabled),
    },
  ];

  return { throttlers };
}

@Module({})
export class SecurityThrottlerModule {
  static forRootAsync(): DynamicModule {
    return {
      module: SecurityThrottlerModule,
      imports: [
        ThrottlerModule.forRootAsync({
          inject: [AppConfigService],
          useFactory: (configService: AppConfigService) => createThrottlerOptions(configService),
        }),
      ],
    };
  }
}
