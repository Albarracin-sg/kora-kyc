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
} as const;

export type AppRoute = (typeof APP_ROUTE)[keyof typeof APP_ROUTE];

export type RootStackParamList = Record<AppRoute, undefined>;

export type AppScreenProps<Route extends AppRoute> = NativeStackScreenProps<
  RootStackParamList,
  Route
>;
