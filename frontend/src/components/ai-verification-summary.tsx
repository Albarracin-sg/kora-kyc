import { StyleSheet, Text, View } from "react-native";
import type { FaceAiVerdict } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface AiVerificationSummaryProps {
  verdict?: FaceAiVerdict | null;
  similarityPercent?: number | null;
  summary?: string | null;
  biometricSimilarity?: number | null;
  combinedSimilarityPercent?: number | null;
  combinedVerdict?: FaceAiVerdict | null;
}

const VERDICT_LABEL: Record<FaceAiVerdict, string> = {
  same_person: "Probablemente la misma persona",
  different_person: "Probablemente personas diferentes",
  needs_review: "Requiere revisión adicional",
};

export function AiVerificationSummary({
  verdict,
  similarityPercent,
  summary,
  biometricSimilarity,
  combinedSimilarityPercent,
  combinedVerdict,
}: AiVerificationSummaryProps): React.ReactNode {
  if (
    verdict == null &&
    similarityPercent == null &&
    summary == null &&
    biometricSimilarity == null &&
    combinedSimilarityPercent == null
  ) {
    return null;
  }

  const percentage = typeof similarityPercent === "number"
    ? `${Math.round(similarityPercent)}%`
    : "No disponible";
  const biometricPercentage = typeof biometricSimilarity === "number"
    ? `${Math.round(Math.min(1, Math.max(0, biometricSimilarity)) * 100)}%`
    : "No disponible";
  const combinedPercentage = typeof combinedSimilarityPercent === "number"
    ? `${Math.round(combinedSimilarityPercent)}%`
    : "No disponible";
  const combinedLabel = combinedVerdict === "same_person"
    ? "Misma persona"
    : combinedVerdict === "different_person"
      ? "Personas diferentes"
      : "Requiere revisión";

  return (
    <View style={styles.card} accessibilityLabel="Resumen complementario de inteligencia artificial">
      <Text style={styles.eyebrow}>ANÁLISIS COMPLEMENTARIO DE IA</Text>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Comparación facial</Text>
        <Text style={styles.percentage}>{combinedPercentage}</Text>
      </View>
      <View style={styles.metricRow}>
        <Text style={styles.metricLabel}>Biométrica técnica</Text>
        <Text style={styles.metricValue}>{biometricPercentage}</Text>
      </View>
      <View style={styles.metricRow}>
        <Text style={styles.metricLabel}>Comparación de IA</Text>
        <Text style={styles.metricValue}>{percentage}</Text>
      </View>
      <View style={styles.metricRow}>
        <Text style={styles.metricLabel}>Promedio final</Text>
        <Text style={styles.metricValue}>{combinedPercentage}</Text>
      </View>
      {combinedVerdict ? <Text style={styles.verdict}>Resultado: {combinedLabel}</Text> : null}
      {verdict ? <Text style={styles.aiVerdict}>IA: {VERDICT_LABEL[verdict]}</Text> : null}
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      <Text style={styles.note}>
        Este resumen complementa la comparación biométrica técnica.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panelRaised,
    padding: SPACING.md,
  },
  eyebrow: {
    color: COLORS.mintDark,
    fontFamily: FONT.label,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: SPACING.sm,
  },
  title: {
    color: COLORS.ink,
    fontFamily: FONT.display,
    fontSize: 20,
  },
  percentage: {
    color: COLORS.mintDark,
    fontFamily: FONT.display,
    fontSize: 24,
  },
  verdict: {
    color: COLORS.ink,
    fontFamily: FONT.body,
    fontSize: 15,
    fontWeight: "700",
  },
  aiVerdict: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 13,
  },
  metricRow: {
    alignItems: "center",
    borderTopColor: COLORS.line,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: SPACING.xs,
  },
  metricLabel: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 13,
  },
  metricValue: {
    color: COLORS.ink,
    fontFamily: FONT.label,
    fontSize: 14,
  },
  summary: {
    color: COLORS.ink,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 21,
  },
  note: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 12,
    lineHeight: 17,
  },
});
