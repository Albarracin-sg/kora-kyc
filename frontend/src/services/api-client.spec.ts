import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  API_ERROR_KIND,
  ApiRequestError,
  apiClient,
  clearSessionTokens,
  getAuthenticatedMediaSource,
  KoraApiClient,
  persistSessionTokens,
  refreshClient,
  setSessionTokens,
  SessionExpiredError,
} from "./api-client";
import { DOCUMENT_SIDE } from "../types/api";

const nowEpochSeconds = Math.floor(Date.now() / 1000);
const FRESH_TOKEN = createJwt(nowEpochSeconds + 900);
const EXPIRED_TOKEN = createJwt(nowEpochSeconds - 900);
const FAKE_MEDIA_DATA_URI = "data:image/jpeg;base64,AA==";
const FAKE_MEDIA_BLOB = new Blob(["media-bytes"], { type: "image/jpeg" });

function createJwt(expiryEpochSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify({ exp: expiryEpochSeconds }));
  return `${header}.${body}.signature`;
}

const mockSecureStoreValues = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStoreValues.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStoreValues.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStoreValues.delete(key);
    return Promise.resolve();
  }),
}));

function responseWithPayload(
  config: InternalAxiosRequestConfig,
  payload: unknown,
  status = 200,
): AxiosResponse<unknown> {
  return {
    data: payload,
    status,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    request: {},
  };
}

function axiosError(
  config: InternalAxiosRequestConfig,
  status: number,
  payload: unknown,
): AxiosError<unknown> {
  return new AxiosError(
    "Request failed",
    "ERR_BAD_REQUEST",
    config,
    undefined,
    responseWithPayload(config, payload, status),
  );
}

function installAdapter(
  instance: AxiosInstance,
  handler: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse<unknown>>,
): void {
  instance.defaults.adapter = async (config) => handler(config);
}

class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(_blob: Blob): void {
    Promise.resolve().then(() => {
      this.result = FAKE_MEDIA_DATA_URI;
      this.onload?.();
    });
  }
}

const ORIGINAL_FILE_READER = globalThis.FileReader;

