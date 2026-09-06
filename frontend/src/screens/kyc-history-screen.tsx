import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { StatusBadge } from "../components/status-badge";
import { toUserFacingError } from "../contexts/auth-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { koraApiClient } from "../services/api-client";
import { getKycStatusPresentation } from "../services/kyc-status";
import type { KycHistoryItem } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

function similarityLabel(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1
    ? `${Math.round(value * 100)}%`
    : null;
}

export function KycHistoryScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.KYC_HISTORY>): ReactNode {
  const [items, setItems] = useState<KycHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    koraApiClient.getKycHistory().then(
      (result) => { if (active) { setItems(result.items); setNextCursor(result.nextCursor); setLoading(false); } },
      (loadError: unknown) => { if (active) { setError(toUserFacingError(loadError)); setLoading(false); } },
    );
    return () => { active = false; };
  }, []);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    try {
      const result = await koraApiClient.getKycHistory(nextCursor);
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (loadError: unknown) { setError(toUserFacingError(loadError)); }
  }

  return <ScreenShell><View style={styles.content}>
    <Text style={styles.eyebrow}>KORA / IDENTIDAD</Text><Text style={styles.title}>Historial</Text>
    {loading ? <Text style={styles.copy}>Cargando historial privado…</Text> : null}
    {items.map((item) => {
      const presentation = getKycStatusPresentation(item.status, null);
      const similarity = similarityLabel(item.faceSimilarity);
      return <Pressable key={item.id} style={styles.entry} onPress={() => navigation.navigate(APP_ROUTE.KYC_HISTORY_DETAIL, { verificationId: item.id })} accessibilityRole="button" accessibilityLabel={`Abrir verificación del ${new Date(item.finalizedAt).toLocaleDateString("es-CO")}`}>
        <Text style={styles.date}>{new Date(item.finalizedAt).toLocaleDateString("es-CO")}</Text><StatusBadge label={presentation.label} tone={presentation.tone} />{similarity ? <Text style={styles.similarity}>{similarity}</Text> : null}
      </Pressable>;
    })}
    {!loading && items.length === 0 && !error ? <Text style={styles.copy}>No hay verificaciones disponibles.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {nextCursor ? <PrimaryButton label="Cargar más" onPress={loadMore} variant={BUTTON_VARIANT.GHOST} /> : null}
    <PrimaryButton label="Volver" onPress={() => navigation.goBack()} variant={BUTTON_VARIANT.GHOST} />
  </View></ScreenShell>;
}

const styles = StyleSheet.create({ content: { flex: 1, gap: SPACING.md }, eyebrow: { color: COLORS.mint, fontFamily: FONT.label, fontSize: 11, letterSpacing: 1.3 }, title: { color: COLORS.cream, fontFamily: FONT.display, fontSize: 38 }, entry: { gap: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: COLORS.panel, padding: SPACING.md }, date: { color: COLORS.cream, fontFamily: FONT.body, fontSize: 17 }, similarity: { color: COLORS.mint, fontFamily: FONT.label, fontSize: 18 }, copy: { color: COLORS.muted, fontFamily: FONT.body }, error: { color: COLORS.coral, fontFamily: FONT.body } });
