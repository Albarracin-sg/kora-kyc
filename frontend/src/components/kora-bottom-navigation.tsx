import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { APP_ROUTE, type KycFlowRoute } from "../navigation/routes";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface BottomNavigation {
  navigate(route: typeof APP_ROUTE.HOME | typeof APP_ROUTE.PROFILE | KycFlowRoute): void;
}

interface KoraBottomNavigationProps {
  activeRoute: typeof APP_ROUTE.HOME | typeof APP_ROUTE.PROFILE;
  kycRoute: KycFlowRoute;
  navigation: BottomNavigation;
}

const DESTINATION = {
  HOME: "Inicio",
  VERIFY: "Verificar",
  PROFILE: "Perfil",
} as const;

export function KoraBottomNavigation({ activeRoute, kycRoute, navigation }: KoraBottomNavigationProps): ReactNode {
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      <NavigationItem
        active={activeRoute === APP_ROUTE.HOME}
        icon="⌂"
        label={DESTINATION.HOME}
        onPress={() => navigation.navigate(APP_ROUTE.HOME)}
      />
      <NavigationItem
        active={false}
        icon="●"
        label={DESTINATION.VERIFY}
        onPress={() => navigation.navigate(kycRoute)}
      />
      <NavigationItem
        active={activeRoute === APP_ROUTE.PROFILE}
        icon="◌"
        label={DESTINATION.PROFILE}
        onPress={() => navigation.navigate(APP_ROUTE.PROFILE)}
      />
    </View>
  );
}

interface NavigationItemProps {
  active: boolean;
  icon: string;
  label: string;
  onPress(): void;
}

function NavigationItem({ active, icon, label, onPress }: NavigationItemProps): ReactNode {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && styles.itemPressed]}
    >
      <Text style={[styles.icon, active && styles.itemTextActive]}>{icon}</Text>
      <Text style={[styles.label, active && styles.itemTextActive]}>{label}</Text>
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
  },
  itemActive: {
    backgroundColor: COLORS.mint,
  },
  itemPressed: {
    opacity: 0.74,
  },
  icon: {
    color: COLORS.cream,
    fontFamily: FONT.label,
    fontSize: 17,
    lineHeight: 19,
  },
  label: {
    color: COLORS.cream,
    fontFamily: FONT.label,
    fontSize: 11,
  },
  itemTextActive: {
    color: COLORS.ink,
  },
});