describe("KoraApiClient", () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const originalApiAdapter = apiClient.defaults.adapter;
  const originalRefreshAdapter = refreshClient.defaults.adapter;

  beforeEach(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "http://192.168.2.8:3000";
    globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
    await clearSessionTokens();
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl;
    }

    globalThis.FileReader = ORIGINAL_FILE_READER;
    apiClient.defaults.adapter = originalApiAdapter;
    refreshClient.defaults.adapter = originalRefreshAdapter;
    jest.restoreAllMocks();
  });

  it("uses Axios for JSON registration without exposing a token", async () => {
    let requestConfig: InternalAxiosRequestConfig | undefined;
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        user: { id: "user-id", email: "test@example.com" },
      });
    });

    await new KoraApiClient().register("test@example.com", "a-secure-password");

    expect(requestConfig?.url).toBe("/auth/register");
    expect(requestConfig?.baseURL).toBe("http://192.168.2.8:3000");
    expect(requestConfig?.headers.get("Accept")).toBe("application/json");
    expect(requestConfig?.headers.get("Content-Type")).toBe("application/json");
    expect(requestConfig?.headers.get("Authorization")).toBeUndefined();
    expect(requestConfig?.data).toBe(JSON.stringify({ email: "test@example.com", password: "a-secure-password" }));
  });

  it("adds the current access token through the request interceptor", async () => {
    setSessionTokens({ accessToken: "access-token", refreshToken: "refresh-token" });
    let requestConfig: InternalAxiosRequestConfig | undefined;
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, { id: "user-id", email: "test@example.com", createdAt: "2026-01-01" });
    });

    await new KoraApiClient().getMe();

    expect(requestConfig?.headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("sends the accepted remote biometric consent version only to the backend KYC start endpoint", async () => {
    setSessionTokens({ accessToken: "test-token", refreshToken: "refresh-token" });
    let requestConfig: InternalAxiosRequestConfig | undefined;
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, { status: "CREATED" });
    });

    await new KoraApiClient().startKyc("remote-verification-v2");

    expect(requestConfig?.url).toBe("/kyc/start");
    expect(requestConfig?.data).toBe(JSON.stringify({ consentVersion: "remote-verification-v2" }));
    expect(requestConfig?.headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("gets authenticated consent requirements from the backend", async () => {
    setSessionTokens({ accessToken: "test-token", refreshToken: "refresh-token" });
    let requestConfig: InternalAxiosRequestConfig | undefined;
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, {
        requiresExternalProcessing: true,
        consentVersion: "remote-verification-v2",
      });
    });

    await expect(new KoraApiClient().getKycConsentRequirements()).resolves.toEqual({
      requiresExternalProcessing: true,
      consentVersion: "remote-verification-v2",
    });
    expect(requestConfig?.url).toBe("/kyc/consent-requirements");
    expect(requestConfig?.headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("requests the private history with an opaque cursor only in the authenticated header", async () => {
    setSessionTokens({ accessToken: "test-token", refreshToken: "refresh-token" });
    let requestConfig: InternalAxiosRequestConfig | undefined;
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, { items: [], nextCursor: null });
    });

    await expect(new KoraApiClient().getKycHistory("opaque-cursor")).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(requestConfig?.url).toBe("/kyc/history?cursor=opaque-cursor");
    expect(requestConfig?.headers.get("Authorization")).toBe("Bearer test-token");
    expect(`${requestConfig?.url ?? ""}`).not.toContain("test-token");
  });

  it("preserves safe metadata when the network request fails", async () => {
    setSessionTokens({ accessToken: FRESH_TOKEN, refreshToken: "refresh-token" });
    installAdapter(apiClient, async (config) => {
      throw new TypeError("private transport details");
    });

    const request = new KoraApiClient().uploadSelfie("file://capture-placeholder.jpg");

    await expect(request).rejects.toBeInstanceOf(ApiRequestError);
    await expect(request).rejects.toMatchObject({
      status: 0,
      kind: API_ERROR_KIND.NETWORK,
      method: "POST",
      endpoint: "/kyc/selfie",
      errorName: "TypeError",
    });
  });

  it("sends the flat React Native URI part in the image multipart field without setting Content-Type", async () => {
    setSessionTokens({ accessToken: "test-token", refreshToken: "refresh-token" });
    let requestConfig: InternalAxiosRequestConfig | undefined;
    const appendMock = jest.spyOn(FormData.prototype, "append");
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, { status: "DOCUMENT_UPLOADED" });
    });

    await new KoraApiClient().uploadDocument(
      "file:///capture-placeholder.jpg",
      DOCUMENT_SIDE.FRONT,
    );

    expect(requestConfig?.data).toBeInstanceOf(FormData);
    expect(appendMock).toHaveBeenCalledWith(
      "image",
      {
        uri: "file:///capture-placeholder.jpg",
        name: "capture.jpg",
        type: "image/jpeg",
      },
    );
    expect(requestConfig?.headers.get("Authorization")).toBe("Bearer test-token");
    expect(requestConfig?.headers.toJSON()).not.toHaveProperty("Content-Type");
    expect(requestConfig?.url).toBe("/kyc/document?side=FRONT");
  });

  it.each(["https://example.com/capture.jpg", "data:image/jpeg;base64,AA=="])(
    "returns a visible upload error when the capture URI is invalid (%s)",
    async (uri) => {
      const warningMock = jest.spyOn(console, "warn").mockImplementation();
      const adapterMock = jest.fn();
      installAdapter(apiClient, adapterMock);

      await expect(new KoraApiClient().uploadSelfie(uri)).rejects.toMatchObject({
        status: 0,
        kind: API_ERROR_KIND.UPLOAD,
        method: "POST",
        endpoint: "/kyc/selfie",
        errorName: "Error",
        message: "No se pudo preparar la imagen para la carga. Vuelva a capturarla e inténtelo de nuevo.",
      });
      expect(adapterMock).not.toHaveBeenCalled();
      expect(JSON.stringify(warningMock.mock.calls)).not.toContain(uri);
    },
  );

  it("refreshes once after a 401, stores the rotation, and retries the request", async () => {
    setSessionTokens({ accessToken: "expired-access", refreshToken: "refresh-one" });
    let protectedRequestCount = 0;
    let refreshRequestCount = 0;
    installAdapter(apiClient, async (config) => {
      protectedRequestCount += 1;
      if (config.headers.get("Authorization") === "Bearer expired-access") {
        throw axiosError(config, 401, { message: "Unauthorized" });
      }
      return responseWithPayload(config, {
        id: "user-id",
        email: "test@example.com",
        createdAt: "2026-01-01",
      });
    });
    installAdapter(refreshClient, async (config) => {
      refreshRequestCount += 1;
      return responseWithPayload(config, {
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        user: { id: "user-id", email: "test@example.com" },
      });
    });

    await new KoraApiClient().getMe();

    expect(protectedRequestCount).toBe(2);
    expect(refreshRequestCount).toBe(1);
    expect(mockSecureStoreValues.get("kora.kyc.access-token")).toBe("rotated-access");
    expect(mockSecureStoreValues.get("kora.kyc.refresh-token")).toBe("rotated-refresh");
  });

  it("shares one refresh promise across concurrent 401 responses", async () => {
    setSessionTokens({ accessToken: "expired-access", refreshToken: "refresh-one" });
    let protectedRequestCount = 0;
    let refreshRequestCount = 0;
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    installAdapter(apiClient, async (config) => {
      protectedRequestCount += 1;
      if (config.headers.get("Authorization") === "Bearer expired-access") {
        throw axiosError(config, 401, { message: "Unauthorized" });
      }
      return responseWithPayload(config, {
        id: "user-id",
        email: "test@example.com",
        createdAt: "2026-01-01",
      });
    });
    installAdapter(refreshClient, async (config) => {
      refreshRequestCount += 1;
      await refreshGate;
      return responseWithPayload(config, {
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        user: { id: "user-id", email: "test@example.com" },
      });
    });

    const firstRequest = new KoraApiClient().getMe();
    const secondRequest = new KoraApiClient().getMe();
    while (refreshRequestCount === 0) {
      await Promise.resolve();
    }
    releaseRefresh?.();
    await Promise.all([firstRequest, secondRequest]);

    expect(refreshRequestCount).toBe(1);
    expect(protectedRequestCount).toBe(4);
  });

  it("clears both tokens and returns a session error when refresh fails", async () => {
    await persistSessionTokens({
      accessToken: "expired-access",
      refreshToken: "refresh-one",
      user: { id: "user-id", email: "test@example.com" },
    });
    const warningMock = jest.spyOn(console, "warn").mockImplementation();
    installAdapter(apiClient, async (config) => {
      throw axiosError(config, 401, { message: "Unauthorized" });
    });
    installAdapter(refreshClient, async (config) => {
      throw axiosError(config, 401, { message: "Invalid refresh token" });
    });

    await expect(new KoraApiClient().getMe()).rejects.toBeInstanceOf(SessionExpiredError);

    expect(mockSecureStoreValues.has("kora.kyc.access-token")).toBe(false);
    expect(mockSecureStoreValues.has("kora.kyc.refresh-token")).toBe(false);
    expect(JSON.stringify(warningMock.mock.calls)).not.toContain("refresh-one");
  });

  it("rotates a stale access token before building the multipart upload body", async () => {
    setSessionTokens({ accessToken: EXPIRED_TOKEN, refreshToken: "refresh-one" });
    let protectedRequestCount = 0;
    let refreshRequestCount = 0;
    let authHeader: string | null = null;
    installAdapter(apiClient, async (config) => {
      protectedRequestCount += 1;
      const headerValue = config.headers.get("Authorization");
      authHeader = typeof headerValue === "string" ? headerValue : null;
      return responseWithPayload(config, { status: "SELFIE_UPLOADED" });
    });
    installAdapter(refreshClient, async (config) => {
      refreshRequestCount += 1;
      return responseWithPayload(config, {
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        user: { id: "user-id", email: "test@example.com" },
      });
    });

    await new KoraApiClient().uploadSelfie("file:///capture-placeholder.jpg");

    expect(refreshRequestCount).toBe(1);
    expect(protectedRequestCount).toBe(1);
    expect(authHeader).toBe("Bearer rotated-access");
  });

  it("does not auto-retry a multipart upload after a 401", async () => {
    setSessionTokens({ accessToken: FRESH_TOKEN, refreshToken: "refresh-one" });
    let protectedRequestCount = 0;
    let refreshRequestCount = 0;
    installAdapter(apiClient, async (config) => {
      protectedRequestCount += 1;
      throw axiosError(config, 401, { message: "Unauthorized" });
    });
    installAdapter(refreshClient, async (config) => {
      refreshRequestCount += 1;
      return responseWithPayload(config, {
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        user: { id: "user-id", email: "test@example.com" },
      });
    });

    await expect(
      new KoraApiClient().uploadSelfie("file:///capture-placeholder.jpg"),
    ).rejects.toMatchObject({
      status: 401,
      kind: API_ERROR_KIND.HTTP,
      method: "POST",
      endpoint: "/kyc/selfie",
    });

    expect(protectedRequestCount).toBe(1);
    expect(refreshRequestCount).toBe(0);
  });

  it("reuses a non-expired access token without refreshing", async () => {
    setSessionTokens({ accessToken: FRESH_TOKEN, refreshToken: "refresh-one" });
    let refreshRequestCount = 0;
    let authHeader: string | null = null;
    installAdapter(apiClient, async (config) => {
      const headerValue = config.headers.get("Authorization");
      authHeader = typeof headerValue === "string" ? headerValue : null;
      return responseWithPayload(config, { status: "DOCUMENT_UPLOADED" });
    });
    installAdapter(refreshClient, async (config) => {
      refreshRequestCount += 1;
      return responseWithPayload(config, {
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        user: { id: "user-id", email: "test@example.com" },
      });
    });

    await new KoraApiClient().uploadDocument(
      "file:///capture-placeholder.jpg",
      DOCUMENT_SIDE.FRONT,
    );

    expect(refreshRequestCount).toBe(0);
    expect(authHeader).toBe(`Bearer ${FRESH_TOKEN}`);
  });

  it("builds a data URI media source from the shared axios instance without leaking tokens into URLs", async () => {
    setSessionTokens({ accessToken: FRESH_TOKEN, refreshToken: "refresh-one" });
    let requestConfig: InternalAxiosRequestConfig | undefined;
    installAdapter(apiClient, async (config) => {
      requestConfig = config;
      return responseWithPayload(config, FAKE_MEDIA_BLOB);
    });

    const source = await getAuthenticatedMediaSource("cabcdefghijklmnopqrstuvwx");

    expect(requestConfig?.method).toBe("get");
    expect(requestConfig?.url).toBe("/kyc/media/cabcdefghijklmnopqrstuvwx");
    expect(requestConfig?.baseURL).toBe("http://192.168.2.8:3000");
    expect(requestConfig?.responseType).toBe("blob");
    expect(requestConfig?.headers.get("Authorization")).toBe(`Bearer ${FRESH_TOKEN}`);
    expect(source).toEqual({ uri: FAKE_MEDIA_DATA_URI });
    expect(source.uri.startsWith("data:image/jpeg;base64,")).toBe(true);

    const requestedUrl = `${requestConfig?.baseURL ?? ""}${requestConfig?.url ?? ""}`;
    expect(requestedUrl).not.toContain(FRESH_TOKEN);
    expect(requestedUrl).not.toContain("Bearer");
    expect(source.uri).not.toContain(FRESH_TOKEN);
    expect(source.uri).not.toContain("Bearer");
  });

  it("fails fast with metadata-only errors when the media request is not 2xx", async () => {
    setSessionTokens({ accessToken: FRESH_TOKEN, refreshToken: "refresh-one" });
    const warningMock = jest.spyOn(console, "warn").mockImplementation();
    installAdapter(apiClient, async (config) => {
      throw axiosError(config, 404, { message: "Not Found" });
    });

    await expect(
      getAuthenticatedMediaSource("cabcdefghijklmnopqrstuvwx"),
    ).rejects.toMatchObject({
      status: 404,
      kind: API_ERROR_KIND.HTTP,
      method: "GET",
      endpoint: "/kyc/media/cabcdefghijklmnopqrstuvwx",
    });

    expect(warningMock).toHaveBeenCalled();
    expect(JSON.stringify(warningMock.mock.calls)).not.toContain(FRESH_TOKEN);
  });
});
