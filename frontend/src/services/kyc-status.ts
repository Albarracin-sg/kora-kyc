import {
  KYC_FACE_CAPTURE_FAILURE,
  KYC_FACE_COMPARISON_REASON,
  KYC_PROCESSING_FAILURE,
  KYC_STATUS,
  DOCUMENT_CHECK_RESULT,
  type DocumentCheckResult,
  type KycFaceCaptureFailure,
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

export interface KycFaceMatchPresentation {
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

const NON_CEDULA_PRESENTATIONS: Record<string, KycStatusPresentation> = {
  DOCUMENT_TYPE_NOT_RECOGNIZED: {
    label: "Lo que subiste no es una cédula",
    description: "La imagen no corresponde claramente a una cédula colombiana. Sube el frente de tu cédula para continuar.",
    tone: KYC_STATUS_TONE.DANGER,
  },
  DOCUMENT_UNSUPPORTED: {
    label: "Lo que subiste no es una cédula",
    description: "El documento enviado no es compatible con la verificación de cédula colombiana.",
    tone: KYC_STATUS_TONE.DANGER,
  },
  UNSUPPORTED_DOCUMENT_TYPE: {
    label: "Lo que subiste no es una cédula",
    description: "El documento enviado no parece ser una cédula colombiana.",
    tone: KYC_STATUS_TONE.DANGER,
  },
  AMBIGUOUS_DOCUMENT_TYPE: {
    label: "No pudimos identificar la cédula",
    description: "La imagen no permite confirmar que sea una cédula colombiana. Sube una foto frontal más clara.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
};

const FACE_CAPTURE_QUALITY_PRESENTATIONS: Record<
  KycFaceCaptureFailure,
  KycStatusPresentation
> = {
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_NO_FACE]: {
    label: "Necesitamos una nueva foto",
    description:
      "No detectamos un rostro en la foto del documento. Tome una nueva foto del documento con el rostro visible y buena iluminación.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_FACE_RESOLUTION_TOO_SMALL]: {
    label: "Necesitamos una nueva foto",
    description:
      "El rostro de la foto del documento es demasiado pequeño. Tome una nueva foto en la que se vea con mayor claridad.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_BLURRY]: {
    label: "Necesitamos una nueva foto",
    description:
      "La imagen del documento está borrosa. Tome una nueva foto sin movimiento y con buena iluminación.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_ERROR]: {
    label: "Necesitamos una nueva foto",
    description:
      "No pudimos procesar la foto del documento. Tome una nueva foto clara para continuar.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_SELFIE_NO_FACE]: {
    label: "Necesitamos una nueva foto",
    description:
      "No detectamos un rostro en la selfie. Tome una nueva foto de su rostro con buena iluminación y una sola persona.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_SELFIE_FACE_RESOLUTION_TOO_SMALL]: {
    label: "Necesitamos una nueva foto",
    description:
      "El rostro de la selfie es demasiado pequeño. Tome una nueva foto acercándose un poco más a la cámara.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_SELFIE_BLURRY]: {
    label: "Necesitamos una nueva foto",
    description:
      "La selfie está borrosa. Tome una nueva foto sin movimiento y con buena iluminación.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
  [KYC_FACE_CAPTURE_FAILURE.QUALITY_SELFIE_ERROR]: {
    label: "Necesitamos una nueva foto",
    description:
      "No pudimos procesar la selfie. Tome una nueva foto clara para continuar.",
    tone: KYC_STATUS_TONE.REVIEW,
  },
};

const FACE_MATCH_PRESENTATIONS: Record<
  (typeof KYC_FACE_COMPARISON_REASON)[keyof typeof KYC_FACE_COMPARISON_REASON],
  KycFaceMatchPresentation
> = {
  [KYC_FACE_COMPARISON_REASON.APPROVED]: {
    description: "La coincidencia facial es suficiente para aprobar la verificación.",
    tone: KYC_STATUS_TONE.SUCCESS,
  },
  [KYC_FACE_COMPARISON_REASON.BELOW_THRESHOLD]: {
    description:
      "La coincidencia facial está por debajo del umbral requerido. La verificación no fue aprobada.",
    tone: KYC_STATUS_TONE.DANGER,
  },
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
  if (status === KYC_STATUS.NEEDS_REVIEW && isFaceCaptureQualityFailureReasonCode(reasonCode)) {
    return FACE_CAPTURE_QUALITY_PRESENTATIONS[reasonCode];
  }

  if (
    status === KYC_STATUS.PROCESSING_FAILED &&
    reasonCode === KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED
  ) {
    return QUOTA_EXHAUSTED_PRESENTATION;
  }

  if (reasonCode && NON_CEDULA_PRESENTATIONS[reasonCode]) {
    return NON_CEDULA_PRESENTATIONS[reasonCode];
  }

  return STATUS_PRESENTATIONS[status];
}

export function isFaceCaptureQualityFailureReasonCode(
  reasonCode: string | null,
): reasonCode is KycFaceCaptureFailure {
  return (
    typeof reasonCode === "string" &&
    Object.values(KYC_FACE_CAPTURE_FAILURE).some((code) => code === reasonCode)
  );
}

export function formatFaceSimilarity(similarity: number | null): string | null {
  if (similarity === null || typeof similarity !== "number" || !Number.isFinite(similarity)) {
    return null;
  }

  const percentage = Math.min(100, Math.max(0, Math.round(similarity * 100)));
  return `${percentage}%`;
}

export function getFaceMatchPresentation(
  status: KycStatus | null | undefined,
  reasonCode: string | null | undefined,
  similarity: number | null,
): KycFaceMatchPresentation | null {
  if (
    status === KYC_STATUS.APPROVED &&
    reasonCode === KYC_FACE_COMPARISON_REASON.APPROVED
  ) {
    return formatFaceSimilarity(similarity) === null
      ? null
      : FACE_MATCH_PRESENTATIONS[KYC_FACE_COMPARISON_REASON.APPROVED];
  }

  if (
    status === KYC_STATUS.REJECTED &&
    reasonCode === KYC_FACE_COMPARISON_REASON.BELOW_THRESHOLD
  ) {
    return formatFaceSimilarity(similarity) === null
      ? null
      : FACE_MATCH_PRESENTATIONS[KYC_FACE_COMPARISON_REASON.BELOW_THRESHOLD];
  }

  return null;
}

export function getCedulaVerdictPresentation(
  checkResult: DocumentCheckResult | null,
): Pick<KycStatusPresentation, "label" | "tone"> {
  if (checkResult === null) {
    return NO_CEDULA_DATA_PRESENTATION;
  }

  return CEDULA_VERDICT_PRESENTATIONS[checkResult];
}
