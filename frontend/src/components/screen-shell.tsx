import { useEffect, useRef, type ReactNode } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, SPACING } from "../theme/theme";

interface ScreenShellProps {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}

export function ScreenShell({ children, footer, scroll = true }: ScreenShellProps): ReactNode {
  const entranceProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entranceProgress, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [entranceProgress]);

  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.fixedContent}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <View pointerEvents="none" style={styles.paperGlow} />
      <View pointerEvents="none" style={styles.paperAccent} />
      <Animated.View
        style={[
          styles.contentMotion,
          {
            opacity: entranceProgress,
            transform: [{ translateY: entranceProgress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          },
        ]}
        >
          {content}
        </Animated.View>
        {footer}
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.cream,
    overflow: "hidden",
  },
  contentMotion: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  fixedContent: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  paperGlow: {
    position: "absolute",
    width: 280,
    height: 280,
    top: -120,
    right: -100,
    borderRadius: 140,
    backgroundColor: COLORS.botanicalGlow,
    opacity: 0.8,
  },
  paperAccent: {
    position: "absolute",
    width: 190,
    height: 190,
    bottom: -85,
    left: -90,
    borderRadius: 95,
    backgroundColor: COLORS.amber,
    opacity: 0.22,
  },
});
