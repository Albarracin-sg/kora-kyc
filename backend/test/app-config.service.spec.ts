import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FACE_VERIFICATION_PROVIDER,
  FILE_STORAGE_PROVIDER,
  KYC_DOCUMENT_PROVIDER,
  createAppConfiguration,
} from "../src/config/app-config.service";

jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: unknown) => target,
}));

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://test:test@localhost:5432/kyc_test",
    JWT_SECRET: "test-jwt-secret",
    KYC_DOCUMENT_HASH_PEPPER: "test-document-pepper",
    KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.OPENCODE_GO,
    OPENCODE_GO_API_KEY: "test-opencode-go-key",
  };
}

describe("createAppConfiguration storage root", () => {
  let workingDirectory: string;

  beforeAll(async () => {
    workingDirectory = await mkdtemp(join(tmpdir(), "kora-kyc-config-"));
  });

  afterAll(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it("defaults the local storage root to upload when LOCAL_STORAGE_ROOT is unset", () => {
    const config = createAppConfiguration(baseEnvironment(), workingDirectory);

    expect(config.localStorageRoot).toBe(resolve(workingDirectory, "upload"));
  });

  it("keeps LOCAL_STORAGE_ROOT as an explicit override for the storage root", () => {
    const config = createAppConfiguration(
      { ...baseEnvironment(), LOCAL_STORAGE_ROOT: "./custom-storage" },
      workingDirectory,
    );

    expect(config.localStorageRoot).toBe(resolve(workingDirectory, "custom-storage"));
  });

  it("defaults file storage to local and ignores B2 settings unless selected", () => {
    const config = createAppConfiguration(
      { ...baseEnvironment(), B2_BUCKET_NAME: "unused-bucket" },
      workingDirectory,
    );

    expect(config.fileStorageProvider).toBe(FILE_STORAGE_PROVIDER.LOCAL);
    expect(config.b2KeyId).toBeNull();
    expect(config.b2ApplicationKey).toBeNull();
    expect(config.b2BucketName).toBeNull();
  });

  it("requires and parses the bucket-scoped B2 settings when B2 is selected", () => {
    const config = createAppConfiguration(
      {
        ...baseEnvironment(),
        FILE_STORAGE_PROVIDER: FILE_STORAGE_PROVIDER.B2,
        B2_KEY_ID: "test-b2-key-id",
        B2_APPLICATION_KEY: "test-b2-application-key",
        B2_BUCKET_NAME: "kora-storage",
      },
      workingDirectory,
    );

    expect(config.fileStorageProvider).toBe(FILE_STORAGE_PROVIDER.B2);
    expect(config.b2KeyId).toBe("test-b2-key-id");
    expect(config.b2ApplicationKey).toBe("test-b2-application-key");
    expect(config.b2BucketName).toBe("kora-storage");
  });

  it("rejects incomplete B2 settings only when B2 is selected", () => {
    expect(() =>
      createAppConfiguration(
        {
          ...baseEnvironment(),
          FILE_STORAGE_PROVIDER: FILE_STORAGE_PROVIDER.B2,
          B2_KEY_ID: "test-b2-key-id",
          B2_BUCKET_NAME: "kora-storage",
        },
        workingDirectory,
      ),
    ).toThrow("Missing required environment variable: B2_APPLICATION_KEY");
  });

  it("rejects an unknown file storage provider", () => {
    expect(() =>
      createAppConfiguration(
        { ...baseEnvironment(), FILE_STORAGE_PROVIDER: "s3" },
        workingDirectory,
      ),
    ).toThrow("FILE_STORAGE_PROVIDER must be local or b2");
  });
});

describe("createAppConfiguration face verification provider", () => {
  it("defaults the face verification provider to local when unset", () => {
    const config = createAppConfiguration(baseEnvironment(), process.cwd());

    expect(config.faceVerificationProvider).toBe(FACE_VERIFICATION_PROVIDER.LOCAL);
  });

  it("selects the face_service provider and keeps documented defaults", () => {
    const config = createAppConfiguration(
      {
        ...baseEnvironment(),
        FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
        FACE_API_KEY: "test-face-api-key",
      },
      process.cwd(),
    );

    expect(config.faceVerificationProvider).toBe(FACE_VERIFICATION_PROVIDER.FACE_SERVICE);
    expect(config.faceServiceUrl).toBe("http://localhost:8000");
    expect(config.faceServiceTimeoutMs).toBe(30_000);
  });

  it("keeps distance and detector confidence settings explicitly local-only", () => {
    const config = createAppConfiguration(
      {
        ...baseEnvironment(),
        KYC_LOCAL_FACE_MAX_DISTANCE: "0.4",
        KYC_LOCAL_FACE_MIN_CONFIDENCE: "0.8",
      },
      process.cwd(),
    );

    expect(config.localFaceMaximumDistance).toBe(0.4);
    expect(config.localFaceMinimumConfidence).toBe(0.8);
  });

  it("rejects an unknown face verification provider value", () => {
    expect(() =>
      createAppConfiguration(
        { ...baseEnvironment(), FACE_VERIFICATION_PROVIDER: "cloud" },
        process.cwd(),
      ),
    ).toThrow("FACE_VERIFICATION_PROVIDER must be local or face_service");
  });

  it("uses an explicit FACE_SERVICE_URL without a trailing slash", () => {
    const config = createAppConfiguration(
      {
        ...baseEnvironment(),
        FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
        FACE_API_KEY: "test-face-api-key",
        FACE_SERVICE_URL: "https://face.internal.example.com/",
      },
      process.cwd(),
    );

    expect(config.faceServiceUrl).toBe("https://face.internal.example.com");
  });

  it("rejects a non-http(s) FACE_SERVICE_URL", () => {
    expect(() =>
      createAppConfiguration(
        {
          ...baseEnvironment(),
          FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
          FACE_API_KEY: "test-face-api-key",
          FACE_SERVICE_URL: "ftp://face.internal",
        },
        process.cwd(),
      ),
    ).toThrow("FACE_SERVICE_URL must be an http(s) URL");
  });

  it("rejects an HTTP face service URL in production", () => {
    expect(() =>
      createAppConfiguration(
        {
          ...baseEnvironment(),
          NODE_ENV: "production",
          FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
          FACE_API_KEY: "test-face-api-key",
          FACE_SERVICE_URL: "http://face.internal",
        },
        process.cwd(),
      ),
    ).toThrow("FACE_SERVICE_URL must use https in production");
  });

  it("bounds the face service timeout to a sane range", () => {
    expect(() =>
      createAppConfiguration(
        {
          ...baseEnvironment(),
          FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
          FACE_API_KEY: "test-face-api-key",
          FACE_SERVICE_TIMEOUT_MS: "1",
        },
        process.cwd(),
      ),
    ).toThrow("FACE_SERVICE_TIMEOUT_MS must be between 1000 and 120000");
  });

  it("rejects a remote face service without its required API key", () => {
    expect(() =>
      createAppConfiguration(
        {
          ...baseEnvironment(),
          FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
          FACE_API_KEY: " ",
        },
        process.cwd(),
      ),
    ).toThrow("FACE_API_KEY is required when FACE_VERIFICATION_PROVIDER=face_service");
  });

  it("reads an explicit FACE_API_KEY", () => {
    const config = createAppConfiguration(
      {
        ...baseEnvironment(),
        FACE_VERIFICATION_PROVIDER: FACE_VERIFICATION_PROVIDER.FACE_SERVICE,
        FACE_API_KEY: "test-face-api-key",
      },
      process.cwd(),
    );

    expect(config.faceApiKey).toBe("test-face-api-key");
  });
});

describe("createAppConfiguration OpenCode Go document provider", () => {
  it("defaults OpenCode Go settings without exposing a secret", () => {
    const config = createAppConfiguration(
      {
        DATABASE_URL: "postgresql://test:test@localhost:5432/kyc_test",
        JWT_SECRET: "test-jwt-secret",
        KYC_DOCUMENT_HASH_PEPPER: "test-document-pepper",
        OPENCODE_GO_API_KEY: "test-opencode-go-key",
      },
      process.cwd(),
    );

    expect(config.documentProvider).toBe(KYC_DOCUMENT_PROVIDER.OPENCODE_GO);
    expect(config.openCodeGoApiKey).toBe("test-opencode-go-key");
    expect(config.openCodeGoBaseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(config.openCodeGoDocumentModel).toBe(
      "opencode-go/deepseek-v4-flash-vision-exp",
    );
    expect(config.openCodeGoDocumentTimeoutMs).toBe(30_000);
  });

  it("requires the OpenCode Go key only when OpenCode Go is selected", () => {
    expect(() =>
      createAppConfiguration(
        {
          DATABASE_URL: "postgresql://test:test@localhost:5432/kyc_test",
          JWT_SECRET: "test-jwt-secret",
          KYC_DOCUMENT_HASH_PEPPER: "test-document-pepper",
          KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.OPENCODE_GO,
        },
        process.cwd(),
      ),
    ).toThrow("OPENCODE_GO_API_KEY is required when KYC_DOCUMENT_PROVIDER=opencode-go");
  });

  it("rejects non-OpenCode Go model identifiers and insecure production URLs", () => {
    const baseEnvironment: NodeJS.ProcessEnv = {
      DATABASE_URL: "postgresql://test:test@localhost:5432/kyc_test",
      JWT_SECRET: "test-jwt-secret",
      KYC_DOCUMENT_HASH_PEPPER: "test-document-pepper",
      KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.OPENCODE_GO,
      OPENCODE_GO_API_KEY: "test-opencode-go-key",
    };

    expect(() =>
      createAppConfiguration(
        { ...baseEnvironment, OPENCODE_GO_DOCUMENT_MODEL: "deepseek-v4-flash-vision-exp" },
        process.cwd(),
      ),
    ).toThrow("OPENCODE_GO_DOCUMENT_MODEL must use the opencode-go/<model-id> format");
    expect(() =>
      createAppConfiguration(
        { ...baseEnvironment, NODE_ENV: "production", OPENCODE_GO_BASE_URL: "http://provider" },
        process.cwd(),
      ),
    ).toThrow("OPENCODE_GO_BASE_URL must use https in production");
  });
});
