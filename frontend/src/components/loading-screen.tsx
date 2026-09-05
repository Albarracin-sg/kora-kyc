import type { ReactNode } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "./screen-shell";
import { COLORS, FONT, SPACING } from "../theme/theme";

export function LoadingScreen(): ReactNode {
  return (
    <ScreenShell scroll={false}>
      <View style={styles.content} accessibilityRole="progressbar">
        <Image
          accessibilityLabel="Marca de Kora"
          source={require("../../assets/image.png")}
          style={styles.mark}
        />
        <ActivityIndicator color={COLORS.mint} size="large" />
        <Text style={styles.text}>Preparando su espacio privado de verificación</Text>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.lg,
  },
  mark: {
    height: 76,
    width: 76,
  },
  text: {
    maxWidth: 220,
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
});
