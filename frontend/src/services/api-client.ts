import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  clearTokens,
  readAccessToken,
  readRefreshToken,
  writeTokens,
} from "./secure-token-store";
import type {
  ApiErrorPayload,
  AuthResponse,
  AuthTokens,
  AuthenticatedUser,
  DocumentSide,
  KycVerification,
  KycConsentRequirements,
  KycHistoryDetail,
  KycHistoryList,
  UserProfile,
} from "../types/api";

export const API_ERROR_KIND = {
  CONFIGURATION: "configuration",
  NETWORK: "network",
  HTTP: "http",
  SESSION: "session",
  UPLOAD: "upload",
} as const;

export type ApiErrorKind = (typeof API_ERROR_KIND)[keyof typeof API_ERROR_KIND];

export interface ApiRequestLogMetadata {
  kind: ApiErrorKind;
  method: string;
  endpoint: string;
  status: number;
  errorName: string;
}

export interface AuthenticatedMediaSource {
  uri: string;
}

interface ApiRequestErrorDetails {
  kind: ApiErrorKind;
  method: string;
  endpoint: string;
  errorName: string;
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  koraRetryAttempted?: boolean;
}

type RequestBody = string | FormData;

interface RequestOptions {
  method: string;
  body?: RequestBody;
  contentType?: string;
}

const UPLOAD_FILE_NAME = "capture.jpg";
const UPLOAD_MIME_TYPE = "image/jpeg";
const LOCAL_IMAGE_URI_PATTERN = /^(?:file|content):\/\/\S+$/i;
const TOKEN_EXPIRY_MARGIN_SECONDS = 30;
const UPLOAD_PREPARATION_ERROR_MESSAGE =
  "No se pudo preparar la imagen para la carga. Vuelva a capturarla e inténtelo de nuevo.";
const SESSION_EXPIRED_MESSAGE = "La sesión expiró. Inicie sesión nuevamente.";
const MEDIA_READ_ERROR_MESSAGE = "No se pudo leer la imagen de la verificación.";

interface ReactNativeFormDataPart {
  uri: string;
  name: typeof UPLOAD_FILE_NAME;
  type: typeof UPLOAD_MIME_TYPE;
}

interface ReactNativeFormDataAppend {
  append(name: string, value: ReactNativeFormDataPart): void;
}

let currentAccessToken: string | null = null;
let currentRefreshToken: string | null = null;
let refreshPromise: Promise<AuthResponse> | null = null;

export function setSessionTokens(tokens: AuthTokens): void {
  currentAccessToken = tokens.accessToken;
  currentRefreshToken = tokens.refreshToken;
}

export async function persistSessionTokens(response: AuthResponse): Promise<void> {
  setSessionTokens(response);
  await writeTokens(response.accessToken, response.refreshToken);
}

export async function clearSessionTokens(): Promise<void> {
  currentAccessToken = null;
  currentRefreshToken = null;
  await clearTokens();
}

function normalizeMethod(method: string): string {
  const normalizedMethod = method.trim().toUpperCase();
  return /^[A-Z]+$/.test(normalizedMethod) ? normalizedMethod : "UNKNOWN";
}

function toRelativeEndpoint(path: string): string {
  const queryIndex = path.indexOf("?");
  const endpoint = queryIndex === -1 ? path : path.slice(0, queryIndex);
  return endpoint.startsWith("/") ? endpoint : "/unknown";
}

function normalizeErrorName(errorName: string): string {
  const normalizedName = errorName.trim();
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(normalizedName)
    ? normalizedName
    : "UnknownError";
}

export function getSafeErrorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return "UnknownError";
  }

  return normalizeErrorName(error.name);
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly method: string;
  readonly endpoint: string;
  readonly errorName: string;

  constructor(
    status: number,
    message: string,
    details?: Partial<ApiRequestErrorDetails>,
  ) {
    super(message);
    this.status = status;
    this.kind = details?.kind ?? (status === 0 ? API_ERROR_KIND.NETWORK : API_ERROR_KIND.HTTP);
    this.method = normalizeMethod(details?.method ?? "UNKNOWN");
    this.endpoint = toRelativeEndpoint(details?.endpoint ?? "/unknown");
    this.errorName = normalizeErrorName(details?.errorName ?? "ApiRequestError");
    this.name = "ApiRequestError";
  }
}

