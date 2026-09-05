import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { toUserFacingError } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { getKycRoute } from "../services/kyc-flow";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function StartKycScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.START_KYC>): ReactNode {
  const { isHydrated, start, verification } = useKyc();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  async function handleStart(): Promise<void> {
    setError(null);
    if (verification) {
      navigation.navigate(getKycRoute(verification));
      return;
    }
    setIsStarting(true);
    try {
      await start();
      navigation.navigate(APP_ROUTE.DOCUMENT_SCAN);
    } catch (startError: unknown) {
      setError(toUserFacingError(startError));
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <ScreenShell>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>VERIFICACIÓN DE IDENTIDAD / PASO 01</Text>
        <Text style={styles.title}>Prepare sus fotografías.</Text>
        <Text style={styles.copy}>
          Primero, fotografíe una cédula colombiana: capture el frente y luego el reverso. Después,
          tome una fotografía del rostro en la que aparezca una sola persona. Kora almacena únicamente
          imágenes de verificación normalizadas en almacenamiento local privado.
        </Text>

        <View style={styles.steps}>
           <View style={styles.step}><Text style={styles.stepNumber}>01</Text><Text style={styles.stepText}>Use la cámara trasera para capturar el frente de su cédula.</Text></View>
           <View style={styles.step}><Text style={styles.stepNumber}>02</Text><Text style={styles.stepText}>Use la cámara trasera para capturar el reverso de su cédula.</Text></View>
           <View style={styles.step}><Text style={styles.stepNumber}>03</Text><Text style={styles.stepText}>Use la cámara frontal para tomar una fotografía clara con una sola persona.</Text></View>
           <View style={styles.step}><Text style={styles.stepNumber}>04</Text><Text style={styles.stepText}>Consulte el estado mientras termina el procesamiento local.</Text></View>
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <PrimaryButton
             label={isStarting ? "Abriendo verificación" : "Comenzar captura"}
            onPress={handleStart}
             disabled={isStarting || !isHydrated}
          />
          <PrimaryButton
             label="Cancelar"
            onPress={() => navigation.navigate(APP_ROUTE.HOME)}
            variant={BUTTON_VARIANT.GHOST}
          />
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: SPACING.md,
  },
  eyebrow: {
    color: COLORS.mint,
    fontFamily: FONT.label,
    fontSize: 12,
    letterSpacing: 1.5,
  },
  title: {
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 38,
    lineHeight: 43,
  },
  copy: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 16,
    lineHeight: 24,
  },
  steps: {
    gap: SPACING.sm,
    marginVertical: SPACING.md,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.panel,
    padding: SPACING.md,
  },
  stepNumber: {
    color: COLORS.amber,
    fontFamily: FONT.label,
    fontSize: 14,
  },
  stepText: {
    flex: 1,
    color: COLORS.cream,
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 21,
  },
  actions: {
    gap: SPACING.sm,
  },
  error: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
  },
});
