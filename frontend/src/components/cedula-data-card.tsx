import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getCedulaVerdictPresentation } from "../services/kyc-status";
import { type DocumentCheckResult } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface CedulaDataCardProps {
  fullName: string | null;
  documentNumber: string | null;
  birthDate: string | null;
  issueDate: string | null;
  sex: string | null;
  height: string | null;
  checkResult: DocumentCheckResult | null;
}

export function CedulaDataCard({
  fullName,
  documentNumber,
  birthDate,
  issueDate,
  sex,
  height,
  checkResult,
}: CedulaDataCardProps): ReactNode {
  const verdict = getCedulaVerdictPresentation(checkResult);

  return (
    <View style={styles.card} accessibilityLabel="Datos de la cédula">
      <View style={styles.cardHeader}>
        <Text style={styles.cardEyebrow}>DATOS DE LA CÉDULA</Text>
        <Text style={[styles.cardVerdict, { color: VERDICT_TONE_COLOR[verdict.tone] }]}>
          {verdict.label}
        </Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Titular</Text>
        <Text style={styles.fieldValue}>{fullName ?? "—"}</Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Número</Text>
        <Text style={styles.fieldValue}>{documentNumber ?? "—"}</Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Fecha de nacimiento</Text>
        <Text style={styles.fieldValue}>{formatDocumentDate(birthDate)}</Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Fecha de expedición</Text>
        <Text style={styles.fieldValue}>{formatDocumentDate(issueDate)}</Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Sexo</Text>
        <Text style={styles.fieldValue}>{sex ?? "—"}</Text>
      </View>

      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Estatura</Text>
        <Text style={styles.fieldValue}>{height ?? "—"}</Text>
      </View>
    </View>
  );
}

const VERDICT_TONE_COLOR = {
  neutral: COLORS.muted,
  pending: COLORS.mint,
  success: COLORS.mint,
  danger: COLORS.coral,
  review: COLORS.amber,
} as const;

function formatDocumentDate(date: string | null): string {
  if (!date) {
    return "—";
  }

  // Accept both the date-only form ("1990-05-15") and the API ISO datetime
  // wire format ("1990-05-15T00:00:00.000Z"). Parse the date part directly so
  // rendering stays deterministic in any timezone (never `new Date(...)`).
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
      date,
    );
  if (!match) {
    return "—";
  }

  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (year === undefined || month === undefined || day === undefined) {
    return "—";
  }

  return `${Number(day)}/${Number(month)}/${year}`;
}

const styles = StyleSheet.create({
  card: {
    gap: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panel,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
  },
  cardEyebrow: {
    color: COLORS.amber,
    fontFamily: FONT.label,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  cardVerdict: {
    fontFamily: FONT.label,
    fontSize: 12,
    flexShrink: 1,
    textAlign: "right",
    letterSpacing: 0.4,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.md,
  },
  fieldLabel: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  fieldValue: {
    color: COLORS.cream,
    fontFamily: FONT.label,
    fontSize: 14,
    flexShrink: 1,
    textAlign: "right",
  },
});