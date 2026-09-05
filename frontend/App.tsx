import { useEffect, type ReactNode } from "react";
import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LoadingScreen } from "./src/components/loading-screen";
import { AuthProvider, useAuth } from "./src/contexts/auth-context";
import { KycProvider } from "./src/contexts/kyc-context";
import { APP_ROUTE, type RootStackParamList } from "./src/navigation/routes";
import { DocumentScanScreen } from "./src/screens/document-scan-screen";
import { HomeScreen } from "./src/screens/home-screen";
import { KycProcessingResultScreen } from "./src/screens/kyc-processing-result-screen";
import { LoginScreen } from "./src/screens/login-screen";
import { ProfileScreen } from "./src/screens/profile-screen";
import { RegisterScreen } from "./src/screens/register-screen";
import { SelfieScreen } from "./src/screens/selfie-screen";
import { StartKycScreen } from "./src/screens/start-kyc-screen";
import { WelcomeScreen } from "./src/screens/welcome-screen";
import { COLORS, FONT } from "./src/theme/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const KORA_NAVIGATION_THEME: Theme = {
  dark: true,
  colors: {
    primary: COLORS.mint,
    background: COLORS.ink,
    card: COLORS.ink,
    text: COLORS.cream,
    border: COLORS.ink,
    notification: COLORS.coral,
  },
  fonts: {
    regular: { fontFamily: FONT.body, fontWeight: "400" },
    medium: { fontFamily: FONT.label, fontWeight: "500" },
    bold: { fontFamily: FONT.display, fontWeight: "600" },
    heavy: { fontFamily: FONT.heavy, fontWeight: "800" },
  },
};

function ApplicationNavigator(): ReactNode {
  const { user, isRestoring } = useAuth();

  if (isRestoring) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer theme={KORA_NAVIGATION_THEME}>
      <Stack.Navigator key={user ? "authenticated" : "anonymous"} screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name={APP_ROUTE.HOME} component={HomeScreen} />
            <Stack.Screen name={APP_ROUTE.START_KYC} component={StartKycScreen} />
            <Stack.Screen name={APP_ROUTE.DOCUMENT_SCAN} component={DocumentScanScreen} />
            <Stack.Screen name={APP_ROUTE.SELFIE} component={SelfieScreen} />
            <Stack.Screen
              name={APP_ROUTE.KYC_PROCESSING_RESULT}
              component={KycProcessingResultScreen}
            />
            <Stack.Screen name={APP_ROUTE.PROFILE} component={ProfileScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name={APP_ROUTE.WELCOME} component={WelcomeScreen} />
            <Stack.Screen name={APP_ROUTE.REGISTER} component={RegisterScreen} />
            <Stack.Screen name={APP_ROUTE.LOGIN} component={LoginScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App(): ReactNode {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider style={styles.root}>
        <SystemBars />
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={styles.root}>
      <AuthProvider>
        <KycProvider>
          <SystemBars />
          <ApplicationNavigator />
        </KycProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function SystemBars(): ReactNode {
  return (
    <>
      <StatusBar style="light" />
      <NavigationBar style="dark" />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
});
