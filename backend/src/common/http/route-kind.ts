/**
 * Route classification used by the rate limiter and the HTTP access logger.
 *
 * The backend serves three kinds of HTTP surfaces:
 * - `docs`: interactive API documentation (Scalar `/docs`, Swagger `/api` and
 *   the raw OpenAPI JSON `/api-json`). Documentation must never be throttled
 *   or logged as sensitive application traffic.
 * - `auth`: the public registration and login endpoints. These are the primary
 *   brute-force surface and get the strictest limit.
 * - `kyc`: the authenticated document/selfie upload endpoints. They accept
 *   multipart bodies and get a moderate limit to prevent repeated abuse.
 * - `general`: every other endpoint (for example the public health check or
 *   authenticated user profile).
 */

export const ROUTE = {
  DOCS: "docs",
  AUTH: "auth",
  KYC: "kyc",
  GENERAL: "general",
} as const;

export type RouteKind = (typeof ROUTE)[keyof typeof ROUTE];

const DOCS_PATTERNS: RegExp[] = [
  /^\/docs(?:\/|$)/,
  /^\/api-json(?:\/|$)/,
  /^\/api(?:\/|$)/,
];

/** Static asset files served by the documentation UIs (JS, CSS, images…). */
const ASSET_EXTENSION = /\.(?:js|css|png|svg|gif|ico|woff2?|ttf|eot|map)$/;

export function classifyRoute(url: string): RouteKind {
  if (DOCS_PATTERNS.some((pattern) => pattern.test(url))) {
    return ROUTE.DOCS;
  }
  if (url.startsWith("/auth") || url.startsWith("/auth/")) {
    return ROUTE.AUTH;
  }
  if (url.startsWith("/kyc") || url.startsWith("/kyc/")) {
    return ROUTE.KYC;
  }
  return ROUTE.GENERAL;
}

export function isDocumentationRequest(url: string): boolean {
  return classifyRoute(url) === ROUTE.DOCS;
}

export function isDocumentationAsset(url: string): boolean {
  return isDocumentationRequest(url) && ASSET_EXTENSION.test(url);
}
