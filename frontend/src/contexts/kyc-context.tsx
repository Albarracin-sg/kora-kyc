import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { koraApiClient } from "../services/api-client";
import type { DocumentSide, KycVerification } from "../types/api";
import { useAuth } from "./auth-context";

interface KycContextValue {
  verification: KycVerification | null;
  isLoading: boolean;
  isHydrated: boolean;
  refresh(): Promise<void>;
  start(): Promise<KycVerification>;
  uploadDocument(uri: string, side: DocumentSide): Promise<KycVerification>;
  uploadSelfie(uri: string): Promise<KycVerification>;
  verify(): Promise<KycVerification>;
}

interface KycProviderProps {
  children: ReactNode;
}

const KycContext = createContext<KycContextValue | null>(null);

export function KycProvider({ children }: KycProviderProps): ReactNode {
  const { token } = useAuth();
  const [verification, setVerification] = useState<KycVerification | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (!token) {
      setVerification(null);
      setIsHydrated(true);
      return;
    }

    void refresh();
  }, [token]);

  function requireToken(): string {
    if (!token) {
      throw new Error("Debe iniciar sesión antes de gestionar la verificación de identidad.");
    }

    return token;
  }

  async function refresh(): Promise<void> {
    if (!token) {
      setVerification(null);
      setIsHydrated(true);
      return;
    }

    setIsLoading(true);
    try {
      setVerification(await koraApiClient.getCurrentKyc());
    } finally {
      setIsLoading(false);
      setIsHydrated(true);
    }
  }

  async function start(): Promise<KycVerification> {
    requireToken();
    const nextVerification = await koraApiClient.startKyc();
    setVerification(nextVerification);
    return nextVerification;
  }

  async function uploadDocument(uri: string, side: DocumentSide): Promise<KycVerification> {
    requireToken();
    const nextVerification = await koraApiClient.uploadDocument(uri, side);
    setVerification(nextVerification);
    return nextVerification;
  }

  async function uploadSelfie(uri: string): Promise<KycVerification> {
    requireToken();
    const nextVerification = await koraApiClient.uploadSelfie(uri);
    setVerification(nextVerification);
    return nextVerification;
  }

  async function verify(): Promise<KycVerification> {
    requireToken();
    const nextVerification = await koraApiClient.verifyKyc();
    setVerification(nextVerification);
    return nextVerification;
  }

  const contextValue: KycContextValue = {
    verification,
    isLoading,
    isHydrated,
    refresh,
    start,
    uploadDocument,
    uploadSelfie,
    verify,
  };

  return <KycContext.Provider value={contextValue}>{children}</KycContext.Provider>;
}

export function useKyc(): KycContextValue {
  const context = useContext(KycContext);
  if (!context) {
    throw new Error("useKyc must be used within a KycProvider");
  }

  return context;
}
