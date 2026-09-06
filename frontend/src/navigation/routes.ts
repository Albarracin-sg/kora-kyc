import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export const APP_ROUTE = {
  WELCOME: "Welcome",
  REGISTER: "Register",
  LOGIN: "Login",
  HOME: "Home",
  START_KYC: "StartKyc",
  DOCUMENT_SCAN: "DocumentScan",
  SELFIE: "Selfie",
  KYC_PROCESSING_RESULT: "KycProcessingResult",
  PROFILE: "Profile",
  KYC_HISTORY: "KycHistory",
  KYC_HISTORY_DETAIL: "KycHistoryDetail",
} as const;

export type AppRoute = (typeof APP_ROUTE)[keyof typeof APP_ROUTE];

export interface RootStackParamList {
  [route: string]: object | undefined;
  Welcome: undefined;
  Register: undefined;
  Login: undefined;
  Home: undefined;
  StartKyc: undefined;
  DocumentScan: undefined;
  Selfie: undefined;
  KycProcessingResult: undefined;
  Profile: undefined;
  KycHistory: undefined;
  KycHistoryDetail: { verificationId: string };
}

export type KycFlowRoute = Exclude<AppRoute, typeof APP_ROUTE.KYC_HISTORY_DETAIL>;

export type AppScreenProps<Route extends AppRoute> = NativeStackScreenProps<
  RootStackParamList,
  Route
>;
