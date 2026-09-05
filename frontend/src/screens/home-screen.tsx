import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { StatusBadge } from "../components/status-badge";
import { useAuth } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { getKycActionLabel, getKycRoute } from "../services/kyc-flow";
import { getKycStatusPresentation, KYC_STATUS_TONE } from "../services/kyc-status";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function HomeScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.HOME>): ReactNode {
  const { user } = useAuth();
  const { verification, isHydrated, isLoading, refresh } = useKyc();
  const presentation = verification
    ? getKycStatusPresentation(verification.status, verification.reasonCode)
    : {
         label: "Verificación de identidad no iniciada",
         description: "Comience una verificación basada en su documento cuando esté preparado.",
        tone: KYC_STATUS_TONE.NEUTRAL,
      };

  return (
    <ScreenShell>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>KORA / CENTRO DE IDENTIDAD</Text>
          <Text style={styles.greeting}>Hola{user ? "," : ""}{"\n"}{user?.email ?? ""}</Text>
        </View>
        <PrimaryButton
          label="Perfil"
          onPress={() => navigation.navigate(APP_ROUTE.PROFILE)}
          variant={BUTTON_VARIANT.GHOST}
          accessibilityHint="Abre su perfil"
        />
      </View>

      <View style={styles.identityCard}>
        <Text style={styles.cardEyebrow}>ESTADO DE IDENTIDAD</Text>
        <StatusBadge label={presentation.label} tone={presentation.tone} />
        <Text style={styles.cardTitle}>{presentation.label}</Text>
        <Text style={styles.cardCopy}>{presentation.description}</Text>
        <PrimaryButton
           label={getKycActionLabel(verification)}
           onPress={() => navigation.navigate(getKycRoute(verification))}
           disabled={isLoading || !isHydrated}
        />
      </View>

      <View style={styles.noteCard}>
         <Text style={styles.noteTitle}>Un límite claro</Text>
         <Text style={styles.noteCopy}>
           Kora comprueba localmente el documento y la fotografía del rostro capturados. No realiza
           detección de vida ni confirma la autenticidad del documento.
        </Text>
      </View>

      <PrimaryButton
        label={isLoading ? "Actualizando estado" : "Actualizar estado de identidad"}
        onPress={refresh}
        disabled={isLoading}
        variant={BUTTON_VARIANT.GHOST}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: SPACING.xl,
  },
  eyebrow: {
    color: COLORS.mint,
    fontFamily: FONT.label,
    fontSize: 11,
    letterSpacing: 1.3,
  },
  greeting: {
    maxWidth: 230,
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 30,
    lineHeight: 35,
    marginTop: SPACING.xs,
  },
  identityCard: {
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.panel,
    padding: SPACING.lg,
  },
  cardEyebrow: {
    color: COLORS.muted,
    fontFamily: FONT.label,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  cardTitle: {
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 30,
    lineHeight: 35,
  },
  cardCopy: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: SPACING.sm,
  },
  noteCard: {
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.amber,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  noteTitle: {
    color: COLORS.amber,
    fontFamily: FONT.label,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  noteCopy: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 21,
    marginTop: SPACING.xs,
  },
});
