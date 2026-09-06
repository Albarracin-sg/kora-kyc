jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: unknown) => target,
}));

import { FILE_STORAGE_PROVIDER } from "../src/config/app-config.service";
import { selectFileStorageProvider } from "../src/kyc/storage/file-storage-provider.factory";
import type { FileStorage } from "../src/kyc/storage/file-storage.port";

const localStorage: FileStorage = {
  write: jest.fn(),
  read: jest.fn(),
  remove: jest.fn(),
};
const b2Storage: FileStorage = {
  write: jest.fn(),
  read: jest.fn(),
  remove: jest.fn(),
};

describe("selectFileStorageProvider", () => {
  it("keeps local storage as the default provider", () => {
    expect(
      selectFileStorageProvider(
        { fileStorageProvider: FILE_STORAGE_PROVIDER.LOCAL },
        () => localStorage,
        () => b2Storage,
      ),
    ).toBe(localStorage);
  });

  it("constructs the B2 provider only when explicitly selected", () => {
    const createLocalStorage = jest.fn(() => localStorage);
    const createB2Storage = jest.fn(() => b2Storage);

    expect(
      selectFileStorageProvider(
        { fileStorageProvider: FILE_STORAGE_PROVIDER.B2 },
        createLocalStorage,
        createB2Storage,
      ),
    ).toBe(b2Storage);
    expect(createB2Storage).toHaveBeenCalledTimes(1);
    expect(createLocalStorage).not.toHaveBeenCalled();
  });
});
