import { fireEvent, render, screen } from "@testing-library/react-native";
import { KoraBottomNavigation } from "./kora-bottom-navigation";
import { APP_ROUTE } from "../navigation/routes";

describe("KoraBottomNavigation", () => {
  it("renders exactly four destinations, uses the existing KYC action route, and marks the active destination", () => {
    const navigation = { navigate: jest.fn() };

    render(
      <KoraBottomNavigation
        activeRoute={APP_ROUTE.HOME}
        kycRoute={APP_ROUTE.DOCUMENT_SCAN}
        navigation={navigation}
      />,
    );

    expect(screen.getByLabelText("Inicio")).toHaveProp("accessibilityState", { selected: true });
    expect(screen.getByLabelText("Historial")).toHaveProp("accessibilityState", { selected: false });
    expect(screen.getByLabelText("Verificar")).toHaveProp("accessibilityState", { selected: false });
    expect(screen.getByLabelText("Perfil")).toHaveProp("accessibilityState", { selected: false });
    fireEvent.press(screen.getByLabelText("Verificar"));
    expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.DOCUMENT_SCAN);
    fireEvent.press(screen.getByLabelText("Historial"));
    expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.KYC_HISTORY);
    fireEvent.press(screen.getByLabelText("Perfil"));
    expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.PROFILE);
  });
});
