jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: unknown) => target,
}));

import { createHash } from "node:crypto";
import type { AppConfigService } from "../src/config/app-config.service";
import { B2FileStorage } from "../src/kyc/storage/b2-file.storage";

const B2_AUTHORIZE_ACCOUNT_URL =
  "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
const VALID_KEY = "user-id/verification-id/document/front/image-id.jpg";
const TEST_KEY_ID = "test-b2-key-id";
const TEST_APPLICATION_KEY = "test-b2-application-key";
const AUTHORIZATION_TOKEN = "account-authorization-token";
const UPLOAD_AUTHORIZATION_TOKEN = "upload-authorization-token";

interface MockResponseBody {
  ok: boolean;
  status: number;
  json: jest.Mock;
  arrayBuffer: jest.Mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  const response: MockResponseBody = {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    arrayBuffer: jest.fn(),
  };
  return response as unknown as Response;
}

function bytesResponse(body: Buffer, status = 200): Response {
  const response = jsonResponse(null, status) as unknown as MockResponseBody;
  response.arrayBuffer.mockResolvedValue(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  return response as unknown as Response;
}

function authorizationResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    authorizationToken: AUTHORIZATION_TOKEN,
    apiUrl: "https://api.example.test",
    downloadUrl: "https://download.example.test",
    allowed: { bucketId: "bucket-id", bucketName: "kora-storage" },
    ...overrides,
  });
}

function uploadUrlResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    bucketId: "bucket-id",
    uploadUrl: "https://upload.example.test",
    authorizationToken: UPLOAD_AUTHORIZATION_TOKEN,
    ...overrides,
  });
}

function createStorage(): B2FileStorage {
  return new B2FileStorage({
    values: {
      b2KeyId: TEST_KEY_ID,
      b2ApplicationKey: TEST_APPLICATION_KEY,
      b2BucketName: "kora-storage",
    },
  } as unknown as AppConfigService);
}

