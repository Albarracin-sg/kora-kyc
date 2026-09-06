import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { COLORS, FONT, SPACING } from "../theme/theme";

const BRAND_SIZE = {
  COMPACT: "compact",
  FEATURE: "feature",
} as const;

type BrandSize = (typeof BRAND_SIZE)[keyof typeof BRAND_SIZE];

interface KoraBrandProps {
  size?: BrandSize;
  showPromise?: boolean;
  onLight?: boolean;
}

export function KoraBrand({ size = BRAND_SIZE.COMPACT, showPromise = true, onLight = false }: KoraBrandProps): ReactNode {
  const isFeature = size === BRAND_SIZE.FEATURE;

  return (
    <View style={[styles.container, isFeature && styles.featureContainer]}>
      <Image
        accessibilityLabel="Marca de Kora"
        source={require("../../assets/image.png")}
        style={[styles.mark, isFeature && styles.featureMark]}
      />
      <View style={styles.copy}>
        <Text style={[styles.name, isFeature && styles.featureName, onLight && styles.nameOnLight]}>Kora KYC</Text>
        {showPromise ? <Text style={[styles.promise, onLight && styles.promiseOnLight]}>Verificación de identidad privada, bajo su control.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.sm,
  },
  featureContainer: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: SPACING.md,
  },
  mark: {
    height: 42,
    width: 42,
  },
  featureMark: {
    height: 104,
    width: 104,
  },
  copy: {
    flexShrink: 1,
    gap: 2,
  },
  name: {
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 22,
    letterSpacing: 0.2,
  },
  featureName: {
    fontSize: 34,
  },
  nameOnLight: {
    color: COLORS.ink,
  },
  promise: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 13,
    lineHeight: 18,
  },
  promiseOnLight: {
    color: COLORS.muted,
  },
});
