import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { LoginScreen } from "./login-screen";
import { RegisterScreen } from "./register-screen";
import { useAuth } from "../contexts/auth-context";
import { APP_ROUTE, type AppRoute, type AppScreenProps } from "../navigation/routes";
import { COLORS } from "../theme/theme";

jest.mock("../components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../contexts/auth-context", () => ({
  toUserFacingError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  useAuth: jest.fn(),
}));

const mockedUseAuth = jest.mocked(useAuth);

function createProps<Route extends AppRoute>(route: Route): AppScreenProps<Route> {
  return {
    navigation: { navigate: jest.fn() },
    route: {},
  } as unknown as AppScreenProps<Route>;
}

describe("authentication screen contrast", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ login: jest.fn(), register: jest.fn() } as never);
  });

  it("uses ink titles on the light shell", () => {
    render(<LoginScreen {...createProps(APP_ROUTE.LOGIN)} />);
    expect(screen.getByText("Continúe con su verificación.")).toHaveStyle({ color: COLORS.ink });

    render(<RegisterScreen {...createProps(APP_ROUTE.REGISTER)} />);
    expect(screen.getByText(/Comience con calma/)).toHaveStyle({ color: COLORS.ink });
  });
});
