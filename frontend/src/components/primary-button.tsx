import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export const BUTTON_VARIANT = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  GHOST: "ghost",
  ON_DARK: "onDark",
  DANGER: "danger",
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];

interface PrimaryButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  variant?: ButtonVariant;
  accessibilityHint?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  compact = false,
  variant = BUTTON_VARIANT.PRIMARY,
  accessibilityHint,
}: PrimaryButtonProps): ReactNode {
  const isPrimary = variant === BUTTON_VARIANT.PRIMARY;
  const isDanger = variant === BUTTON_VARIANT.DANGER;
  const isGhost = variant === BUTTON_VARIANT.GHOST;
  const isOnDark = variant === BUTTON_VARIANT.ON_DARK;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        isPrimary && styles.primary,
        isDanger && styles.danger,
        isGhost && styles.ghost,
        isOnDark && styles.onDark,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
      ]}
    >
      <View style={styles.labelRow}>
        <Text
          style={[
            styles.label,
            isPrimary && styles.primaryLabel,
            isDanger && styles.primaryLabel,
            isGhost && styles.ghostLabel,
            isOnDark && styles.onDarkLabel,
          ]}
        >
          {label}
        </Text>
        {loading ? (
          <ActivityIndicator
            color={isPrimary || isDanger ? COLORS.cream : COLORS.ink}
            size="small"
          />
        ) : isPrimary || isDanger || isOnDark ? (
          <Text style={[styles.arrow, isOnDark && styles.onDarkArrow]}>→</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.md,
     backgroundColor: COLORS.panel,
     borderColor: COLORS.ink,
  },
  compact: {
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  primary: {
     backgroundColor: COLORS.ink,
     borderColor: COLORS.ink,
  },
  danger: {
     backgroundColor: COLORS.coral,
     borderColor: COLORS.coral,
  },
  ghost: {
    backgroundColor: COLORS.transparent,
    borderColor: COLORS.transparent,
  },
  onDark: {
    backgroundColor: COLORS.cream,
    borderColor: COLORS.cream,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    color: COLORS.ink,
    fontFamily: FONT.button,
    fontSize: 16,
    flexShrink: 1,
    lineHeight: 20,
  },
  primaryLabel: {
     color: COLORS.cream,
  },
  ghostLabel: {
    color: COLORS.ink,
  },
  onDarkLabel: {
    color: COLORS.ink,
  },
  arrow: {
    color: COLORS.cream,
    fontFamily: FONT.label,
    fontSize: 20,
  },
  onDarkArrow: {
    color: COLORS.ink,
  },
});
