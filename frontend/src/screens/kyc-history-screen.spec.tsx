import { render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { KycHistoryScreen } from "./kyc-history-screen";
import { koraApiClient } from "../services/api-client";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { KYC_STATUS } from "../types/api";

jest.mock("../components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../services/api-client", () => ({
  koraApiClient: { getKycHistory: jest.fn() },
}));

const mockedApiClient = jest.mocked(koraApiClient);

describe("KycHistoryScreen private records", () => {
  afterEach(() => jest.clearAllMocks());

  it("presents returned records in the private-history editorial list", async () => {
    mockedApiClient.getKycHistory.mockResolvedValue({
      items: [{ id: "record-id", status: KYC_STATUS.APPROVED, finalizedAt: "2026-09-06T15:00:00.000Z", faceSimilarity: null }],
      nextCursor: null,
    });
    const navigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as AppScreenProps<typeof APP_ROUTE.KYC_HISTORY>["navigation"];

    render(<KycHistoryScreen navigation={navigation} route={{} as never} />);

    await waitFor(() => expect(screen.getByText("Historial privado")).toBeOnTheScreen());
    expect(screen.getByText("Registros de verificación")).toBeOnTheScreen();
    expect(screen.getByLabelText("Abrir verificación del 6/9/2026")).toBeOnTheScreen();
  });
});
