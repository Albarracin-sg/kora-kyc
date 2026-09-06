import { fireEvent, render, screen } from "@testing-library/react-native";
import { BackToHomeButton } from "./back-to-home-button";
import { APP_ROUTE } from "../navigation/routes";

describe("BackToHomeButton", () => {
  it("uses the navigation history when available", () => {
    const navigation = { canGoBack: jest.fn(() => true), goBack: jest.fn(), navigate: jest.fn() };
    render(<BackToHomeButton navigation={navigation} />);

    fireEvent.press(screen.getByLabelText("Volver"));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("returns to Home when there is no history", () => {
    const navigation = { canGoBack: jest.fn(() => false), goBack: jest.fn(), navigate: jest.fn() };
    render(<BackToHomeButton navigation={navigation} />);

    fireEvent.press(screen.getByLabelText("Volver"));

    expect(navigation.navigate).toHaveBeenCalledWith(APP_ROUTE.HOME);
  });
});
