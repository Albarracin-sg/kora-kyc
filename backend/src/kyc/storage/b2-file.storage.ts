import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AppConfigService } from "../../config/app-config.service";
import type { FileStorage, StorageWriteInput } from "./file-storage.port";

const B2_AUTHORIZE_ACCOUNT_URL =
  "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
const B2_API_PATH = "/b2api/v2";
const SAFE_STORAGE_KEY = /^[a-zA-Z0-9/_-]+\.jpg$/;
const CACHE_TTL_MS = {
  AUTHORIZATION: 23 * 60 * 60 * 1000,
  UPLOAD: 60 * 60 * 1000,
} as const;

interface B2AuthorizationState {
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  bucketId: string;
  bucketName: string;
  expiresAt: number;
}

interface B2UploadState {
  uploadUrl: string;
  authorizationToken: string;
  bucketId: string;
  expiresAt: number;
}

interface B2FileVersion {
  fileId: string;
  fileName: string;
}

class B2StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "B2StorageError";
  }
}

class B2AuthorizationExpiredError extends B2StorageError {
  constructor() {
    super("B2 storage authorization expired");
    this.name = "B2AuthorizationExpiredError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(value: Record<string, unknown>, property: string): string {
  const propertyValue = value[property];
  if (typeof propertyValue !== "string" || propertyValue.length === 0) {
    throw new B2StorageError("B2 storage response was malformed");
  }

  return propertyValue;
}

function readHttpsUrl(value: Record<string, unknown>, property: string): string {
  const rawUrl = readRequiredString(value, property);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new B2StorageError("B2 storage response was malformed");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new B2StorageError("B2 storage response was malformed");
  }

  return rawUrl.replace(/\/+$/, "");
}

function readResponseBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new B2StorageError("B2 storage response was malformed");
  }

  return value;
}

@Injectable()
export class B2FileStorage implements FileStorage {
  private readonly keyId: string;
  private readonly applicationKey: string;
  private readonly bucketName: string;
  private authorization: B2AuthorizationState | null = null;
  private upload: B2UploadState | null = null;
  private authorizationRequest: Promise<B2AuthorizationState> | null = null;

  constructor(configService: AppConfigService) {
    const { b2KeyId, b2ApplicationKey, b2BucketName } = configService.values;
    if (!b2KeyId || !b2ApplicationKey || !b2BucketName) {
      throw new Error("B2 storage configuration is incomplete");
    }

    this.keyId = b2KeyId;
    this.applicationKey = b2ApplicationKey;
    this.bucketName = b2BucketName;
  }

  async write(input: StorageWriteInput): Promise<void> {
    this.assertSafeStorageKey(input.key);

    await this.withAuthorizationRetry(async (authorization) => {
      let uploadState = await this.getUploadState(authorization, false);
      let response: unknown;
      try {
        response = await this.uploadFile(uploadState, input);
      } catch (error: unknown) {
        if (!(error instanceof B2AuthorizationExpiredError)) {
          throw error;
        }

        this.upload = null;
        uploadState = await this.getUploadState(authorization, true);
        response = await this.uploadFile(uploadState, input);
      }

      const uploadResponse = readResponseBody(response);
      const uploadedFileName = readRequiredString(uploadResponse, "fileName");
      readRequiredString(uploadResponse, "fileId");
      if (uploadedFileName !== input.key) {
        throw new B2StorageError("B2 storage response was malformed");
      }
    });
  }

  async read(key: string): Promise<Buffer> {
    this.assertSafeStorageKey(key);

    return this.withAuthorizationRetry(async (authorization) => {
      const response = await this.fetchResponse(
        this.createDownloadUrl(authorization, key),
        {
          method: "GET",
          headers: { Authorization: authorization.authorizationToken },
        },
        "B2 storage read failed",
      );

      if (response.status === 404) {
        throw new B2StorageError("B2 storage object not found");
      }
      if (!response.ok) {
        throw this.createResponseError(response, "B2 storage read failed");
      }

      try {
        return Buffer.from(await response.arrayBuffer());
      } catch {
        throw new B2StorageError("B2 storage read failed");
      }
    });
  }

