import type { ReactNode } from "react";
import { KoraBottomNavigation } from "./kora-bottom-navigation";
import { ScreenShell } from "./screen-shell";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type KycFlowRoute } from "../navigation/routes";
import { getKycRoute } from "../services/kyc-flow";

interface AuthenticatedNavigation {
  navigate(route: typeof APP_ROUTE.HOME | typeof APP_ROUTE.PROFILE | KycFlowRoute): void;
}

interface AuthenticatedScreenShellProps {
  activeRoute: KycFlowRoute;
  children: ReactNode;
  navigation: AuthenticatedNavigation;
}

export function AuthenticatedScreenShell({ activeRoute, children, navigation }: AuthenticatedScreenShellProps): ReactNode {
  const { verification } = useKyc();

  return (
    <ScreenShell
      footer={
        <KoraBottomNavigation
          activeRoute={activeRoute}
          kycRoute={getKycRoute(verification)}
          navigation={navigation}
        />
      }
    >
      {children}
    </ScreenShell>
  );
}
