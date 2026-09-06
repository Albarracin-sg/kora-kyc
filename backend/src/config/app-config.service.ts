import { Injectable } from "@nestjs/common";
import { resolve } from "node:path";
import type { SignOptions } from "jsonwebtoken";

export const APP_ENVIRONMENT = {
  DEVELOPMENT: "development",
  PRODUCTION: "production",
  TEST: "test",
} as const;

export type AppEnvironment = (typeof APP_ENVIRONMENT)[keyof typeof APP_ENVIRONMENT];

const CONFIG_DEFAULTS = {
  environment: APP_ENVIRONMENT.DEVELOPMENT,
  port: 3000,
  refreshTokenTtlDays: 30,
  imageMaxBytes: 10 * 1024 * 1024,
  imageMaxPixels: 12_000_000,
  imageMaxDimension: 2048,
  ocrWorkerCount: 2,
  ocrMinimumConfidence: 0.65,
  jobLockTimeoutMs: 60_000,
  faceMinimumSimilarity: 0.72,
  faceMaximumDistance: 0.85,
  faceMinimumConfidence: 0.65,
  rateLimitEnabled: true,
  rateLimitDefaultLimit: 100,
  rateLimitDefaultTtlMs: 60_000,
  rateLimitAuthLimit: 10,
  rateLimitAuthTtlMs: 60_000,
  rateLimitAuthBlockMs: 300_000,
  rateLimitKycLimit: 30,
  rateLimitKycTtlMs: 60_000,
  rateLimitKycBlockMs: 120_000,
  huggingFaceDocumentTimeoutMs: 30_000,
  faceServiceTimeoutMs: 30_000,
} as const;

const HUGGING_FACE_DOCUMENT_TIMEOUT = {
  minimumMs: 1_000,
  maximumMs: 120_000,
} as const;

const FACE_SERVICE_TIMEOUT = {
  minimumMs: 1_000,
  maximumMs: 120_000,
} as const;

const HUGGING_FACE_NON_DETERMINISTIC_ROUTING_SUFFIX = {
  FASTEST: "fastest",
  CHEAPEST: "cheapest",
  PREFERRED: "preferred",
} as const;

const HUGGING_FACE_NON_DETERMINISTIC_ROUTING_SUFFIXES = new Set<string>(
  Object.values(HUGGING_FACE_NON_DETERMINISTIC_ROUTING_SUFFIX),
);

const HUGGING_FACE_EXPLICIT_MODEL_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*:([a-z0-9][a-z0-9-]*)$/;

export const KYC_DOCUMENT_PROVIDER = {
  GEMINI: "gemini",
  HUGGING_FACE: "huggingface",
  LOCAL: "local",
} as const;

export type KycDocumentProvider =
  (typeof KYC_DOCUMENT_PROVIDER)[keyof typeof KYC_DOCUMENT_PROVIDER];

export const FACE_VERIFICATION_PROVIDER = {
  LOCAL: "local",
  FACE_SERVICE: "face_service",
} as const;

export type FaceVerificationProviderName =
  (typeof FACE_VERIFICATION_PROVIDER)[keyof typeof FACE_VERIFICATION_PROVIDER];

export interface AppConfiguration {
  environment: AppEnvironment;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: NonNullable<SignOptions["expiresIn"]>;
  refreshTokenTtlMs: number;
  bcryptRounds: number;
  corsOrigins: string[];
  localStorageRoot: string;
  assetManifestPath: string;
  tesseractLangPath: string;
  humanModelsPath: string;
  imageMaxBytes: number;
  imageMaxPixels: number;
  imageMaxDimension: number;
  ocrWorkerCount: number;
  ocrMinimumConfidence: number;
  jobLockTimeoutMs: number;
  faceMinimumSimilarity: number;
  faceMaximumDistance: number;
  faceMinimumConfidence: number;
  documentHashPepper: string;
  documentProvider: KycDocumentProvider;
  faceVerificationProvider: FaceVerificationProviderName;
  faceServiceUrl: string;
  faceServiceTimeoutMs: number;
  faceApiKey: string;
  geminiApiKey: string | null;
  geminiModel: string;
  huggingFaceApiToken: string | null;
  huggingFaceDocumentModel: string | null;
  huggingFaceDocumentTimeoutMs: number;
  rateLimitEnabled: boolean;
  rateLimitDefaultLimit: number;
  rateLimitDefaultTtlMs: number;
  rateLimitAuthLimit: number;
  rateLimitAuthTtlMs: number;
  rateLimitAuthBlockMs: number;
  rateLimitKycLimit: number;
  rateLimitKycTtlMs: number;
  rateLimitKycBlockMs: number;
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const rawValue = environment[key];
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  return parsedValue;
}

