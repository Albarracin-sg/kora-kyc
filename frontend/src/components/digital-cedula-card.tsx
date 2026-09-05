import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KycMediaImage } from "./kyc-media-image";
import { getDocumentImages, getSelfieImage } from "../services/kyc-flow";
import { formatFaceSimilarity } from "../services/kyc-status";
import { DOCUMENT_SIDE, type KycImageMetadata } from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

interface DigitalCedulaCardProps {
  images: KycImageMetadata[];
  faceSimilarity: number | null;
  statusLabel: string;
}

export function DigitalCedulaCard({
  images,
  faceSimilarity,
  statusLabel,
}: DigitalCedulaCardProps): ReactNode {
  const documentImages = getDocumentImages(images);
  const selfieImage = getSelfieImage(images);
  const similarity = formatFaceSimilarity(faceSimilarity);

  return (
    <View style={styles.card} accessibilityLabel="Cédula digital">
      <View style={styles.cardHeader}>
        <Text style={styles.cardEyebrow}>CÉDULA DIGITAL</Text>
        <Text style={styles.cardStatus}>{statusLabel}</Text>
      </View>

      <View style={styles.photosRow}>
        <View style={styles.documentColumn}>
          {documentImages.map((image) => (
            <KycMediaImage
              key={image.id}
              mediaId={image.id}
              accessibilityLabel={documentSideLabel(image.side)}
              style={styles.documentPhoto}
            />
          ))}
        </View>
        {selfieImage ? (
          <KycMediaImage
            mediaId={selfieImage.id}
            accessibilityLabel="Fotografía del rostro"
            style={styles.selfiePhoto}
          />
        ) : null}
      </View>

      {similarity !== null ? (
        <View style={styles.similarityRow}>
          <Text style={styles.similarityLabel}>Coincidencia facial</Text>
          <Text style={styles.similarityValue}>{similarity}</Text>
        </View>
      ) : null}
    </View>
  );
}

function documentSideLabel(side: KycImageMetadata["side"]): string {
  if (side === DOCUMENT_SIDE.FRONT) {
    return "Fotografía del frente del documento";
  }

  if (side === DOCUMENT_SIDE.BACK) {
    return "Fotografía del reverso del documento";
  }

  return "Fotografía del documento";
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
  cardStatus: {
    color: COLORS.cream,
    fontFamily: FONT.body,
    fontSize: 14,
    flexShrink: 1,
    textAlign: "right",
  },
  photosRow: {
    flexDirection: "row",
    gap: SPACING.md,
  },
  documentColumn: {
    flex: 1,
    gap: SPACING.sm,
  },
  documentPhoto: {
    width: "100%",
    height: 180,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.panelRaised,
  },
  selfiePhoto: {
    width: 132,
    height: 180,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.panelRaised,
  },
  similarityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: SPACING.sm,
  },
  similarityLabel: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  similarityValue: {
    color: COLORS.mint,
    fontFamily: FONT.label,
    fontSize: 20,
  },
});