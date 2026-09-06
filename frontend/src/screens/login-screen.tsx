import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FormField } from "../components/form-field";
import { KoraBrand } from "../components/kora-brand";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { toUserFacingError, useAuth } from "../contexts/auth-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function LoginScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.LOGIN>): ReactNode {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ email, password });
    } catch (submissionError: unknown) {
      setError(toUserFacingError(submissionError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell>
      <View style={styles.content}>
        <KoraBrand />
        <Text style={styles.eyebrow}>REGRESO / IDENTIDAD PRIVADA</Text>
        <Text style={styles.title}>Continúe con su verificación.</Text>
        <Text style={styles.copy}>Inicie sesión para continuar con su verificación de identidad.</Text>

        <View style={styles.form}>
          <FormField
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            placeholder="nombre@ejemplo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            accessibilityHint="Ingrese su correo electrónico"
          />
          <FormField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder="Su contraseña"
            secureTextEntry
            autoCapitalize="none"
            accessibilityHint="Ingrese su contraseña"
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            label={isSubmitting ? "Iniciando sesión" : "Iniciar sesión"}
            onPress={handleLogin}
            disabled={isSubmitting || !email || !password}
          />
          <PrimaryButton
            label="Registrarse"
            onPress={() => navigation.navigate(APP_ROUTE.REGISTER)}
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
    color: COLORS.ink,
    fontFamily: FONT.display,
    fontSize: 40,
    lineHeight: 45,
  },
  copy: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 16,
    lineHeight: 24,
  },
  form: {
    marginTop: SPACING.lg,
    gap: SPACING.md,
  },
  error: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 20,
  },
});
