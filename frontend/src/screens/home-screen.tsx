import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KoraBrand } from "../components/kora-brand";
import { AuthenticatedScreenShell } from "../components/authenticated-screen-shell";
import { KycStepIndicator } from "../components/kyc-step-indicator";
import { PrimaryButton } from "../components/primary-button";
import { StatusBadge } from "../components/status-badge";
import { useAuth } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { getKycActionLabel, getKycRoute } from "../services/kyc-flow";
import { getKycStatusPresentation, KYC_STATUS_TONE } from "../services/kyc-status";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function HomeScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.HOME>): ReactNode {
  const { user } = useAuth();
  const { verification, isHydrated, isLoading } = useKyc();
  const presentation = verification
    ? getKycStatusPresentation(verification.status, verification.reasonCode)
    : {
        label: "Verificación de identidad no iniciada",
        description: "Comience una verificación basada en su documento cuando esté preparado.",
        tone: KYC_STATUS_TONE.NEUTRAL,
      };

  return (
    <AuthenticatedScreenShell activeRoute={APP_ROUTE.HOME} navigation={navigation}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PANEL DE IDENTIDAD</Text>
          <Text style={styles.greeting}>Hola{user ? "," : ""}</Text>
          <Text style={styles.email} numberOfLines={2}>{user?.email ?? ""}</Text>
        </View>
      </View>

      <View style={styles.identityCard}>
        <View style={styles.cardTopRow}>
          <View style={styles.cardHeading}>
            <Text style={styles.cardEyebrow}>KORA / ESTADO ACTUAL</Text>
            <Text style={styles.cardSection}>Verificación de identidad</Text>
          </View>
          <KoraBrand markOnly showPromise={false} onLight />
        </View>
        <StatusBadge label={presentation.label} tone={presentation.tone} />
        <Text style={styles.cardTitle}>{presentation.label}</Text>
        <Text style={styles.cardCopy}>{presentation.description}</Text>
        <KycStepIndicator verification={verification} />
        <PrimaryButton label={getKycActionLabel(verification)} onPress={() => navigation.navigate(getKycRoute(verification))} disabled={isLoading || !isHydrated} />
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Un límite claro</Text>
        <Text style={styles.noteCopy}>Kora no realiza detección de vida ni confirma la autenticidad del documento.</Text>
      </View>
    </AuthenticatedScreenShell>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "flex-start", flexDirection: "row", gap: SPACING.sm, justifyContent: "space-between", marginBottom: SPACING.xl },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: COLORS.mintDark, fontFamily: FONT.label, fontSize: 11, letterSpacing: 1.3 },
  greeting: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 30, lineHeight: 35, marginTop: SPACING.xs },
  email: { color: COLORS.muted, flexShrink: 1, fontFamily: FONT.body, fontSize: 14, lineHeight: 18, marginTop: 2, maxWidth: 210 },
  identityCard: { backgroundColor: COLORS.mint, borderColor: COLORS.mint, borderRadius: RADIUS.lg, borderWidth: 1, gap: SPACING.md, padding: SPACING.lg },
  cardTopRow: { alignItems: "flex-start", flexDirection: "row", gap: SPACING.sm, justifyContent: "space-between" },
  cardHeading: { flex: 1, minWidth: 0 },
  cardEyebrow: { color: COLORS.ink, fontFamily: FONT.label, fontSize: 11, letterSpacing: 1.4 },
  cardSection: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 18, marginTop: 2 },
  cardTitle: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 28, lineHeight: 33 },
  cardCopy: { color: COLORS.ink, fontFamily: FONT.body, fontSize: 15, lineHeight: 22 },
  noteCard: { borderLeftColor: COLORS.ink, borderLeftWidth: 2, marginBottom: SPACING.sm, marginTop: SPACING.lg, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  noteTitle: { color: COLORS.ink, fontFamily: FONT.label, fontSize: 12, letterSpacing: 1.1, textTransform: "uppercase" },
  noteCopy: { color: COLORS.ink, fontFamily: FONT.body, fontSize: 14, lineHeight: 21, marginTop: SPACING.xs },
});
