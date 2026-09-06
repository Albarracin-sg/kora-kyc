import { fireEvent, render, screen } from "@testing-library/react-native";
import { KoraBottomNavigation } from "./kora-bottom-navigation";
import { APP_ROUTE } from "../navigation/routes";

describe("KoraBottomNavigation", () => {
  it("uses the existing KYC action route and marks the active destination", () => {
    const navigation = { navigate: jest.fn() };

    render(
      <KoraBottomNavigation
        activeRoute={APP_ROUTE.HOME}
        kycRoute={APP_ROUTE.DOCUMENT_SCAN}
        navigation={navigation}
      />,
    );

    expect(screen.getByLabelText("Inicio")).toHaveProp("accessibilityState", { selected: true });
    fireEvent.press(screen.getByLabelText("Verificar"));
    expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.DOCUMENT_SCAN);
    fireEvent.press(screen.getByLabelText("Perfil"));
    expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.PROFILE);
  });
});
