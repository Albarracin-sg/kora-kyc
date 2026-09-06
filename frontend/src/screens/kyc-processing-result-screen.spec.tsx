import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { ReactNode } from "react";
import { KycProcessingResultScreen } from "./kyc-processing-result-screen";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import {
  KYC_FACE_CAPTURE_FAILURE,
  KYC_STATUS,
  type KycVerification,
} from "../types/api";

jest.mock("../components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../components/kyc-step-indicator", () => ({
  KycStepIndicator: () => null,
}));

jest.mock("../contexts/auth-context", () => ({
  toUserFacingError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
}));

jest.mock("../contexts/kyc-context", () => ({
  useKyc: jest.fn(),
}));

const mockedUseKyc = jest.mocked(useKyc);

function createVerification(reasonCode: string): KycVerification {
  const timestamp = "2026-09-05T00:00:00.000Z";
  return {
    id: "verification-id",
    status: KYC_STATUS.NEEDS_REVIEW,
    reasonCode,
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
    createdAt: timestamp,
    updatedAt: timestamp,
    images: [],
  };
}

function renderScreen(reasonCode: string): {
  navigation: AppScreenProps<typeof APP_ROUTE.KYC_PROCESSING_RESULT>["navigation"];
} {
  const navigation = { navigate: jest.fn() } as unknown as AppScreenProps<
    typeof APP_ROUTE.KYC_PROCESSING_RESULT
  >["navigation"];
  const props = {
    navigation,
    route: {},
  } as unknown as AppScreenProps<typeof APP_ROUTE.KYC_PROCESSING_RESULT>;

  mockedUseKyc.mockReturnValue({
    verification: createVerification(reasonCode),
    refresh: jest.fn(),
    verify: jest.fn(),
  } as never);
  render(<KycProcessingResultScreen {...props} />);
  return { navigation };
}

describe("KycProcessingResultScreen capture quality recovery", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    [
      KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_BLURRY,
      "La imagen del documento está borrosa.",
    ],
    [
      KYC_FACE_CAPTURE_FAILURE.QUALITY_SELFIE_NO_FACE,
      "No detectamos un rostro en la selfie.",
    ],
  ] as const)("explains %s and offers a new-photo action", (reasonCode, expectedCopy) => {
    renderScreen(reasonCode);

    expect(screen.getAllByText("Necesitamos una nueva foto").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(new RegExp(expectedCopy))).toBeOnTheScreen();
    expect(screen.getByLabelText("Tomar nuevas fotos")).toBeOnTheScreen();
  });

  it("starts a new verification when the quality recovery action is confirmed", async () => {
    const { navigation } = renderScreen(KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_NO_FACE);
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const continueButton = buttons?.find((button) => button.text === "Continuar");
      continueButton?.onPress?.();
    });

    fireEvent.press(screen.getByLabelText("Tomar nuevas fotos"));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.START_KYC));
  });
});