export class SessionExpiredError extends ApiRequestError {
  constructor() {
    super(401, SESSION_EXPIRED_MESSAGE, {
      kind: API_ERROR_KIND.SESSION,
      method: "POST",
      endpoint: "/auth/refresh",
      errorName: "SessionExpiredError",
    });
    this.name = "SessionExpiredError";
  }
}

export function getApiRequestLogMetadata(error: unknown): ApiRequestLogMetadata | null {
  if (!(error instanceof ApiRequestError)) {
    return null;
  }

  return {
    kind: error.kind,
    method: error.method,
    endpoint: error.endpoint,
    status: error.status,
    errorName: error.errorName,
  };
}

function logApiRequestFailure(error: ApiRequestError): void {
  console.warn("[Kora] api_request_failed", getApiRequestLogMetadata(error));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!isObject(value)) {
    return false;
  }

  const message = value.message;
  return (
    message === undefined ||
    typeof message === "string" ||
    (Array.isArray(message) && message.every((entry) => typeof entry === "string"))
  );
}

function errorMessageFromPayload(payload: unknown): string {
  if (!isApiErrorPayload(payload)) {
    return "No se pudo completar la solicitud.";
  }

  if (typeof payload.message === "string") {
    return translateApiMessage(payload.message);
  }

  if (Array.isArray(payload.message)) {
    return payload.message.map(translateApiMessage).join(" ");
  }

  return "No se pudo completar la solicitud.";
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string"
  );
}

function isAuthResponse(value: unknown): value is AuthResponse {
  return (
    isObject(value) &&
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    isAuthenticatedUser(value.user)
  );
}

function authResponseFromPayload(value: unknown): AuthResponse {
  if (!isAuthResponse(value)) {
    throw new ApiRequestError(0, "La respuesta de sesión no es válida.", {
      kind: API_ERROR_KIND.NETWORK,
      method: "POST",
      endpoint: "/auth/refresh",
      errorName: "InvalidAuthResponse",
    });
  }

  return value;
}

function prepareUploadUri(uri: string): string {
  if (typeof uri !== "string" || !uri.trim()) {
    throw new Error("Falta la ubicación de la imagen.");
  }

  const normalizedUri = uri.trim();
  if (!LOCAL_IMAGE_URI_PATTERN.test(normalizedUri)) {
    throw new Error("La ubicación de la imagen no es válida.");
  }

  return normalizedUri;
}

function appendReactNativeImagePart(formData: FormData, uri: string, fieldName = "image"): void {
  const reactNativeFormData = formData as unknown as FormData & ReactNativeFormDataAppend;
  reactNativeFormData.append(fieldName, {
    uri,
    name: UPLOAD_FILE_NAME,
    type: UPLOAD_MIME_TYPE,
  });
}

function translateApiMessage(message: string): string {
  const normalizedMessage = message.trim();
  const lowerMessage = normalizedMessage.toLowerCase();

  if (lowerMessage === "email is already registered") {
    return "El correo electrónico ya está registrado.";
  }

  if (lowerMessage === "invalid email or password") {
    return "El correo electrónico o la contraseña no son válidos.";
  }

  if (lowerMessage === "invalid refresh token") {
    return SESSION_EXPIRED_MESSAGE;
  }

  if (lowerMessage.includes("email must be an email")) {
    return "Ingrese un correo electrónico válido.";
  }

  if (lowerMessage.includes("email should not be empty")) {
    return "Ingrese su correo electrónico.";
  }

  if (lowerMessage.includes("password must be longer than or equal to 10 characters")) {
    return "La contraseña debe tener al menos 10 caracteres.";
  }

  if (lowerMessage.includes("password should not be empty")) {
    return "Ingrese una contraseña.";
  }

  if (lowerMessage.includes("refresh token must be a string") || lowerMessage.includes("refresh token should not be empty")) {
    return SESSION_EXPIRED_MESSAGE;
  }

  if (lowerMessage.includes("start a kyc verification before")) {
    return "Inicie una verificación de identidad antes de continuar.";
  }

  if (lowerMessage.includes("a document and selfie must be uploaded")) {
    return "Debe cargar el documento y la fotografía del rostro antes de validar.";
  }

  if (lowerMessage.includes("kyc verification is no longer available")) {
    return "La verificación de identidad ya no está disponible.";
  }

  if (
    lowerMessage.includes("an image file is required") ||
    lowerMessage.includes("multipart field named image")
  ) {
    return "Debe seleccionar una imagen para continuar.";
  }

  if (lowerMessage.includes("image exceeds") || lowerMessage.includes("pixel limit")) {
    return "La imagen supera los límites permitidos.";
  }

  if (lowerMessage.includes("could not be safely normalized")) {
    return "No se pudo procesar la imagen de forma segura.";
  }

  return "No se pudo completar la solicitud.";
}

function getApiBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!configuredUrl) {
    throw new Error("Missing API base URL configuration.");
  }

  return configuredUrl.replace(/\/$/, "");
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return atob(padded);
}

function readAccessTokenExpiry(accessToken: string): number | null {
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    return null;
  }

  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadPart = parts[1];
    if (payloadPart === undefined) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(payloadPart)) as unknown;
    if (!isObject(payload) || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }

    return payload.exp;
  } catch {
    return null;
  }
}

function isAccessTokenExpired(accessToken: string): boolean {
  const expiry = readAccessTokenExpiry(accessToken);
  if (expiry === null) {
    return false;
  }

  return Date.now() / 1000 >= expiry - TOKEN_EXPIRY_MARGIN_SECONDS;
}

function isAuthExemptEndpoint(path: string): boolean {
  const endpoint = toRelativeEndpoint(path);
  return (
    endpoint === "/auth/login" ||
    endpoint === "/auth/register" ||
    endpoint === "/auth/refresh" ||
    endpoint === "/auth/logout"
  );
}

function requestDetails(config: InternalAxiosRequestConfig | undefined): {
  method: string;
  endpoint: string;
} {
  return {
    method: normalizeMethod(config?.method ?? "UNKNOWN"),
    endpoint: toRelativeEndpoint(config?.url ?? "/unknown"),
  };
}

function toApiRequestError(
  error: unknown,
  fallbackMethod: string,
  fallbackEndpoint: string,
): ApiRequestError {
  if (error instanceof ApiRequestError) {
    return error;
  }

  if (axios.isAxiosError<unknown>(error)) {
    const details = requestDetails(error.config);
    const status = error.response?.status ?? 0;
    if (status > 0) {
      return new ApiRequestError(status, errorMessageFromPayload(error.response?.data), {
        kind: API_ERROR_KIND.HTTP,
        method: details.method,
        endpoint: details.endpoint,
        errorName: "HttpError",
      });
    }

    return new ApiRequestError(0, "No se pudo conectar con el servicio de verificación.", {
      kind: API_ERROR_KIND.NETWORK,
      method: details.method,
      endpoint: details.endpoint,
      errorName: getSafeErrorName(error),
    });
  }

  return new ApiRequestError(0, "No se pudo conectar con el servicio de verificación.", {
    kind: API_ERROR_KIND.NETWORK,
    method: fallbackMethod,
    endpoint: fallbackEndpoint,
    errorName: getSafeErrorName(error),
  });
}

async function refreshStoredSession(): Promise<AuthResponse> {
  const storedRefreshToken = currentRefreshToken ?? (await readRefreshToken());
  if (!storedRefreshToken) {
    throw new SessionExpiredError();
  }

  let response: AxiosResponse<unknown>;
  try {
    response = await refreshClient.post<unknown>(
      "/auth/refresh",
      { refreshToken: storedRefreshToken },
      {
        baseURL: getApiBaseUrl(),
        headers: { Accept: "application/json", "Content-Type": "application/json" },
      },
    );
  } catch (error: unknown) {
    throw toApiRequestError(error, "POST", "/auth/refresh");
  }

  const refreshedSession = authResponseFromPayload(response.data);
  await persistSessionTokens(refreshedSession);
  return refreshedSession;
}

