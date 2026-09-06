import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CedulaDataCard } from "../components/cedula-data-card";
import { AuthenticatedScreenShell } from "../components/authenticated-screen-shell";
import { BackToHomeButton } from "../components/back-to-home-button";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { StatusBadge } from "../components/status-badge";
import { toUserFacingError, useAuth } from "../contexts/auth-context";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { koraApiClient } from "../services/api-client";
import { getKycStatusPresentation, KYC_STATUS_TONE } from "../services/kyc-status";
import type { UserProfile } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function ProfileScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.PROFILE>): ReactNode {
  const { token, user, logout } = useAuth();
  const { verification } = useKyc();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile(): Promise<void> {
      if (!token) {
        return;
      }

      try {
         const loadedProfile = await koraApiClient.getMe();
        if (isMounted) {
          setProfile(loadedProfile);
        }
      } catch (profileError: unknown) {
        if (isMounted) {
          setError(toUserFacingError(profileError));
        }
      }
    }

    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [token]);

  async function handleLogout(): Promise<void> {
    setIsSigningOut(true);
    await logout();
    setIsSigningOut(false);
  }

  const identityPresentation = verification
    ? getKycStatusPresentation(verification.status, verification.reasonCode)
    : {
         label: "Verificación de identidad no iniciada",
         description: "Todavía no existe una verificación de identidad.",
        tone: KYC_STATUS_TONE.NEUTRAL,
      };

  return (
    <AuthenticatedScreenShell activeRoute={APP_ROUTE.PROFILE} navigation={navigation}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>PERFIL / CUENTA</Text>
            <Text style={styles.title}>Su cuenta.</Text>
          </View>
          <BackToHomeButton navigation={navigation} />
        </View>

        <View style={styles.profileCard}>
           <Text style={styles.profileLabel}>CORREO ELECTRÓNICO</Text>
           <Text selectable style={styles.email}>{profile?.email ?? user?.email ?? "Cargando perfil…"}</Text>
           {profile ? <Text style={styles.createdAt}>Cuenta creada el {new Date(profile.createdAt).toLocaleDateString("es-ES")}</Text> : null}
        </View>

<View style={styles.statusCard}>
          <Text style={styles.profileLabel}>ESTADO DE IDENTIDAD</Text>
          <StatusBadge label={identityPresentation.label} tone={identityPresentation.tone} />
          <Text style={styles.statusCopy}>{identityPresentation.description}</Text>
        </View>

        {verification ? (
          <CedulaDataCard
            fullName={verification.documentFullName}
            documentNumber={verification.documentNumber}
            birthDate={verification.documentBirthDate}
            issueDate={verification.documentIssueDate}
            sex={verification.documentSex}
            height={verification.documentHeight}
            bloodType={verification.documentBloodType}
            birthPlace={verification.documentBirthPlace}
            nationality={verification.documentNationality}
            checkResult={verification.documentCheckResult}
          />
        ) : null}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
           <PrimaryButton label="Volver al centro de identidad" onPress={() => navigation.navigate(APP_ROUTE.HOME)} />
           <PrimaryButton
             label={isSigningOut ? "Cerrando sesión" : "Cerrar sesión"}
            onPress={handleLogout}
            disabled={isSigningOut}
            variant={BUTTON_VARIANT.GHOST}
          />
        </View>
      </View>
    </AuthenticatedScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: SPACING.md,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: COLORS.mint,
    fontFamily: FONT.label,
    fontSize: 12,
    letterSpacing: 1.5,
  },
  title: {
    color: COLORS.ink,
    fontFamily: FONT.display,
    fontSize: 38,
    lineHeight: 43,
  },
  profileCard: {
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  statusCard: {
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.panelRaised,
    padding: SPACING.md,
  },
  profileLabel: {
    color: COLORS.muted,
    fontFamily: FONT.label,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  email: {
    color: COLORS.ink,
    fontFamily: FONT.body,
    fontSize: 18,
  },
  createdAt: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 13,
  },
  statusCopy: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  error: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
  },
});