  async remove(key: string): Promise<void> {
    this.assertSafeStorageKey(key);

    await this.withAuthorizationRetry(async (authorization) => {
      const file = await this.findExactFile(authorization, key);
      if (!file) {
        return;
      }

      const response = await this.requestJson(
        this.createApiUrl(authorization, "b2_delete_file_version"),
        {
          method: "POST",
          headers: {
            Authorization: authorization.authorizationToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fileName: file.fileName, fileId: file.fileId }),
        },
        "B2 storage delete failed",
      );
      const deleteResponse = readResponseBody(response);
      const deletedFileName = readRequiredString(deleteResponse, "fileName");
      const deletedFileId = readRequiredString(deleteResponse, "fileId");
      if (deletedFileName !== file.fileName || deletedFileId !== file.fileId) {
        throw new B2StorageError("B2 storage response was malformed");
      }
    });
  }

  private async uploadFile(upload: B2UploadState, input: StorageWriteInput): Promise<unknown> {
    const response = await this.fetchResponse(
      upload.uploadUrl,
      {
        method: "POST",
        headers: {
          Authorization: upload.authorizationToken,
          "Content-Type": "image/jpeg",
          "Content-Length": String(input.body.byteLength),
          "X-Bz-Content-Sha1": createHash("sha1").update(input.body).digest("hex"),
          "X-Bz-File-Name": encodeURIComponent(input.key),
        },
        body: input.body as unknown as BodyInit,
      },
      "B2 storage write failed",
    );

    if (!response.ok) {
      throw this.createResponseError(response, "B2 storage write failed");
    }

    try {
      return await response.json();
    } catch {
      throw new B2StorageError("B2 storage response was malformed");
    }
  }

  private async getUploadState(
    authorization: B2AuthorizationState,
    forceRefresh: boolean,
  ): Promise<B2UploadState> {
    if (
      !forceRefresh &&
      this.upload &&
      this.upload.bucketId === authorization.bucketId &&
      this.upload.expiresAt > Date.now()
    ) {
      return this.upload;
    }

    const response = await this.requestJson(
      this.createApiUrl(authorization, "b2_get_upload_url"),
      {
        method: "POST",
        headers: {
          Authorization: authorization.authorizationToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bucketId: authorization.bucketId }),
      },
      "B2 storage upload authorization failed",
    );
    const uploadResponse = readResponseBody(response);
    const bucketId = readRequiredString(uploadResponse, "bucketId");
    const uploadUrl = readHttpsUrl(uploadResponse, "uploadUrl");
    const authorizationToken = readRequiredString(uploadResponse, "authorizationToken");
    if (bucketId !== authorization.bucketId) {
      throw new B2StorageError("B2 storage bucket authorization failed");
    }

    this.upload = {
      bucketId,
      uploadUrl,
      authorizationToken,
      expiresAt: Date.now() + CACHE_TTL_MS.UPLOAD,
    };
    return this.upload;
  }

  private async findExactFile(
    authorization: B2AuthorizationState,
    key: string,
  ): Promise<B2FileVersion | null> {
    const response = await this.requestJson(
      this.createApiUrl(authorization, "b2_list_file_names"),
      {
        method: "POST",
        headers: {
          Authorization: authorization.authorizationToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucketId: authorization.bucketId,
          prefix: key,
          startFileName: key,
          maxFileCount: 1,
        }),
      },
      "B2 storage delete lookup failed",
    );
    const listResponse = readResponseBody(response);
    const files = listResponse.files;
    if (!Array.isArray(files)) {
      throw new B2StorageError("B2 storage response was malformed");
    }

    for (const file of files) {
      if (!isRecord(file)) {
        throw new B2StorageError("B2 storage response was malformed");
      }

      const fileName = readRequiredString(file, "fileName");
      const fileId = readRequiredString(file, "fileId");
      if (fileName === key) {
        return { fileId, fileName };
      }
    }

    return null;
  }

  private async getAuthorization(forceRefresh: boolean): Promise<B2AuthorizationState> {
    if (!forceRefresh && this.authorization && this.authorization.expiresAt > Date.now()) {
      return this.authorization;
    }

    if (this.authorizationRequest) {
      return this.authorizationRequest;
    }

    this.authorizationRequest = this.authorizeAccount();
    try {
      this.authorization = await this.authorizationRequest;
      this.upload = null;
      return this.authorization;
    } finally {
      this.authorizationRequest = null;
    }
  }

  private async authorizeAccount(): Promise<B2AuthorizationState> {
    const credentials = Buffer.from(`${this.keyId}:${this.applicationKey}`, "utf8").toString(
      "base64",
    );
    const response = await this.fetchResponse(
      B2_AUTHORIZE_ACCOUNT_URL,
      { method: "GET", headers: { Authorization: `Basic ${credentials}` } },
      "B2 storage authorization failed",
    );
    if (!response.ok) {
      throw new B2StorageError("B2 storage authorization failed");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new B2StorageError("B2 storage authorization failed");
    }

    try {
      const authorizationResponse = readResponseBody(body);
      const allowed = authorizationResponse.allowed;
      if (!isRecord(allowed)) {
        throw new B2StorageError("B2 storage authorization response was malformed");
      }

      const bucketId = readRequiredString(allowed, "bucketId");
      const bucketName = readRequiredString(allowed, "bucketName");
      if (bucketName !== this.bucketName) {
        throw new B2StorageError("B2 storage bucket authorization failed");
      }

      return {
        authorizationToken: readRequiredString(authorizationResponse, "authorizationToken"),
        apiUrl: readHttpsUrl(authorizationResponse, "apiUrl"),
        downloadUrl: readHttpsUrl(authorizationResponse, "downloadUrl"),
        bucketId,
        bucketName,
        expiresAt: Date.now() + CACHE_TTL_MS.AUTHORIZATION,
      };
    } catch (error: unknown) {
      if (error instanceof B2StorageError) {
        throw error;
      }
      throw new B2StorageError("B2 storage authorization failed");
    }
  }

  private async withAuthorizationRetry<T>(
    operation: (authorization: B2AuthorizationState) => Promise<T>,
  ): Promise<T> {
    let forceRefresh = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const authorization = await this.getAuthorization(forceRefresh);
      try {
        return await operation(authorization);
      } catch (error: unknown) {
        if (!(error instanceof B2AuthorizationExpiredError) || attempt === 1) {
          throw error;
        }

        this.invalidateAuthorization(authorization);
        forceRefresh = true;
      }
    }

    throw new B2StorageError("B2 storage operation failed");
  }

  private invalidateAuthorization(authorization: B2AuthorizationState): void {
    if (this.authorization?.authorizationToken !== authorization.authorizationToken) {
      return;
    }

    this.authorization = null;
    this.upload = null;
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    failureMessage: string,
  ): Promise<unknown> {
    const response = await this.fetchResponse(url, init, failureMessage);
    if (!response.ok) {
      throw this.createResponseError(response, failureMessage);
    }

    try {
      return await response.json();
    } catch {
      throw new B2StorageError("B2 storage response was malformed");
    }
  }

  private async fetchResponse(
    url: string,
    init: RequestInit,
    failureMessage: string,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new B2StorageError(failureMessage);
    }
  }

  private createResponseError(response: Response, failureMessage: string): B2StorageError {
    if (response.status === 401) {
      return new B2AuthorizationExpiredError();
    }
    return new B2StorageError(failureMessage);
  }

  private createApiUrl(authorization: B2AuthorizationState, operation: string): string {
    return `${authorization.apiUrl}${B2_API_PATH}/${operation}`;
  }

  private createDownloadUrl(authorization: B2AuthorizationState, key: string): string {
    return `${authorization.downloadUrl}/file/${encodeURIComponent(
      authorization.bucketName,
    )}/${encodeURIComponent(key)}`;
  }

  private assertSafeStorageKey(key: string): void {
    if (!SAFE_STORAGE_KEY.test(key)) {
      throw new B2StorageError("B2 storage key is invalid");
    }
  }
}
