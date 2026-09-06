import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { APP_ROUTE } from "../navigation/routes";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface BackNavigation {
  canGoBack(): boolean;
  goBack(): void;
  navigate(route: typeof APP_ROUTE.HOME): void;
}

interface BackToHomeButtonProps {
  navigation: BackNavigation;
}

export function BackToHomeButton({ navigation }: BackToHomeButtonProps): ReactNode {
  function handlePress(): void {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate(APP_ROUTE.HOME);
  }

  return (
    <Pressable
      accessibilityHint="Vuelve a la vista anterior o al centro de identidad"
      accessibilityLabel="Volver"
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.icon}>←</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: COLORS.panel,
    borderColor: COLORS.line,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  buttonPressed: {
    backgroundColor: COLORS.panelRaised,
  },
  icon: {
    color: COLORS.ink,
    fontFamily: FONT.label,
    fontSize: 20,
    lineHeight: 24,
    marginBottom: SPACING.xs / 3,
  },
});
