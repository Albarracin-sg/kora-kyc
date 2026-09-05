import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import {
  ApiRequestError,
  clearSessionTokens,
  koraApiClient,
  persistSessionTokens,
  setSessionTokens,
} from "../services/api-client";
import { readTokens } from "../services/secure-token-store";
import type { AuthResponse, AuthenticatedUser } from "../types/api";

export interface CredentialsInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthenticatedUser | null;
  isRestoring: boolean;
  register(input: CredentialsInput): Promise<void>;
  login(input: CredentialsInput): Promise<void>;
  logout(): Promise<void>;
}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession(): Promise<void> {
      try {
        const savedTokens = await readTokens();
        if (!savedTokens.accessToken && !savedTokens.refreshToken) {
          return;
        }

        let restoredAccessToken = savedTokens.accessToken;
        if (savedTokens.refreshToken) {
          setSessionTokens({
            accessToken: savedTokens.accessToken ?? "",
            refreshToken: savedTokens.refreshToken,
          });
          const refreshedSession = await koraApiClient.refreshSession();
          restoredAccessToken = refreshedSession.accessToken;
        } else if (savedTokens.accessToken) {
          setSessionTokens({ accessToken: savedTokens.accessToken, refreshToken: "" });
        }

        const profile = await koraApiClient.getMe();
        if (isMounted) {
          setToken(restoredAccessToken);
          setUser({ id: profile.id, email: profile.email });
        }
      } catch {
        await clearSessionTokens();
      } finally {
        if (isMounted) {
          setIsRestoring(false);
        }
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  async function authenticate(response: AuthResponse): Promise<void> {
    await persistSessionTokens(response);
    setToken(response.accessToken);
    setUser(response.user);
  }

  async function register(input: CredentialsInput): Promise<void> {
    await authenticate(await koraApiClient.register(input.email, input.password));
  }

  async function login(input: CredentialsInput): Promise<void> {
    await authenticate(await koraApiClient.login(input.email, input.password));
  }

  async function logout(): Promise<void> {
    let savedRefreshToken: string | null = null;
    try {
      savedRefreshToken = (await readTokens()).refreshToken;
    } catch {
      // Local cleanup remains best-effort independent of SecureStore reads.
    }

    const revokeRequest = savedRefreshToken
      ? koraApiClient.logout(savedRefreshToken).catch(() => undefined)
      : Promise.resolve();

    await clearSessionTokens();
    setToken(null);
    setUser(null);
    await revokeRequest;
  }

  const contextValue: AuthContextValue = {
    token,
    user,
    isRestoring,
    register,
    login,
    logout,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}

export function toUserFacingError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return "No se pudo completar la acción. Inténtelo de nuevo.";
}