function readDurationDays(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const days = readPositiveInteger(environment, key, fallback);
  const milliseconds = days * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`Environment variable ${key} is too large`);
  }

  return milliseconds;
}

function readBoundedPositiveInteger(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = readPositiveInteger(environment, key, fallback);
  if (value < minimum || value > maximum) {
    throw new Error(`Environment variable ${key} must be between ${minimum} and ${maximum}`);
  }

  return value;
}

function readBoolean(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
): boolean {
  const rawValue = environment[key]?.trim();
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  if (rawValue === "true" || rawValue === "1") {
    return true;
  }
  if (rawValue === "false" || rawValue === "0") {
    return false;
  }

  throw new Error(`Environment variable ${key} must be true or false`);
}

function readUnitInterval(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const rawValue = environment[key];
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0 || parsedValue > 1) {
    throw new Error(`Environment variable ${key} must be a number greater than 0 and at most 1`);
  }

  return parsedValue;
}

function readOrigins(environment: NodeJS.ProcessEnv): string[] {
  const rawOrigins = environment.CORS_ORIGINS ?? "http://localhost:8081";
  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error("CORS_ORIGINS must contain at least one origin");
  }

  return origins;
}

function readJwtExpiry(environment: NodeJS.ProcessEnv): NonNullable<SignOptions["expiresIn"]> {
  const value = environment.JWT_EXPIRES_IN?.trim() || "15m";
  if (!/^\d+(?:ms|s|m|h|d|w|y)$/.test(value)) {
    throw new Error("JWT_EXPIRES_IN must be a positive duration such as 15m or 1h");
  }

  return value as NonNullable<SignOptions["expiresIn"]>;
}

function readEnvironment(environment: NodeJS.ProcessEnv): AppEnvironment {
  const value = environment.NODE_ENV?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return CONFIG_DEFAULTS.environment;
  }
  if (value === APP_ENVIRONMENT.DEVELOPMENT || value === APP_ENVIRONMENT.PRODUCTION) {
    return value;
  }
  if (value === APP_ENVIRONMENT.TEST) {
    return value;
  }
  throw new Error("NODE_ENV must be development, test or production");
}

function readDocumentProvider(environment: NodeJS.ProcessEnv): KycDocumentProvider {
  const value = environment.KYC_DOCUMENT_PROVIDER?.trim() || KYC_DOCUMENT_PROVIDER.GEMINI;
  if (
    value === KYC_DOCUMENT_PROVIDER.GEMINI ||
    value === KYC_DOCUMENT_PROVIDER.HUGGING_FACE ||
    value === KYC_DOCUMENT_PROVIDER.LOCAL
  ) {
    return value;
  }

  throw new Error("KYC_DOCUMENT_PROVIDER must be gemini, huggingface or local");
}

function readFaceVerificationProvider(
  environment: NodeJS.ProcessEnv,
): FaceVerificationProviderName {
  const value =
    environment.FACE_VERIFICATION_PROVIDER?.trim() || FACE_VERIFICATION_PROVIDER.LOCAL;
  if (
    value === FACE_VERIFICATION_PROVIDER.LOCAL ||
    value === FACE_VERIFICATION_PROVIDER.FACE_SERVICE
  ) {
    return value;
  }

  throw new Error("FACE_VERIFICATION_PROVIDER must be local or face_service");
}

function readFaceServiceUrl(
  environment: NodeJS.ProcessEnv,
  appEnvironment: AppEnvironment,
  faceVerificationProvider: FaceVerificationProviderName,
): string {
  const rawValue = environment.FACE_SERVICE_URL?.trim() || "http://localhost:8000";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw new Error("FACE_SERVICE_URL must be an http(s) URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("FACE_SERVICE_URL must be an http(s) URL");
  }
  if (
    appEnvironment === APP_ENVIRONMENT.PRODUCTION &&
    faceVerificationProvider === FACE_VERIFICATION_PROVIDER.FACE_SERVICE &&
    parsedUrl.protocol !== "https:"
  ) {
    throw new Error("FACE_SERVICE_URL must use https in production");
  }

  return rawValue.replace(/\/+$/, "");
}

function readFaceApiKey(
  environment: NodeJS.ProcessEnv,
  faceVerificationProvider: FaceVerificationProviderName,
): string {
  const apiKey = environment.FACE_API_KEY?.trim() || "";
  if (faceVerificationProvider === FACE_VERIFICATION_PROVIDER.FACE_SERVICE && !apiKey) {
    throw new Error("FACE_API_KEY is required when FACE_VERIFICATION_PROVIDER=face_service");
  }

  return apiKey;
}

