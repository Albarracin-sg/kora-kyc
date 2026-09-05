import { useEffect, useRef, type ReactNode } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "./primary-button";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface StepSuccessModalProps {
  visible: boolean;
  title: string;
  message: string;
  onDismiss(): void;
  autoDismissMs?: number;
}

export function StepSuccessModal({
  visible,
  title,
  message,
  onDismiss,
  autoDismissMs,
}: StepSuccessModalProps): ReactNode {
  const dismissedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!visible) {
      dismissedRef.current = false;
      return undefined;
    }

    if (autoDismissMs === undefined || autoDismissMs <= 0) {
      return undefined;
    }

    const timer = setTimeout(() => {
      dismissOnce();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [visible, autoDismissMs]);

  function dismissOnce(): void {
    if (dismissedRef.current) {
      return;
    }

    dismissedRef.current = true;
    onDismissRef.current();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissOnce}
    >
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          style={styles.card}
          accessibilityLabel={`${title}. ${message}`}
        >
          <View accessibilityElementsHidden style={styles.checkCircle}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.action}>
            <PrimaryButton label="Continuar" onPress={dismissOnce} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
    backgroundColor: "rgba(2, 10, 8, 0.72)",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    gap: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panel,
    padding: SPACING.lg,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.successSurface,
  },
  checkMark: {
    color: COLORS.mint,
    fontFamily: FONT.heavy,
    fontSize: 34,
    lineHeight: 38,
  },
  title: {
    color: COLORS.cream,
    fontFamily: FONT.display,
    fontSize: 22,
    lineHeight: 27,
    textAlign: "center",
  },
  message: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  action: {
    alignSelf: "stretch",
    marginTop: SPACING.xs,
  },
});