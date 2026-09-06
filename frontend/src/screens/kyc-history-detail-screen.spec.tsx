import { render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { KycHistoryDetailScreen } from "./kyc-history-detail-screen";
import { koraApiClient } from "../services/api-client";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { KYC_IMAGE_KIND, KYC_STATUS } from "../types/api";

jest.mock("../components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../components/kyc-media-image", () => ({
  KycMediaImage: ({ accessibilityLabel }: { accessibilityLabel: string }) => {
    const { View } = require("react-native");
    return <View accessibilityLabel={accessibilityLabel} />;
  },
}));

jest.mock("../services/api-client", () => ({
  koraApiClient: { getKycHistoryDetail: jest.fn() },
}));

const mockedApiClient = jest.mocked(koraApiClient);

describe("KycHistoryDetailScreen private evidence", () => {
  afterEach(() => jest.clearAllMocks());

  it("groups authenticated media under private evidence while retaining the returned status", async () => {
    mockedApiClient.getKycHistoryDetail.mockResolvedValue({
      id: "record-id",
      status: KYC_STATUS.APPROVED,
      finalizedAt: "2026-09-06T15:00:00.000Z",
      faceSimilarity: null,
      reasonCode: null,
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
      images: [{ id: "media-id", kind: KYC_IMAGE_KIND.DOCUMENT, side: "FRONT" }],
    });
    const navigation = { goBack: jest.fn() } as unknown as AppScreenProps<typeof APP_ROUTE.KYC_HISTORY_DETAIL>["navigation"];

    render(<KycHistoryDetailScreen navigation={navigation} route={{ params: { verificationId: "record-id" } } as never} />);

    await waitFor(() => expect(screen.getByText("Evidencia privada")).toBeOnTheScreen());
    expect(screen.getByText("Identidad verificada")).toBeOnTheScreen();
    expect(screen.getByLabelText("Imagen privada de verificación")).toBeOnTheScreen();
  });
});
