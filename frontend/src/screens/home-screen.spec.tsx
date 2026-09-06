import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { HomeScreen } from "./home-screen";
import { useAuth } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { KYC_STATUS, type KycVerification } from "../types/api";

jest.mock("../components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../contexts/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../contexts/kyc-context", () => ({ useKyc: jest.fn() }));

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseKyc = jest.mocked(useKyc);

function verification(): KycVerification {
  return {
    id: "verification-id",
    status: KYC_STATUS.DOCUMENT_UPLOADED,
    reasonCode: null,
    documentType: null,
    documentFullName: null,
    documentNumber: null,
    documentBirthDate: null,
    documentIssueDate: null,
    documentSex: null,
    documentHeight: null,
    documentBloodType: null,
    documentBirthPlace: null,
    documentCheckResult: null,
    documentNationality: null,
    faceSimilarity: null,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    images: [],
  };
}

describe("HomeScreen editorial identity panel", () => {
  afterEach(() => jest.clearAllMocks());

  it("keeps the real KYC state and next action inside the identity panel", () => {
    mockedUseAuth.mockReturnValue({ user: { id: "user-id", email: "person@example.com" } } as never);
    mockedUseKyc.mockReturnValue({
      verification: verification(),
      isHydrated: true,
      isLoading: false,
      refresh: jest.fn(),
    } as never);
    const navigation = { navigate: jest.fn() } as unknown as AppScreenProps<typeof APP_ROUTE.HOME>["navigation"];

    render(<HomeScreen navigation={navigation} route={{} as never} />);

    expect(screen.getByText("PANEL DE IDENTIDAD")).toBeOnTheScreen();
    expect(screen.getByText("Verificación de identidad")).toBeOnTheScreen();
    expect(screen.getByLabelText("Capturar el frente del documento")).toBeOnTheScreen();
  });
});
