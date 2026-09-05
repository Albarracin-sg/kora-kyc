import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { toUserFacingError } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { getKycRoute, isTerminalKycStatus } from "../services/kyc-flow";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";
import type { KycConsentRequirements } from "../types/api";

export function StartKycScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.START_KYC>): ReactNode {
  const { getConsentRequirements, isHydrated, start } = useKyc();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(true);
  const [hasAcceptedRemoteBiometricConsent, setHasAcceptedRemoteBiometricConsent] = useState(false);
  const [consentRequirements, setConsentRequirements] = useState<KycConsentRequirements | null>(null);

  async function loadConsentRequirements(): Promise<void> {
    setError(null);
    setIsLoadingRequirements(true);
    try {
      setConsentRequirements(await getConsentRequirements());
    } catch (requirementsError: unknown) {
      setConsentRequirements(null);
      setError(toUserFacingError(requirementsError));
    } finally {
      setIsLoadingRequirements(false);
    }
  }

  useEffect(() => {
    void loadConsentRequirements();
  }, []);

  async function handleStart(): Promise<void> {
    setError(null);
    if (!consentRequirements) {
      return;
    }
    setIsStarting(true);
    try {
      const consentVersion = consentRequirements.requiresExternalProcessing
        ? consentRequirements.consentVersion ?? undefined
        : undefined;
      const nextVerification = await start(consentVersion);
      navigation.navigate(
        isTerminalKycStatus(nextVerification.status)
          ? APP_ROUTE.DOCUMENT_SCAN
          : getKycRoute(nextVerification),
      );
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
          imágenes de verificación normalizadas en almacenamiento privado.
        </Text>

        <View style={styles.steps}>
           <View style={styles.step}><Text style={styles.stepNumber}>01</Text><Text style={styles.stepText}>Use la cámara trasera para capturar el frente de su cédula.</Text></View>
           <View style={styles.step}><Text style={styles.stepNumber}>02</Text><Text style={styles.stepText}>Use la cámara trasera para capturar el reverso de su cédula.</Text></View>
           <View style={styles.step}><Text style={styles.stepNumber}>03</Text><Text style={styles.stepText}>Use la cámara frontal para tomar una fotografía clara con una sola persona.</Text></View>
            <View style={styles.step}><Text style={styles.stepNumber}>04</Text><Text style={styles.stepText}>Consulte el estado mientras termina el procesamiento.</Text></View>
          </View>

        {consentRequirements?.requiresExternalProcessing ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: hasAcceptedRemoteBiometricConsent }}
            onPress={() => setHasAcceptedRemoteBiometricConsent((accepted) => !accepted)}
            style={styles.consent}
          >
            <View style={[styles.checkbox, hasAcceptedRemoteBiometricConsent ? styles.checkboxAccepted : null]}>
              {hasAcceptedRemoteBiometricConsent ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={styles.consentCopy}>
              Acepto que las imágenes FRONT, BACK o COMBINED de mi documento pueden enviarse por
              HTTPS al proveedor documental externo configurado para extracción y validación. También
              acepto que mi selfie y el retrato FRONT o COMBINED pueden enviarse a un servicio remoto
              de comparación facial cuando corresponda. La finalidad es verificar mi identidad; este
              proceso no realiza prueba de vida y puedo cancelar antes de continuar.
            </Text>
          </Pressable>
        ) : null}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
            <PrimaryButton
              label={isLoadingRequirements ? "Verificando configuración" : isStarting ? "Abriendo verificación" : "Comenzar captura"}
             onPress={handleStart}
              disabled={
                isStarting ||
                isLoadingRequirements ||
                !isHydrated ||
                !consentRequirements ||
                (consentRequirements.requiresExternalProcessing && !hasAcceptedRemoteBiometricConsent)
              }
            />
          {!isLoadingRequirements && !consentRequirements ? (
            <PrimaryButton
              label="Reintentar configuración"
              onPress={() => void loadConsentRequirements()}
              variant={BUTTON_VARIANT.GHOST}
            />
          ) : null}
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
  consent: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: SPACING.sm,
  },
  consentCopy: {
    color: COLORS.muted,
    flex: 1,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 20,
  },
  checkbox: {
    alignItems: "center",
    borderColor: COLORS.muted,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    marginTop: 1,
    width: 22,
  },
  checkboxAccepted: {
    backgroundColor: COLORS.mint,
    borderColor: COLORS.mint,
  },
  checkboxMark: {
    color: COLORS.ink,
    fontFamily: FONT.label,
    fontSize: 15,
  },
  error: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
  },
});