function createFetchMock(responses: Response[]): jest.Mock {
  const fetchMock = jest.fn(async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected test fetch call");
    }
    return response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function requestInit(fetchMock: jest.Mock, callNumber: number): RequestInit {
  return fetchMock.mock.calls[callNumber]?.[1] as RequestInit;
}

describe("B2FileStorage", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("authorizes with Basic auth and writes, reads, and deletes exact private objects", async () => {
    const body = Buffer.from("jpeg-bytes");
    const fetchMock = createFetchMock([
      authorizationResponse(),
      uploadUrlResponse(),
      jsonResponse({ fileId: "uploaded-file-id", fileName: VALID_KEY }),
      bytesResponse(body),
      jsonResponse({ files: [{ fileId: "stored-file-id", fileName: VALID_KEY }] }),
      jsonResponse({ fileId: "stored-file-id", fileName: VALID_KEY }),
    ]);
    const storage = createStorage();

    await storage.write({ key: VALID_KEY, body });
    await expect(storage.read(VALID_KEY)).resolves.toEqual(body);
    await expect(storage.remove(VALID_KEY)).resolves.toBeUndefined();

    const authorizationInit = requestInit(fetchMock, 0);
    const expectedBasicAuth = Buffer.from(`${TEST_KEY_ID}:${TEST_APPLICATION_KEY}`).toString(
      "base64",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      B2_AUTHORIZE_ACCOUNT_URL,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: `Basic ${expectedBasicAuth}` },
      }),
    );
    expect(authorizationInit.body).toBeUndefined();
    expect(JSON.parse(String(requestInit(fetchMock, 1).body))).toEqual({ bucketId: "bucket-id" });
    expect(JSON.parse(String(requestInit(fetchMock, 4).body))).toEqual({
      bucketId: "bucket-id",
      prefix: VALID_KEY,
      startFileName: VALID_KEY,
      maxFileCount: 1,
    });
    expect(JSON.parse(String(requestInit(fetchMock, 5).body))).toEqual({
      fileName: VALID_KEY,
      fileId: "stored-file-id",
    });

    const uploadRequest = requestInit(fetchMock, 2);
    const uploadHeaders = uploadRequest.headers as Record<string, string>;
    expect(uploadHeaders.Authorization).toBe(UPLOAD_AUTHORIZATION_TOKEN);
    expect(uploadHeaders["X-Bz-File-Name"]).toBe(encodeURIComponent(VALID_KEY));
    expect(uploadHeaders["X-Bz-Content-Sha1"]).toBe(
      createHash("sha1").update(body).digest("hex"),
    );
    expect(uploadRequest.body).toBe(body);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `https://api.example.test/b2api/v2/b2_download_file_by_name?bucketName=kora-storage&fileName=${encodeURIComponent(VALID_KEY)}`,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: AUTHORIZATION_TOKEN },
      }),
    );
  });

  it.each(["../unsafe.jpg", "path\\unsafe.jpg", "not-an-image.png"]) (
    "rejects unsafe storage key %s before contacting B2",
    async (key) => {
      const fetchMock = createFetchMock([]);
      const storage = createStorage();

      await expect(storage.read(key)).rejects.toThrow("B2 storage key is invalid");
      await expect(storage.remove(key)).rejects.toThrow("B2 storage key is invalid");
      await expect(storage.write({ key, body: Buffer.from("unsafe") })).rejects.toThrow(
        "B2 storage key is invalid",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("deletes only the exact file returned by the minimal name lookup", async () => {
    const fetchMock = createFetchMock([
      authorizationResponse(),
      jsonResponse({ files: [{ fileId: "other-file-id", fileName: `${VALID_KEY}-other` }] }),
    ]);
    const storage = createStorage();

    await expect(storage.remove(VALID_KEY)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses authorization and upload metadata until each cache expires", async () => {
    jest.useFakeTimers();
    const body = Buffer.from("jpeg-bytes");
    const fetchMock = createFetchMock([
      authorizationResponse(),
      uploadUrlResponse(),
      jsonResponse({ fileId: "first-file-id", fileName: VALID_KEY }),
      uploadUrlResponse({ uploadUrl: "https://upload-2.example.test" }),
      jsonResponse({ fileId: "second-file-id", fileName: VALID_KEY }),
      authorizationResponse({ authorizationToken: "refreshed-authorization-token" }),
      bytesResponse(body),
    ]);
    const storage = createStorage();

    await storage.write({ key: VALID_KEY, body });
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    await storage.write({ key: VALID_KEY, body });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.filter(([url]) => url === B2_AUTHORIZE_ACCOUNT_URL)).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "https://api.example.test/b2api/v2/b2_get_upload_url"),
    ).toHaveLength(2);

    jest.advanceTimersByTime(22 * 60 * 60 * 1000 + 1);
    await expect(storage.read(VALID_KEY)).resolves.toEqual(body);
    expect(fetchMock.mock.calls.filter(([url]) => url === B2_AUTHORIZE_ACCOUNT_URL)).toHaveLength(2);
  });

  it("refreshes authorization once when B2 reports an expired token", async () => {
    const expectedBody = Buffer.from("jpeg-bytes");
    const fetchMock = createFetchMock([
      authorizationResponse(),
      jsonResponse({ error: "expired" }, 401),
      authorizationResponse({ authorizationToken: "refreshed-authorization-token" }),
      bytesResponse(expectedBody),
    ]);
    const storage = createStorage();

    await expect(storage.read(VALID_KEY)).resolves.toEqual(expectedBody);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter(([url]) => url === B2_AUTHORIZE_ACCOUNT_URL)).toHaveLength(2);
  });

  it("fails with sanitized errors for malformed and non-success responses", async () => {
    const malformedFetch = createFetchMock([authorizationResponse({ allowed: null })]);
    const storage = createStorage();

    await expect(storage.read(VALID_KEY)).rejects.toThrow(
      "B2 storage authorization response was malformed",
    );
    expect(malformedFetch.mock.calls[0]?.[0]).toBe(B2_AUTHORIZE_ACCOUNT_URL);

    const failedFetch = createFetchMock([
      authorizationResponse(),
      jsonResponse({ error: "private provider details" }, 500),
    ]);
    const failedStorage = createStorage();
    try {
      await failedStorage.read(VALID_KEY);
      throw new Error("Expected B2 read to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("B2 storage read failed");
      expect((error as Error).message).not.toContain(VALID_KEY);
      expect((error as Error).message).not.toContain("private provider details");
    }
    expect(failedFetch).toHaveBeenCalledTimes(2);
  });

  it("maps a missing object to a sanitized not-found error", async () => {
    createFetchMock([authorizationResponse(), jsonResponse({ error: "not found" }, 404)]);
    const storage = createStorage();

    await expect(storage.read(VALID_KEY)).rejects.toThrow("B2 storage object not found");
  });
});
