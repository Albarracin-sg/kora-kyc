import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FACE_VERIFICATION_PROVIDER,
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
    GEMINI_API_KEY: "test-gemini-key",
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
