import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { BackToHomeButton } from "../components/back-to-home-button";
import { AuthenticatedScreenShell } from "../components/authenticated-screen-shell";
import { StatusBadge } from "../components/status-badge";
import { toUserFacingError } from "../contexts/auth-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { koraApiClient } from "../services/api-client";
import { getKycStatusPresentation } from "../services/kyc-status";
import type { KycHistoryItem } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

function similarityLabel(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1 ? `${Math.round(value * 100)}%` : null;
}

function aiSimilarityLabel(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? `IA: ${Math.round(value)}%`
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

  return <AuthenticatedScreenShell activeRoute={APP_ROUTE.KYC_HISTORY} navigation={navigation}><View style={styles.content}>
     <View style={styles.header}><BackToHomeButton navigation={navigation} /><View style={styles.headerCopy}><Text style={styles.eyebrow}>KORA / REGISTRO PRIVADO</Text><Text style={styles.title}>Historial privado</Text><Text style={styles.intro}>Registros de verificación</Text></View></View>
    {loading ? <Text style={styles.copy}>Cargando historial privado…</Text> : null}
    {items.map((item) => {
      const presentation = getKycStatusPresentation(item.status, null);
      const similarity = similarityLabel(item.faceSimilarity);
      const aiSimilarity = aiSimilarityLabel(item.faceAiSimilarityPercent);
      return <Pressable key={item.id} style={({ pressed }) => [styles.entry, pressed && styles.entryPressed]} onPress={() => navigation.navigate(APP_ROUTE.KYC_HISTORY_DETAIL, { verificationId: item.id })} accessibilityRole="button" accessibilityLabel={`Abrir verificación del ${new Date(item.finalizedAt).toLocaleDateString("es-CO")}`}>
       <View style={styles.entryHeader}><Text style={styles.date}>{new Date(item.finalizedAt).toLocaleDateString("es-CO")}</Text><Text style={styles.openLabel}>VER DETALLE</Text></View><StatusBadge label={presentation.label} tone={presentation.tone} />{similarity ? <Text style={styles.similarity}>{similarity}</Text> : null}{aiSimilarity ? <Text style={styles.aiSimilarity}>{aiSimilarity}</Text> : null}
      </Pressable>;
    })}
    {!loading && items.length === 0 && !error ? <Text style={styles.copy}>No hay verificaciones disponibles.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {nextCursor ? <PrimaryButton label="Cargar más" onPress={loadMore} variant={BUTTON_VARIANT.GHOST} /> : null}
    <PrimaryButton label="Volver" onPress={() => navigation.goBack()} variant={BUTTON_VARIANT.GHOST} />
   </View></AuthenticatedScreenShell>;
}

const styles = StyleSheet.create({
   content: { flex: 1, gap: SPACING.md }, header: { alignItems: "flex-start", flexDirection: "row", gap: SPACING.md, marginBottom: SPACING.sm }, headerCopy: { flex: 1, minWidth: 0 }, eyebrow: { color: COLORS.mintDark, fontFamily: FONT.label, fontSize: 11, letterSpacing: 1.3 }, title: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 34, lineHeight: 39, flexShrink: 1 }, intro: { color: COLORS.muted, fontFamily: FONT.body, fontSize: 16 }, entry: { backgroundColor: COLORS.panel, borderColor: COLORS.line, borderRadius: RADIUS.md, borderWidth: 1, gap: SPACING.sm, padding: SPACING.md }, entryPressed: { backgroundColor: COLORS.panelRaised }, entryHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, date: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 18 }, openLabel: { color: COLORS.mintDark, fontFamily: FONT.label, fontSize: 10, letterSpacing: 1 }, similarity: { color: COLORS.mintDark, fontFamily: FONT.label, fontSize: 18 }, aiSimilarity: { color: COLORS.mintDark, fontFamily: FONT.label, fontSize: 14 }, copy: { color: COLORS.muted, fontFamily: FONT.body }, error: { color: COLORS.coral, fontFamily: FONT.body },
});
