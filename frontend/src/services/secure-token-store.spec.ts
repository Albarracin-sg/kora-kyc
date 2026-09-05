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

import {
  clearTokens,
  readTokens,
  writeAccessToken,
  writeTokens,
} from "./secure-token-store";

describe("secure token store", () => {
  beforeEach(() => {
    mockSecureStoreValues.clear();
  });

  it("persists and clears access and refresh tokens", async () => {
    await writeTokens("access-token", "refresh-token");

    await expect(readTokens()).resolves.toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });

    await clearTokens();

    await expect(readTokens()).resolves.toEqual({ accessToken: null, refreshToken: null });
  });

  it("keeps the existing access-token key for legacy sessions", async () => {
    await writeAccessToken("legacy-access-token");

    await expect(readTokens()).resolves.toEqual({
      accessToken: "legacy-access-token",
      refreshToken: null,
    });
  });
});
