import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KoraBrand } from "../components/kora-brand";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { COLORS, FONT, SPACING } from "../theme/theme";

export function WelcomeScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.WELCOME>): ReactNode {
  return (
    <ScreenShell scroll={false}>
      <View style={styles.layout}>
        <View style={styles.brandBlock}>
          <KoraBrand size="feature" />
          <Text style={styles.eyebrow}>IDENTIDAD PRIVADA / VERIFICADA CON CUIDADO</Text>
          <Text style={styles.headline}>Su identidad,{"\n"}tratada con cuidado.</Text>
          <Text style={styles.copy}>
            Un flujo de verificación de identidad guiado por cámara, que mantiene la captura en su
            dispositivo y el procesamiento en un servicio local privado.
          </Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label="Registrarse"
            onPress={() => navigation.navigate(APP_ROUTE.REGISTER)}
            accessibilityHint="Abre el registro de una cuenta"
          />
          <PrimaryButton
            label="Ya tengo una cuenta"
            onPress={() => navigation.navigate(APP_ROUTE.LOGIN)}
            variant={BUTTON_VARIANT.GHOST}
            accessibilityHint="Abre el inicio de sesión"
          />
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    justifyContent: "space-between",
    paddingVertical: SPACING.md,
  },
  brandBlock: {
    gap: SPACING.lg,
  },
  eyebrow: {
    color: COLORS.mint,
    fontFamily: FONT.label,
    fontSize: 12,
    letterSpacing: 1.8,
  },
  headline: {
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 44,
    lineHeight: 48,
  },
  copy: {
    maxWidth: 315,
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 17,
    lineHeight: 25,
  },
  actions: {
    gap: SPACING.sm,
  },
});
