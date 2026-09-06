import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CedulaDataCard } from "../components/cedula-data-card";
import { KycMediaImage } from "../components/kyc-media-image";
import { PrimaryButton, BUTTON_VARIANT } from "../components/primary-button";
import { BackToHomeButton } from "../components/back-to-home-button";
import { AuthenticatedScreenShell } from "../components/authenticated-screen-shell";
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
   if (!detail) return <AuthenticatedScreenShell activeRoute={APP_ROUTE.KYC_HISTORY} navigation={navigation}><View style={styles.content}><View style={styles.header}><BackToHomeButton navigation={navigation} /><View style={styles.headerCopy}><Text style={styles.eyebrow}>REGISTRO PRIVADO</Text><Text style={styles.title}>Detalle</Text></View></View>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : <Text style={styles.copy}>Cargando verificación privada…</Text>}<PrimaryButton label="Volver" onPress={() => navigation.goBack()} variant={BUTTON_VARIANT.GHOST} /></View></AuthenticatedScreenShell>;
   const presentation = getKycStatusPresentation(detail.status, detail.reasonCode);
   return <AuthenticatedScreenShell activeRoute={APP_ROUTE.KYC_HISTORY} navigation={navigation}><View style={styles.content}><View style={styles.header}><BackToHomeButton navigation={navigation} /><View style={styles.headerCopy}><Text style={styles.eyebrow}>REGISTRO PRIVADO</Text><Text style={styles.title}>Detalle</Text><Text style={styles.copy}>{new Date(detail.finalizedAt).toLocaleDateString("es-CO")}</Text></View></View><StatusBadge label={presentation.label} tone={presentation.tone} /><CedulaDataCard fullName={detail.documentFullName} documentNumber={detail.documentNumber} birthDate={detail.documentBirthDate} issueDate={detail.documentIssueDate} sex={detail.documentSex} height={detail.documentHeight} bloodType={detail.documentBloodType} birthPlace={detail.documentBirthPlace} nationality={detail.documentNationality} checkResult={detail.documentCheckResult} /><View style={styles.evidenceSection}><Text style={styles.evidenceTitle}>Evidencia privada</Text><Text style={styles.evidenceCopy}>Disponible únicamente en este registro autenticado.</Text>{detail.images.map((image) => <KycMediaImage key={image.id} mediaId={image.id} accessibilityLabel="Imagen privada de verificación" style={styles.image} resizeMode="contain" />)}</View><PrimaryButton label="Volver" onPress={() => navigation.goBack()} variant={BUTTON_VARIANT.GHOST} /></View></AuthenticatedScreenShell>;
}

const styles = StyleSheet.create({ content: { flex: 1, gap: SPACING.md }, header: { alignItems: "flex-start", flexDirection: "row", gap: SPACING.md }, headerCopy: { flex: 1, minWidth: 0 }, eyebrow: { color: COLORS.mintDark, fontFamily: FONT.label, fontSize: 11, letterSpacing: 1.3 }, title: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 34, lineHeight: 39, flexShrink: 1 }, copy: { color: COLORS.muted, fontFamily: FONT.body }, error: { color: COLORS.coral, fontFamily: FONT.body }, evidenceSection: { gap: SPACING.sm, marginTop: SPACING.sm }, evidenceTitle: { color: COLORS.ink, fontFamily: FONT.display, fontSize: 22 }, evidenceCopy: { color: COLORS.muted, fontFamily: FONT.body, fontSize: 14 }, image: { height: 220, borderColor: COLORS.line, borderRadius: RADIUS.md, borderWidth: 1, backgroundColor: COLORS.panelRaised } });
