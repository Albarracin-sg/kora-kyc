import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { APP_ROUTE, type KycFlowRoute } from "../navigation/routes";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface BottomNavigation {
  navigate(route: typeof APP_ROUTE.HOME | typeof APP_ROUTE.PROFILE | KycFlowRoute): void;
}

interface KoraBottomNavigationProps {
  activeRoute: KycFlowRoute;
  kycRoute: KycFlowRoute;
  navigation: BottomNavigation;
}

const DESTINATION = {
  HOME: "Inicio",
  HISTORY: "Historial",
  VERIFY: "Verificar",
  PROFILE: "Perfil",
} as const;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

interface DestinationIcon {
  idle: IoniconName;
  active: IoniconName;
}

const DESTINATION_ICON: Record<keyof typeof DESTINATION, DestinationIcon> = {
  HOME: { idle: "home-outline", active: "home" },
  HISTORY: { idle: "time-outline", active: "time" },
  VERIFY: { idle: "shield-checkmark-outline", active: "shield-checkmark" },
  PROFILE: { idle: "person-outline", active: "person" },
};

export function KoraBottomNavigation({ activeRoute, kycRoute, navigation }: KoraBottomNavigationProps): ReactNode {
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) {
        setReduceMotionEnabled(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotionEnabled,
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const isVerifyActive =
    activeRoute !== APP_ROUTE.HOME &&
    activeRoute !== APP_ROUTE.KYC_HISTORY &&
    activeRoute !== APP_ROUTE.PROFILE;

  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      <NavigationItem
        active={activeRoute === APP_ROUTE.HOME}
        idleIcon={DESTINATION_ICON.HOME.idle}
        activeIcon={DESTINATION_ICON.HOME.active}
        label={DESTINATION.HOME}
        reduceMotionEnabled={reduceMotionEnabled}
        onPress={() => navigation.navigate(APP_ROUTE.HOME)}
      />
      <NavigationItem
        active={activeRoute === APP_ROUTE.KYC_HISTORY}
        idleIcon={DESTINATION_ICON.HISTORY.idle}
        activeIcon={DESTINATION_ICON.HISTORY.active}
        label={DESTINATION.HISTORY}
        reduceMotionEnabled={reduceMotionEnabled}
        onPress={() => navigation.navigate(APP_ROUTE.KYC_HISTORY)}
      />
      <NavigationItem
        active={isVerifyActive}
        idleIcon={DESTINATION_ICON.VERIFY.idle}
        activeIcon={DESTINATION_ICON.VERIFY.active}
        label={DESTINATION.VERIFY}
        reduceMotionEnabled={reduceMotionEnabled}
        onPress={() => navigation.navigate(kycRoute)}
      />
      <NavigationItem
        active={activeRoute === APP_ROUTE.PROFILE}
        idleIcon={DESTINATION_ICON.PROFILE.idle}
        activeIcon={DESTINATION_ICON.PROFILE.active}
        label={DESTINATION.PROFILE}
        reduceMotionEnabled={reduceMotionEnabled}
        onPress={() => navigation.navigate(APP_ROUTE.PROFILE)}
      />
    </View>
  );
}

interface NavigationItemProps {
  active: boolean;
  idleIcon: IoniconName;
  activeIcon: IoniconName;
  label: string;
  reduceMotionEnabled: boolean;
  onPress(): void;
}

function NavigationItem({
  active,
  idleIcon,
  activeIcon,
  label,
  reduceMotionEnabled,
  onPress,
}: NavigationItemProps): ReactNode {
  const selectionProgress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    const targetValue = active ? 1 : 0;
    if (reduceMotionEnabled) {
      selectionProgress.stopAnimation();
      selectionProgress.setValue(targetValue);
      return undefined;
    }

    const animation = Animated.timing(selectionProgress, {
      toValue: targetValue,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduceMotionEnabled, selectionProgress]);

  const selectionScale = selectionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });
  const selectionOpacity = selectionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
  });

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && styles.itemPressed]}
    >
      <Animated.View style={[styles.itemContent, { opacity: selectionOpacity, transform: [{ scale: selectionScale }] }]}>
        <Ionicons
          name={active ? activeIcon : idleIcon}
          size={22}
          color={active ? COLORS.ink : COLORS.cream}
          style={styles.icon}
        />
        <Text adjustsFontSizeToFit minimumFontScale={0.84} numberOfLines={1} style={[styles.label, active && styles.itemTextActive]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: COLORS.ink,
    borderRadius: RADIUS.lg,
    flexDirection: "row",
    gap: SPACING.xs,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    padding: SPACING.xs,
  },
  item: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 54,
    minWidth: 0,
    paddingHorizontal: 1,
  },
  itemContent: {
    alignItems: "center",
    gap: 2,
    width: "100%",
  },
  itemActive: {
    backgroundColor: COLORS.mint,
  },
  itemPressed: {
    opacity: 0.74,
  },
  icon: {
    marginBottom: 1,
  },
  label: {
    color: COLORS.cream,
    fontFamily: FONT.label,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
    width: "100%",
  },
  itemTextActive: {
    color: COLORS.ink,
  },
});