function refreshWithSingleFlight(): Promise<AuthResponse> {
  if (!refreshPromise) {
    refreshPromise = refreshStoredSession().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function ensureFreshAccessToken(): Promise<string> {
  const token = currentAccessToken ?? (await readAccessToken());
  if (token && !isAccessTokenExpired(token)) {
    return token;
  }

  try {
    const refreshedSession = await refreshWithSingleFlight();
    return refreshedSession.accessToken;
  } catch (refreshError: unknown) {
    await clearSessionTokens();
    if (refreshError instanceof SessionExpiredError) {
      throw refreshError;
    }

    throw new SessionExpiredError();
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error(MEDIA_READ_ERROR_MESSAGE));
    };
    reader.onerror = () => {
      reject(new Error(MEDIA_READ_ERROR_MESSAGE));
    };
    reader.readAsDataURL(blob);
  });
}

export async function getAuthenticatedMediaSource(
  mediaId: string,
): Promise<AuthenticatedMediaSource> {
  const mediaPath = `/kyc/media/${mediaId}`;
  await ensureFreshAccessToken();

  try {
    const response = await apiClient.get<Blob>(mediaPath, {
      baseURL: getApiBaseUrl(),
      responseType: "blob",
    });
    const dataUri = await readBlobAsDataUrl(response.data);
    return { uri: dataUri };
  } catch (error: unknown) {
    const requestError = toApiRequestError(error, "GET", mediaPath);
    if (!(error instanceof ApiRequestError)) {
      logApiRequestFailure(requestError);
    }
    throw requestError;
  }
}

function installInterceptors(instance: AxiosInstance): void {
  instance.interceptors.request.use(async (config) => {
    if (isAuthExemptEndpoint(config.url ?? "")) {
      return config;
    }

    if (config.data instanceof FormData) {
      // Axios may provide a urlencoded default for POST requests. Let the
      // React Native adapter add the multipart boundary instead.
      config.headers.setContentType(false);
    }

    const token = currentAccessToken;
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
      return config;
    }

    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError<unknown>(error)) {
        return Promise.reject(error);
      }

      const config = error.config;
      const details = requestDetails(config);
      const retryConfig = config as RetryableRequestConfig | undefined;
      const status = error.response?.status ?? 0;

      if (
        status !== 401 ||
        !retryConfig ||
        retryConfig.koraRetryAttempted ||
        isAuthExemptEndpoint(details.endpoint) ||
        retryConfig.data instanceof FormData
      ) {
        const requestError = toApiRequestError(error, details.method, details.endpoint);
        logApiRequestFailure(requestError);
        return Promise.reject(requestError);
      }

      try {
        const refreshedSession = await refreshWithSingleFlight();
        retryConfig.koraRetryAttempted = true;
        retryConfig.headers.set("Authorization", `Bearer ${refreshedSession.accessToken}`);
        return await instance.request(retryConfig);
      } catch (refreshError: unknown) {
        await clearSessionTokens();
        const sessionError = new SessionExpiredError();
        if (!(refreshError instanceof SessionExpiredError)) {
          logApiRequestFailure(sessionError);
        }
        return Promise.reject(sessionError);
      }
    },
  );
}

export const apiClient = axios.create();
export const refreshClient = axios.create();

installInterceptors(apiClient);