function readGeminiApiKey(
  environment: NodeJS.ProcessEnv,
  documentProvider: KycDocumentProvider,
): string | null {
  const apiKey = environment.GEMINI_API_KEY?.trim() || null;
  if (documentProvider === KYC_DOCUMENT_PROVIDER.GEMINI && !apiKey) {
    throw new Error("GEMINI_API_KEY is required when KYC_DOCUMENT_PROVIDER=gemini");
  }

  return apiKey;
}

function readHuggingFaceApiToken(
  environment: NodeJS.ProcessEnv,
  documentProvider: KycDocumentProvider,
): string | null {
  const apiToken = environment.HUGGINGFACE_API_TOKEN?.trim() || null;
  if (documentProvider === KYC_DOCUMENT_PROVIDER.HUGGING_FACE && !apiToken) {
    throw new Error("HUGGINGFACE_API_TOKEN is required when KYC_DOCUMENT_PROVIDER=huggingface");
  }

  return apiToken;
}

function readHuggingFaceDocumentModel(
  environment: NodeJS.ProcessEnv,
  documentProvider: KycDocumentProvider,
): string | null {
  const model = environment.HUGGINGFACE_DOCUMENT_MODEL?.trim() || null;
  if (documentProvider !== KYC_DOCUMENT_PROVIDER.HUGGING_FACE) {
    return model;
  }
  if (!model) {
    throw new Error(
      "HUGGINGFACE_DOCUMENT_MODEL is required when KYC_DOCUMENT_PROVIDER=huggingface",
    );
  }

  const match = HUGGING_FACE_EXPLICIT_MODEL_PATTERN.exec(model);
  const providerSuffix = match?.[1];
  if (!providerSuffix || HUGGING_FACE_NON_DETERMINISTIC_ROUTING_SUFFIXES.has(providerSuffix)) {
    throw new Error(
      "HUGGINGFACE_DOCUMENT_MODEL must name an explicit model and provider, such as owner/model:provider",
    );
  }

  return model;
}

