import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KYC_STATUS_TONE, type KycStatusTone } from "../services/kyc-status";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface StatusBadgeProps {
  label: string;
  tone: KycStatusTone;
}

const TONE_STYLE = {
  [KYC_STATUS_TONE.NEUTRAL]: { backgroundColor: COLORS.ink, color: COLORS.cream },
  [KYC_STATUS_TONE.PENDING]: { backgroundColor: COLORS.ink, color: COLORS.mint },
  [KYC_STATUS_TONE.SUCCESS]: { backgroundColor: COLORS.ink, color: COLORS.mint },
  [KYC_STATUS_TONE.DANGER]: { backgroundColor: COLORS.coralSurface, color: COLORS.coral },
  [KYC_STATUS_TONE.REVIEW]: { backgroundColor: COLORS.ink, color: COLORS.amber },
} as const;

export function StatusBadge({ label, tone }: StatusBadgeProps): ReactNode {
  const toneStyle = TONE_STYLE[tone];
  return (
    <View accessible accessibilityLabel={`Estado: ${label}`} style={[styles.badge, { backgroundColor: toneStyle.backgroundColor }]}>
      <View style={[styles.dot, { backgroundColor: toneStyle.color }]} />
      <Text style={[styles.label, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: RADIUS.pill,
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontFamily: FONT.label,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
});
