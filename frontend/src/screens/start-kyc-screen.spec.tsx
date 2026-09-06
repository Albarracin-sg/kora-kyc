import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StartKycScreen } from "./start-kyc-screen";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { COLORS } from "../theme/theme";
import { REMOTE_BIOMETRIC_CONSENT_VERSION } from "../types/api";

jest.mock("../components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../contexts/auth-context", () => ({
  toUserFacingError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
}));

jest.mock("../contexts/kyc-context", () => ({
  useKyc: jest.fn(),
}));

const mockedUseKyc = jest.mocked(useKyc);

function renderScreen(): { navigation: AppScreenProps<typeof APP_ROUTE.START_KYC>["navigation"] } {
  const navigation = { navigate: jest.fn() } as unknown as AppScreenProps<
    typeof APP_ROUTE.START_KYC
  >["navigation"];
  const props = {
    navigation,
    route: {},
  } as unknown as AppScreenProps<typeof APP_ROUTE.START_KYC>;

  render(<StartKycScreen {...props} />);
  return { navigation };
}

describe("StartKycScreen remote consent", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("does not render a consent checkbox for local document and local face processing", async () => {
    const start = jest.fn().mockResolvedValue({ status: "CREATED" });
    mockedUseKyc.mockReturnValue({
      getConsentRequirements: jest.fn().mockResolvedValue({
        requiresExternalProcessing: false,
        consentVersion: null,
      }),
      isHydrated: true,
      start,
    } as never);

    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Comenzar captura")).toBeOnTheScreen());
    expect(screen.queryByRole("checkbox")).not.toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText("Comenzar captura"));
    await waitFor(() => expect(start).toHaveBeenCalledWith(undefined));
  });

  it("renders remote consent and sends exactly the backend version", async () => {
    const start = jest.fn().mockResolvedValue({ status: "CREATED" });
    mockedUseKyc.mockReturnValue({
      getConsentRequirements: jest.fn().mockResolvedValue({
        requiresExternalProcessing: true,
        consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
      }),
      isHydrated: true,
      start,
    } as never);

    renderScreen();

    const checkbox = await waitFor(() => screen.getByRole("checkbox"));
    expect(screen.getByText(/prueba de vida/)).toBeOnTheScreen();
    expect(screen.getByLabelText("Comenzar captura")).toHaveProp("accessibilityState", {
      disabled: true,
    });

    fireEvent.press(checkbox);
    fireEvent.press(screen.getByLabelText("Comenzar captura"));
    await waitFor(() => expect(start).toHaveBeenCalledWith(REMOTE_BIOMETRIC_CONSENT_VERSION));
  });

  it("blocks capture after a capability failure and allows retrying the request", async () => {
    const getConsentRequirements = jest
      .fn()
      .mockRejectedValueOnce(new Error("Capability unavailable"))
      .mockResolvedValueOnce({ requiresExternalProcessing: false, consentVersion: null });
    const start = jest.fn();
    mockedUseKyc.mockReturnValue({
      getConsentRequirements,
      isHydrated: true,
      start,
    } as never);

    renderScreen();

    await waitFor(() => expect(screen.getByText("Capability unavailable")).toBeOnTheScreen());
    fireEvent.press(screen.getByLabelText("Comenzar captura"));
    expect(start).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Reintentar configuración"));
    await waitFor(() => expect(getConsentRequirements).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByLabelText("Comenzar captura")).toHaveProp("accessibilityState", {
        disabled: false,
      }),
    );
  });

  it("uses ink text on the light shell and step surfaces", async () => {
    mockedUseKyc.mockReturnValue({
      getConsentRequirements: jest.fn().mockResolvedValue({
        requiresExternalProcessing: false,
        consentVersion: null,
      }),
      isHydrated: true,
      start: jest.fn(),
    } as never);

    renderScreen();

    await waitFor(() =>
      expect(screen.getByText("Prepare sus fotografías.")).toHaveStyle({ color: COLORS.ink }),
    );
    expect(screen.getByText("Use la cámara trasera para capturar el frente de su cédula.")).toHaveStyle({
      color: COLORS.ink,
    });
  });
});
