import * as SecureStore from "expo-secure-store";

const SECURE_STORE_KEYS = {
  ACCESS_TOKEN: "kora.kyc.access-token",
  REFRESH_TOKEN: "kora.kyc.refresh-token",
} as const;

const TOKEN_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

export async function readAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN, TOKEN_OPTIONS);
}

export async function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN, TOKEN_OPTIONS);
}

export async function readTokens(): Promise<StoredTokens> {
  const [accessToken, refreshToken] = await Promise.all([readAccessToken(), readRefreshToken()]);
  return { accessToken, refreshToken };
}

export async function writeAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN, token, TOKEN_OPTIONS);
}

export async function writeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN, token, TOKEN_OPTIONS);
}

export async function writeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([writeAccessToken(accessToken), writeRefreshToken(refreshToken)]);
}

export async function clearAccessToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN, TOKEN_OPTIONS);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN, TOKEN_OPTIONS);
}

export async function clearTokens(): Promise<void> {
  await Promise.allSettled([clearAccessToken(), clearRefreshToken()]);
}
