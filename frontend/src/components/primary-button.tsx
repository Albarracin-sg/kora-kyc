import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export const BUTTON_VARIANT = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  GHOST: "ghost",
  DANGER: "danger",
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];

interface PrimaryButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  variant?: ButtonVariant;
  accessibilityHint?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  variant = BUTTON_VARIANT.PRIMARY,
  accessibilityHint,
}: PrimaryButtonProps): ReactNode {
  const isPrimary = variant === BUTTON_VARIANT.PRIMARY;
  const isDanger = variant === BUTTON_VARIANT.DANGER;
  const isGhost = variant === BUTTON_VARIANT.GHOST;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary && styles.primary,
        isDanger && styles.danger,
        isGhost && styles.ghost,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.labelRow}>
        <Text
          style={[
            styles.label,
            isPrimary && styles.primaryLabel,
            isDanger && styles.primaryLabel,
            isGhost && styles.ghostLabel,
          ]}
        >
          {label}
        </Text>
        {isPrimary || isDanger ? <Text style={styles.arrow}>→</Text> : null}
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
    borderColor: COLORS.line,
  },
  primary: {
    backgroundColor: COLORS.mint,
    borderColor: COLORS.mint,
  },
  danger: {
    backgroundColor: COLORS.coral,
    borderColor: COLORS.coral,
  },
  ghost: {
    backgroundColor: COLORS.transparent,
    borderColor: COLORS.transparent,
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
    color: COLORS.cream,
    fontFamily: FONT.button,
    fontSize: 16,
  },
  primaryLabel: {
    color: COLORS.ink,
  },
  ghostLabel: {
    color: COLORS.muted,
  },
  arrow: {
    color: COLORS.ink,
    fontFamily: FONT.label,
    fontSize: 20,
  },
});
