import type { ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "sentences";
  accessibilityHint?: string;
}

export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  accessibilityHint,
}: FormFieldProps): ReactNode {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        secureTextEntry={secureTextEntry}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: SPACING.xs,
  },
  label: {
    color: COLORS.muted,
    fontFamily: FONT.label,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 54,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panel,
    color: COLORS.ink,
    fontFamily: FONT.body,
    fontSize: 16,
    paddingHorizontal: SPACING.md,
  },
});
