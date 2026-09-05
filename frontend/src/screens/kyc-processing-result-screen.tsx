import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { DigitalCedulaCard } from "../components/digital-cedula-card";
import { KycStepIndicator } from "../components/kyc-step-indicator";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { StatusBadge } from "../components/status-badge";
import { toUserFacingError } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { isTerminalKycStatus } from "../services/kyc-flow";
import { getKycStatusPresentation } from "../services/kyc-status";
import { KYC_STATUS } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function KycProcessingResultScreen(
  { navigation }: AppScreenProps<typeof APP_ROUTE.KYC_PROCESSING_RESULT>,
): ReactNode {
  const { verification, refresh, verify } = useKyc();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const status = verification?.status;

  useEffect(() => {
    if (status !== KYC_STATUS.VALIDATING) {
      return undefined;
    }

    const timer = setInterval(() => {
      void refresh();
    }, 3_000);

    return () => clearInterval(timer);
  }, [status, refresh]);

  if (!verification) {
    return (
      <ScreenShell>
        <View style={styles.emptyState}>
           <Text style={styles.title}>No hay una verificación de identidad activa.</Text>
           <PrimaryButton label="Comenzar verificación de identidad" onPress={() => navigation.navigate(APP_ROUTE.START_KYC)} />
        </View>
      </ScreenShell>
    );
  }

  const presentation = getKycStatusPresentation(verification.status, verification.reasonCode);
  const isValidating = verification.status === KYC_STATUS.VALIDATING;
  const isReadyToVerify = verification.status === KYC_STATUS.SELFIE_UPLOADED;
  const canRestart = isTerminalKycStatus(verification.status);

  async function handleVerify(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await verify();
    } catch (verificationError: unknown) {
      setError(toUserFacingError(verificationError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRestart(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      navigation.navigate(APP_ROUTE.START_KYC);
    } catch (startError: unknown) {
      setError(toUserFacingError(startError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function confirmRestart(): void {
    Alert.alert(
      "Iniciar una nueva verificación",
      "La verificación anterior permanecerá registrada. Deberá capturar nuevas imágenes para continuar.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Continuar", style: "destructive", onPress: () => void handleRestart() },
      ],
    );
  }

  return (
    <ScreenShell>
      <View style={styles.content}>
         <Text style={styles.eyebrow}>VERIFICACIÓN DE IDENTIDAD / RESULTADO</Text>
         <KycStepIndicator verification={verification} />
        <StatusBadge label={presentation.label} tone={presentation.tone} />
        <Text style={styles.title}>{presentation.label}</Text>
        <Text style={styles.copy}>{presentation.description}</Text>

        {isTerminalKycStatus(verification.status) ? (
          <DigitalCedulaCard
            images={verification.images}
            faceSimilarity={verification.faceSimilarity}
            statusLabel={presentation.label}
          />
        ) : null}

        <View style={styles.receipt}>
           <Text style={styles.receiptLabel}>COMPROBANTE DE VERIFICACIÓN PRIVADA</Text>
           <Text style={styles.receiptValue}>Documento: {verification.images.some((image) => image.kind === "DOCUMENT") ? "guardado" : "faltante"}</Text>
           <Text style={styles.receiptValue}>Fotografía del rostro: {verification.images.some((image) => image.kind === "SELFIE") ? "guardada" : "faltante"}</Text>
           <Text style={styles.receiptValue}>Última actualización: {new Date(verification.updatedAt).toLocaleString("es-ES")}</Text>
        </View>

        {isValidating ? (
          <View style={styles.processingRow} accessibilityRole="progressbar">
            <ActivityIndicator color={COLORS.mint} />
             <Text style={styles.processingText}>Actualizando este resultado cada pocos segundos…</Text>
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          {isReadyToVerify ? (
            <PrimaryButton
               label={isSubmitting ? "Iniciando verificación" : "Validar mi identidad"}
              onPress={handleVerify}
              disabled={isSubmitting}
            />
          ) : null}
          {canRestart ? (
            <PrimaryButton
                label={isSubmitting ? "Abriendo una nueva verificación" : "Iniciar una nueva verificación"}
               onPress={confirmRestart}
              disabled={isSubmitting}
            />
          ) : null}
           <PrimaryButton label="Volver al centro de identidad" onPress={() => navigation.navigate(APP_ROUTE.HOME)} variant={BUTTON_VARIANT.GHOST} />
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
  emptyState: {
    flex: 1,
    justifyContent: "center",
    gap: SPACING.lg,
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
  receipt: {
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panel,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  receiptLabel: {
    color: COLORS.amber,
    fontFamily: FONT.label,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  receiptValue: {
    color: COLORS.cream,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 20,
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  processingText: {
    color: COLORS.mint,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  actions: {
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  error: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
  },
});