export class KoraApiClient {
  async register(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      contentType: "application/json",
    });
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      contentType: "application/json",
    });
  }

  async refreshSession(): Promise<AuthResponse> {
    try {
      return await refreshWithSingleFlight();
    } catch (error: unknown) {
      await clearSessionTokens();
      if (error instanceof SessionExpiredError) {
        throw error;
      }
      throw new SessionExpiredError();
    }
  }

  async logout(refreshToken: string): Promise<void> {
    const path = "/auth/logout";
    try {
      await refreshClient.post<unknown>(
        path,
        { refreshToken },
        {
          baseURL: getApiBaseUrl(),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
        },
      );
    } catch (error: unknown) {
      const requestError = toApiRequestError(error, "POST", path);
      logApiRequestFailure(requestError);
      throw requestError;
    }
  }

  async getMe(): Promise<UserProfile> {
    return this.request<UserProfile>("/users/me", { method: "GET" });
  }

  async startKyc(consentVersion?: string): Promise<KycVerification> {
    return this.request<KycVerification>("/kyc/start", {
      method: "POST",
      body: JSON.stringify(consentVersion ? { consentVersion } : {}),
      contentType: "application/json",
    });
  }

  async getKycConsentRequirements(): Promise<KycConsentRequirements> {
    return this.request<KycConsentRequirements>("/kyc/consent-requirements", { method: "GET" });
  }

  async uploadDocument(uri: string, side: DocumentSide): Promise<KycVerification> {
    return this.uploadImage("/kyc/document", uri, side);
  }

  async uploadSelfie(uri: string): Promise<KycVerification> {
    return this.uploadImage("/kyc/selfie", uri);
  }

  async uploadSelfieCandidates(uris: string[]): Promise<KycVerification> {
    const payload = new FormData();
    for (const uri of uris) {
      appendReactNativeImagePart(payload, uri, "images");
    }
    return this.request<KycVerification>("/kyc/selfie/candidates", {
      method: "POST",
      body: payload,
    });
  }

  async verifyKyc(): Promise<KycVerification> {
    return this.request<KycVerification>("/kyc/verify", { method: "POST" });
  }

  async getCurrentKyc(): Promise<KycVerification | null> {
    return this.request<KycVerification | null>("/kyc/current", { method: "GET" });
  }

  async getKycHistory(cursor?: string): Promise<KycHistoryList> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request<KycHistoryList>(`/kyc/history${query}`, { method: "GET" });
  }

  async getKycHistoryDetail(verificationId: string): Promise<KycHistoryDetail> {
    return this.request<KycHistoryDetail>(`/kyc/history/${encodeURIComponent(verificationId)}`, { method: "GET" });
  }

  private async uploadImage(
    path: string,
    uri: string,
    side?: string,
  ): Promise<KycVerification> {
    let imageUri: string;
    try {
      imageUri = prepareUploadUri(uri);
    } catch (fileError: unknown) {
      const requestError = new ApiRequestError(0, UPLOAD_PREPARATION_ERROR_MESSAGE, {
        kind: API_ERROR_KIND.UPLOAD,
        method: "POST",
        endpoint: path,
        errorName: getSafeErrorName(fileError),
      });
      logApiRequestFailure(requestError);
      throw requestError;
    }

    // Refresh a stale token before the multipart body is built: React Native
    // FormData cannot be replayed by the response interceptor after a 401.
    await ensureFreshAccessToken();

    const payload = new FormData();
    appendReactNativeImagePart(payload, imageUri);

    const query = side ? `?side=${side}` : "";
    return this.request<KycVerification>(`${path}${query}`, {
      method: "POST",
      body: payload,
    });
  }

  private async request<TResponse>(path: string, options: RequestOptions): Promise<TResponse> {
    const method = normalizeMethod(options.method);
    const endpoint = toRelativeEndpoint(path);
    let apiBaseUrl: string;
    try {
      apiBaseUrl = getApiBaseUrl();
    } catch (configurationError: unknown) {
      const requestError = new ApiRequestError(
        0,
        "Configure EXPO_PUBLIC_API_BASE_URL para usar la verificación de identidad.",
        {
          kind: API_ERROR_KIND.CONFIGURATION,
          method,
          endpoint,
          errorName: getSafeErrorName(configurationError),
        },
      );
      logApiRequestFailure(requestError);
      throw requestError;
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }

    try {
      const response = await apiClient.request<unknown>({
        method: options.method,
        url: path,
        baseURL: apiBaseUrl,
        headers,
        data: options.body,
      });
      return response.data as TResponse;
    } catch (error: unknown) {
      const requestError = toApiRequestError(error, method, endpoint);
      if (!(error instanceof ApiRequestError)) {
        logApiRequestFailure(requestError);
      }
      throw requestError;
    }
  }
}

export const koraApiClient = new KoraApiClient();
