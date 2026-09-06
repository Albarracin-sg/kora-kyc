import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getSelfieImage, hasDocumentSide, isTerminalKycStatus } from "../services/kyc-flow";
import {
  DOCUMENT_SIDE,
  KYC_STATUS,
  type KycImageMetadata,
  type KycVerification,
} from "../types/api";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";

export const KYC_STAGE = {
  FRONT: "front",
  BACK: "back",
  SELFIE: "selfie",
  VALIDATING: "validating",
} as const;

export type KycStage = (typeof KYC_STAGE)[keyof typeof KYC_STAGE];

export const KYC_STAGE_STATUS = {
  PENDING: "pending",
  CURRENT: "current",
  COMPLETED: "completed",
} as const;

export type KycStageStatus = (typeof KYC_STAGE_STATUS)[keyof typeof KYC_STAGE_STATUS];

export interface KycStageState {
  stage: KycStage;
  status: KycStageStatus;
}

interface KycStepIndicatorProps {
  verification: KycVerification | null;
}

const KYC_STAGES: readonly KycStage[] = [
  KYC_STAGE.FRONT,
  KYC_STAGE.BACK,
  KYC_STAGE.SELFIE,
  KYC_STAGE.VALIDATING,
];

const KYC_STAGE_LABEL: Record<KycStage, string> = {
  [KYC_STAGE.FRONT]: "Frente",
  [KYC_STAGE.BACK]: "Reverso",
  [KYC_STAGE.SELFIE]: "Rostro",
  [KYC_STAGE.VALIDATING]: "Validando",
};

const KYC_STAGE_STATUS_LABEL: Record<KycStageStatus, string> = {
  [KYC_STAGE_STATUS.COMPLETED]: "completado",
  [KYC_STAGE_STATUS.CURRENT]: "actual",
  [KYC_STAGE_STATUS.PENDING]: "pendiente",
};

interface StageProgress {
  completedCount: number;
  currentStage: KycStage;
}

function getStageProgressFromImages(images: KycImageMetadata[]): StageProgress {
  const hasFront = hasDocumentSide(images, DOCUMENT_SIDE.FRONT);
  const hasBack = hasDocumentSide(images, DOCUMENT_SIDE.BACK);
  const hasCombined = hasDocumentSide(images, DOCUMENT_SIDE.COMBINED);
  const hasSelfie = getSelfieImage(images) !== null;

  if (hasSelfie) {
    return { completedCount: 3, currentStage: KYC_STAGE.VALIDATING };
  }

  if (hasFront && (hasBack || hasCombined)) {
    return { completedCount: 2, currentStage: KYC_STAGE.SELFIE };
  }

  if (hasFront || hasCombined) {
    return { completedCount: 1, currentStage: KYC_STAGE.BACK };
  }

  return { completedCount: 0, currentStage: KYC_STAGE.FRONT };
}

export function getKycStages(verification: KycVerification | null): KycStageState[] {
  const images = verification?.images ?? [];
  const status = verification?.status ?? KYC_STATUS.CREATED;

  let completedCount = 0;
  let currentStage: KycStage = KYC_STAGE.FRONT;

  if (isTerminalKycStatus(status)) {
    completedCount = KYC_STAGES.length;
  } else if (
    status === KYC_STATUS.SELFIE_UPLOADED ||
    status === KYC_STATUS.VALIDATING
  ) {
    completedCount = 3;
    currentStage = KYC_STAGE.VALIDATING;
  } else {
    const imageProgress = getStageProgressFromImages(images);
    completedCount = imageProgress.completedCount;
    currentStage = imageProgress.currentStage;
  }

  return KYC_STAGES.map((stage, index) => ({
    stage,
    status:
      index < completedCount
        ? KYC_STAGE_STATUS.COMPLETED
        : stage === currentStage
          ? KYC_STAGE_STATUS.CURRENT
          : KYC_STAGE_STATUS.PENDING,
  }));
}

function getStageAccessibilityLabel(stageState: KycStageState, position: number): string {
  return `Paso ${position + 1} de 4: ${KYC_STAGE_LABEL[stageState.stage]}, ${KYC_STAGE_STATUS_LABEL[stageState.status]}`;
}

export function KycStepIndicator({ verification }: KycStepIndicatorProps): ReactNode {
  const stages = getKycStages(verification);

  return (
    <View style={styles.row} accessibilityLabel="Progreso de verificación de identidad">
      {stages.map((stageState, index) => (
        <View
          key={stageState.stage}
          accessible
          style={styles.item}
          accessibilityLabel={getStageAccessibilityLabel(stageState, index)}
        >
          <View
            style={[
             styles.segment,
              stageState.status === KYC_STAGE_STATUS.COMPLETED
                 ? styles.segmentCompleted
                : stageState.status === KYC_STAGE_STATUS.CURRENT
                   ? styles.segmentCurrent
                   : styles.segmentPending,
            ]}
          >
            <Text style={styles.number}>{index + 1}</Text>
          </View>
          <Text
            style={[
              styles.label,
              stageState.status === KYC_STAGE_STATUS.COMPLETED
                ? styles.labelCompleted
                : stageState.status === KYC_STAGE_STATUS.CURRENT
                  ? styles.labelCurrent
                  : styles.labelPending,
            ]}
          >
            {KYC_STAGE_LABEL[stageState.stage]}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
   gap: SPACING.xs,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: SPACING.xs,
  },
   segment: {
     width: "100%",
     height: 10,
     borderRadius: RADIUS.pill,
     borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
   segmentCompleted: {
    backgroundColor: COLORS.mint,
    borderColor: COLORS.mint,
  },
   segmentCurrent: {
     backgroundColor: COLORS.amber,
     borderColor: COLORS.amber,
  },
   segmentPending: {
     backgroundColor: COLORS.panelRaised,
    borderColor: COLORS.line,
  },
   number: {
     color: COLORS.ink,
     fontFamily: FONT.button,
     fontSize: 10,
  },
  label: {
    fontFamily: FONT.label,
    fontSize: 10,
    textAlign: "center",
  },
  labelCompleted: {
    color: COLORS.ink,
  },
  labelCurrent: {
    color: COLORS.ink,
  },
  labelPending: {
    color: COLORS.ink,
  },
});
