import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CedulaDataCard } from "../components/cedula-data-card";
import { KycMediaImage } from "../components/kyc-media-image";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { ScreenShell } from "../components/screen-shell";
import { StatusBadge } from "../components/status-badge";
import { toUserFacingError } from "../contexts/auth-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import { koraApiClient } from "../services/api-client";
import { getKycStatusPresentation } from "../services/kyc-status";
import type { KycHistoryDetail } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export function KycHistoryDetailScreen({ navigation, route }: AppScreenProps<typeof APP_ROUTE.KYC_HISTORY_DETAIL>): ReactNode {
  const [detail, setDetail] = useState<KycHistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; setDetail(null); koraApiClient.getKycHistoryDetail(route.params.verificationId).then((value) => { if (active) setDetail(value); }, (loadError: unknown) => { if (active) setError(toUserFacingError(loadError)); }); return () => { active = false; setDetail(null); }; }, [route.params.verificationId]);
  if (!detail) return <ScreenShell><View style={styles.content}><Text style={styles.title}>Detalle</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : <Text style={styles.copy}>Cargando verificación privada…</Text>}<PrimaryButton label="Volver" onPress={() => navigation.goBack()} variant={BUTTON_VARIANT.GHOST} /></View></ScreenShell>;
  const presentation = getKycStatusPresentation(detail.status, detail.reasonCode);
  return <ScreenShell><View style={styles.content}><Text style={styles.title}>Detalle</Text><StatusBadge label={presentation.label} tone={presentation.tone} /><Text style={styles.copy}>{new Date(detail.finalizedAt).toLocaleDateString("es-CO")}</Text><CedulaDataCard fullName={detail.documentFullName} documentNumber={detail.documentNumber} birthDate={detail.documentBirthDate} issueDate={detail.documentIssueDate} sex={detail.documentSex} height={detail.documentHeight} bloodType={detail.documentBloodType} birthPlace={detail.documentBirthPlace} nationality={detail.documentNationality} checkResult={detail.documentCheckResult} />{detail.images.map((image) => <KycMediaImage key={image.id} mediaId={image.id} accessibilityLabel="Imagen privada de verificación" style={styles.image} resizeMode="contain" />)}<PrimaryButton label="Volver" onPress={() => navigation.goBack()} variant={BUTTON_VARIANT.GHOST} /></View></ScreenShell>;
}

const styles = StyleSheet.create({ content: { flex: 1, gap: SPACING.md }, title: { color: COLORS.cream, fontFamily: FONT.display, fontSize: 38 }, copy: { color: COLORS.muted, fontFamily: FONT.body }, error: { color: COLORS.coral, fontFamily: FONT.body }, image: { height: 220, borderRadius: RADIUS.md, backgroundColor: COLORS.panelRaised } });
