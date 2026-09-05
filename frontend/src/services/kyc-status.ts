import {
  KYC_PROCESSING_FAILURE,
  KYC_STATUS,
  DOCUMENT_CHECK_RESULT,
  type DocumentCheckResult,
  type KycStatus,
} from "../types/api";

export { KYC_STATUS } from "../types/api";

export const KYC_STATUS_TONE = {
  NEUTRAL: "neutral",
  PENDING: "pending",
  SUCCESS: "success",
  DANGER: "danger",
  REVIEW: "review",
} as const;

export type KycStatusTone = (typeof KYC_STATUS_TONE)[keyof typeof KYC_STATUS_TONE];

export interface KycStatusPresentation {
  label: string;
  description: string;
  tone: KycStatusTone;
}

const STATUS_PRESENTATIONS: Record<KycStatus, KycStatusPresentation> = {
  [KYC_STATUS.CREATED]: {
    label: "Lista para comenzar",
    description: "Capture su documento de identidad colombiano para continuar.",
    tone: KYC_STATUS_TONE.NEUTRAL,
  },
  [KYC_STATUS.DOCUMENT_UPLOADED]: {
    label: "Documento guardado",
    description: "Ahora tome una fotografía clara de su rostro con buena iluminación.",
    tone: KYC_STATUS_TONE.PENDING,
  },
  [KYC_STATUS.SELFIE_UPLOADED]: {
    label: "Lista para validar",
    description: "Sus fotografías están listas para la verificación local.",
    tone: KYC_STATUS_TONE.PENDING,
  },
  [KYC_STATUS.VALIDATING]: {
    label: "Verificación en curso",
    description: "Kora está procesando sus imágenes en el servicio privado de verificación.",
    tone: KYC_STATUS_TONE.PENDING,
  },
  [KYC_STATUS.APPROVED]: {
    label: "Identidad verificada",
    description: "El documento y la fotografía enviados superaron las comprobaciones locales.",
    tone: KYC_STATUS_TONE.SUCCESS,
  },
  [KYC_STATUS.REJECTED]: {
    label: "Verificación no aprobada",
    description: "Las imágenes enviadas no superaron esta comprobación. Puede iniciar un nuevo intento.",
    tone: KYC_STATUS_TONE.DANGER,
  },
  [KYC_STATUS.NEEDS_REVIEW]: {
    label: "La captura requiere revisión",
    description: "Kora no pudo completar con seguridad una decisión automatizada a partir de estas imágenes.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_STATUS.PROCESSING_FAILED]: {
    label: "No fue posible concluir la verificación",
    description: "La verificación no pudo concluir de forma segura. Puede iniciar una nueva verificación cuando esté preparado.",
    tone: KYC_STATUS_TONE.DANGER,
  },
};

const QUOTA_EXHAUSTED_PRESENTATION: KycStatusPresentation = {
  label: "Verificación documental temporalmente no disponible",
  description:
    "La verificación documental está temporalmente no disponible. Puede intentarlo más tarde.",
  tone: KYC_STATUS_TONE.DANGER,
};

const CEDULA_VERDICT_PRESENTATIONS: Record<
  DocumentCheckResult,
  Pick<KycStatusPresentation, "label" | "tone">
> = {
  [DOCUMENT_CHECK_RESULT.VALID]: {
    label: "Documento de cédula válido",
    tone: KYC_STATUS_TONE.SUCCESS,
  },
  [DOCUMENT_CHECK_RESULT.REVIEW]: {
    label: "Requiere revisión",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [DOCUMENT_CHECK_RESULT.REJECT]: {
    label: "No es una cédula válida",
    tone: KYC_STATUS_TONE.DANGER,
  },
};

const NO_CEDULA_DATA_PRESENTATION: Pick<KycStatusPresentation, "label" | "tone"> = {
  label: "Sin datos de cédula",
  tone: KYC_STATUS_TONE.NEUTRAL,
};

export function getKycStatusPresentation(
  status: KycStatus,
  reasonCode: string | null = null,
): KycStatusPresentation {
  if (
    status === KYC_STATUS.PROCESSING_FAILED &&
    reasonCode === KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED
  ) {
    return QUOTA_EXHAUSTED_PRESENTATION;
  }

  return STATUS_PRESENTATIONS[status];
}

export function formatFaceSimilarity(similarity: number | null): string | null {
  if (similarity === null || typeof similarity !== "number" || !Number.isFinite(similarity)) {
    return null;
  }

  const percentage = Math.min(100, Math.max(0, Math.round(similarity * 100)));
  return `${percentage}%`;
}

export function getCedulaVerdictPresentation(
  checkResult: DocumentCheckResult | null,
): Pick<KycStatusPresentation, "label" | "tone"> {
  if (checkResult === null) {
    return NO_CEDULA_DATA_PRESENTATION;
  }

  return CEDULA_VERDICT_PRESENTATIONS[checkResult];
}
