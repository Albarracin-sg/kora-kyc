import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileStorage } from "../src/kyc/storage/local-file.storage";
import type { AppConfigService } from "../src/config/app-config.service";

jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: unknown) => target,
}));

const VALID_KEY = "verification-id/document/front/00000000-0000-4000-8000-000000000000.jpg";

describe("LocalFileStorage", () => {
  let rootDirectory: string;
  let storage: LocalFileStorage;

  beforeAll(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "kora-kyc-storage-"));
    const configService = {
      values: { localStorageRoot: rootDirectory },
    } as unknown as AppConfigService;
    storage = new LocalFileStorage(configService);
  });

  afterAll(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it("writes and reads a stored image under the configured root", async () => {
    const body = Buffer.from("stored-image-bytes");

    await storage.write({ key: VALID_KEY, body });
    await expect(storage.read(VALID_KEY)).resolves.toEqual(body);
  });

  it.each([
    ["../escape.jpg", "Invalid local storage key"],
    ["a.b.jpg", "Invalid local storage key"],
    ["no-extension", "Invalid local storage key"],
    ["path\\traversal.jpg", "Invalid local storage key"],
  ])("rejects the traversal key %s before touching the filesystem", async (key, message) => {
    await expect(
      storage.write({ key, body: Buffer.from("unsafe") }),
    ).rejects.toThrow(message);
  });

  it("refuses absolute paths that escape the configured root", async () => {
    await expect(
      storage.read("/etc/passwd.jpg"),
    ).rejects.toThrow("Local storage key escapes the configured root");
  });
});