export function createAppConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory: string = process.cwd(),
): AppConfiguration {
  const localStorageRoot = resolve(
    workingDirectory,
    environment.LOCAL_STORAGE_ROOT ?? "upload",
  );
  const assetsRoot = resolve(workingDirectory, environment.KYC_ASSETS_ROOT ?? "assets");
  const appEnvironment = readEnvironment(environment);
  const documentProvider = readDocumentProvider(environment);
  const faceVerificationProvider = readFaceVerificationProvider(environment);

  return {
    environment: appEnvironment,
    port: readPositiveInteger(environment, "PORT", CONFIG_DEFAULTS.port),
    databaseUrl: requiredEnvironmentValue(environment, "DATABASE_URL"),
    jwtSecret: requiredEnvironmentValue(environment, "JWT_SECRET"),
    jwtExpiresIn: readJwtExpiry(environment),
    refreshTokenTtlMs: readDurationDays(
      environment,
      "REFRESH_TOKEN_TTL_DAYS",
      CONFIG_DEFAULTS.refreshTokenTtlDays,
    ),
    bcryptRounds: readPositiveInteger(environment, "BCRYPT_ROUNDS", 12),
    corsOrigins: readOrigins(environment),
    localStorageRoot,
    assetManifestPath: resolve(
      workingDirectory,
      environment.KYC_ASSET_MANIFEST_PATH ?? "assets/manifest.json",
    ),
    tesseractLangPath: resolve(
      assetsRoot,
      environment.TESSERACT_LANG_DIRECTORY ?? "tesseract",
    ),
    humanModelsPath: resolve(
      assetsRoot,
      environment.HUMAN_MODELS_DIRECTORY ?? "human-models",
    ),
    imageMaxBytes: readPositiveInteger(
      environment,
      "KYC_IMAGE_MAX_BYTES",
      CONFIG_DEFAULTS.imageMaxBytes,
    ),
    imageMaxPixels: readPositiveInteger(
      environment,
      "KYC_IMAGE_MAX_PIXELS",
      CONFIG_DEFAULTS.imageMaxPixels,
    ),
    imageMaxDimension: readPositiveInteger(
      environment,
      "KYC_IMAGE_MAX_DIMENSION",
      CONFIG_DEFAULTS.imageMaxDimension,
    ),
    ocrWorkerCount: Math.min(
      readPositiveInteger(environment, "KYC_OCR_WORKERS", CONFIG_DEFAULTS.ocrWorkerCount),
      4,
    ),
    ocrMinimumConfidence: readUnitInterval(
      environment,
      "KYC_OCR_MIN_CONFIDENCE",
      CONFIG_DEFAULTS.ocrMinimumConfidence,
    ),
    jobLockTimeoutMs: readPositiveInteger(
      environment,
      "KYC_JOB_LOCK_TIMEOUT_MS",
      CONFIG_DEFAULTS.jobLockTimeoutMs,
    ),
    faceMinimumSimilarity: readUnitInterval(
      environment,
      "KYC_FACE_MIN_SIMILARITY",
      CONFIG_DEFAULTS.faceMinimumSimilarity,
    ),
    faceMaximumDistance: readUnitInterval(
      environment,
      "KYC_FACE_MAX_DISTANCE",
      CONFIG_DEFAULTS.faceMaximumDistance,
    ),
    faceMinimumConfidence: readUnitInterval(
      environment,
      "KYC_FACE_MIN_CONFIDENCE",
      CONFIG_DEFAULTS.faceMinimumConfidence,
    ),
    documentHashPepper: requiredEnvironmentValue(environment, "KYC_DOCUMENT_HASH_PEPPER"),
    documentProvider,
    faceVerificationProvider,
    faceServiceUrl: readFaceServiceUrl(environment, appEnvironment, faceVerificationProvider),
    faceServiceTimeoutMs: readBoundedPositiveInteger(
      environment,
      "FACE_SERVICE_TIMEOUT_MS",
      CONFIG_DEFAULTS.faceServiceTimeoutMs,
      FACE_SERVICE_TIMEOUT.minimumMs,
      FACE_SERVICE_TIMEOUT.maximumMs,
    ),
    faceApiKey: readFaceApiKey(environment, faceVerificationProvider),
    geminiApiKey: readGeminiApiKey(environment, documentProvider),
    geminiModel: environment.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    huggingFaceApiToken: readHuggingFaceApiToken(environment, documentProvider),
    huggingFaceDocumentModel: readHuggingFaceDocumentModel(environment, documentProvider),
    huggingFaceDocumentTimeoutMs: readBoundedPositiveInteger(
      environment,
      "HUGGINGFACE_DOCUMENT_TIMEOUT_MS",
      CONFIG_DEFAULTS.huggingFaceDocumentTimeoutMs,
      HUGGING_FACE_DOCUMENT_TIMEOUT.minimumMs,
      HUGGING_FACE_DOCUMENT_TIMEOUT.maximumMs,
    ),
    rateLimitEnabled: readBoolean(
      environment,
      "RATE_LIMIT_ENABLED",
      CONFIG_DEFAULTS.rateLimitEnabled,
    ),
    rateLimitDefaultLimit: readPositiveInteger(
      environment,
      "RATE_LIMIT_DEFAULT_LIMIT",
      CONFIG_DEFAULTS.rateLimitDefaultLimit,
    ),
    rateLimitDefaultTtlMs: readPositiveInteger(
      environment,
      "RATE_LIMIT_DEFAULT_TTL_MS",
      CONFIG_DEFAULTS.rateLimitDefaultTtlMs,
    ),
    rateLimitAuthLimit: readPositiveInteger(
      environment,
      "RATE_LIMIT_AUTH_LIMIT",
      CONFIG_DEFAULTS.rateLimitAuthLimit,
    ),
    rateLimitAuthTtlMs: readPositiveInteger(
      environment,
      "RATE_LIMIT_AUTH_TTL_MS",
      CONFIG_DEFAULTS.rateLimitAuthTtlMs,
    ),
    rateLimitAuthBlockMs: readPositiveInteger(
      environment,
      "RATE_LIMIT_AUTH_BLOCK_MS",
      CONFIG_DEFAULTS.rateLimitAuthBlockMs,
    ),
    rateLimitKycLimit: readPositiveInteger(
      environment,
      "RATE_LIMIT_KYC_LIMIT",
      CONFIG_DEFAULTS.rateLimitKycLimit,
    ),
    rateLimitKycTtlMs: readPositiveInteger(
      environment,
      "RATE_LIMIT_KYC_TTL_MS",
      CONFIG_DEFAULTS.rateLimitKycTtlMs,
    ),
    rateLimitKycBlockMs: readPositiveInteger(
      environment,
      "RATE_LIMIT_KYC_BLOCK_MS",
      CONFIG_DEFAULTS.rateLimitKycBlockMs,
    ),
  };
}

@Injectable()
export class AppConfigService {
  readonly values: AppConfiguration;

  constructor() {
    this.values = createAppConfiguration();
  }
}
