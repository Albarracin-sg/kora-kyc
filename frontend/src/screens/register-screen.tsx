import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FormField } from "../components/form-field";
import { KoraBrand } from "../components/kora-brand";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { toUserFacingError, useAuth } from "../contexts/auth-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { COLORS, FONT, SPACING } from "../theme/theme";

export function RegisterScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.REGISTER>): ReactNode {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await register({ email, password });
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
        <Text style={styles.eyebrow}>CUENTA / PASO 01</Text>
        <Text style={styles.title}>Comience con calma{"\n"}y de forma segura.</Text>
        <Text style={styles.copy}>Use un correo electrónico al que tenga acceso. La contraseña debe tener al menos 10 caracteres.</Text>

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
            placeholder="Al menos 10 caracteres"
            secureTextEntry
            autoCapitalize="none"
            accessibilityHint="Cree una contraseña de al menos 10 caracteres"
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            label={isSubmitting ? "Registrando cuenta" : "Registrarse"}
            onPress={handleRegister}
            disabled={isSubmitting || !email || password.length < 10}
          />
          <PrimaryButton
            label="Ya tengo una cuenta"
            onPress={() => navigation.navigate(APP_ROUTE.LOGIN)}
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
