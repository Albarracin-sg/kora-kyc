import {
  getFaceMatchPresentation,
  KYC_STATUS,
  formatFaceSimilarity,
  getCedulaVerdictPresentation,
  getKycStatusPresentation,
} from "./kyc-status";
import {
  KYC_FACE_CAPTURE_FAILURE,
  KYC_FACE_COMPARISON_REASON,
  DOCUMENT_CHECK_RESULT,
  KYC_PROCESSING_FAILURE,
} from "../types/api";

describe("getKycStatusPresentation", () => {
  it("keeps validation visibly in progress", () => {
    expect(getKycStatusPresentation(KYC_STATUS.VALIDATING).tone).toBe("pending");
  });

  it("does not treat failed processing as approved", () => {
    expect(getKycStatusPresentation(KYC_STATUS.PROCESSING_FAILED).tone).toBe("danger");
  });

  it("presents a neutral retry-later explanation for document provider quota exhaustion", () => {
    expect(
      getKycStatusPresentation(
        KYC_STATUS.PROCESSING_FAILED,
        KYC_PROCESSING_FAILURE.DOCUMENT_PROVIDER_QUOTA_EXHAUSTED,
      ),
    ).toEqual({
      label: "Verificación documental temporalmente no disponible",
      description:
        "La verificación documental está temporalmente no disponible. Puede intentarlo más tarde.",
      tone: "danger",
    });
  });

  it("explains a document quality failure with a recovery action", () => {
    expect(
      getKycStatusPresentation(
        KYC_STATUS.NEEDS_REVIEW,
        KYC_FACE_CAPTURE_FAILURE.QUALITY_DOCUMENT_BLURRY,
      ),
    ).toEqual({
      label: "Necesitamos una nueva foto",
      description:
        "La imagen del documento está borrosa. Tome una nueva foto sin movimiento y con buena iluminación.",
      tone: "review",
    });
  });

  it("keeps unknown review reasons on the generic safe copy", () => {
    expect(getKycStatusPresentation(KYC_STATUS.NEEDS_REVIEW, "UNSAFE_PROVIDER_REASON")).toEqual({
      label: "La captura requiere revisión",
      description:
        "Kora no pudo completar con seguridad una decisión automatizada a partir de estas imágenes.",
      tone: "review",
    });
  });
});

describe("formatFaceSimilarity", () => {
  it("rounds a ratio to a whole percentage", () => {
    expect(formatFaceSimilarity(0.9234)).toBe("92%");
    expect(formatFaceSimilarity(0.9996)).toBe("100%");
  });

  it("handles the boundary values zero and one", () => {
    expect(formatFaceSimilarity(0)).toBe("0%");
    expect(formatFaceSimilarity(1)).toBe("100%");
  });

  it("clamps out-of-range ratios", () => {
    expect(formatFaceSimilarity(1.5)).toBe("100%");
    expect(formatFaceSimilarity(-0.2)).toBe("0%");
  });

  it("returns null when the ratio is not usable", () => {
    expect(formatFaceSimilarity(null)).toBeNull();
    expect(formatFaceSimilarity(Number.NaN)).toBeNull();
    expect(formatFaceSimilarity(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("getCedulaVerdictPresentation", () => {
  it("presents a valid outcome as successful", () => {
    expect(getCedulaVerdictPresentation(DOCUMENT_CHECK_RESULT.VALID)).toEqual({
      label: "Documento de cédula válido",
      tone: "success",
    });
  });

  it("presents a review outcome as requiring review", () => {
    expect(getCedulaVerdictPresentation(DOCUMENT_CHECK_RESULT.REVIEW)).toEqual({
      label: "Requiere revisión",
      tone: "review",
    });
  });

  it("presents a rejected outcome as dangerous", () => {
    expect(getCedulaVerdictPresentation(DOCUMENT_CHECK_RESULT.REJECT)).toEqual({
      label: "No es una cédula válida",
      tone: "danger",
    });
  });

  it("presents missing data as neutral and explicit", () => {
    expect(getCedulaVerdictPresentation(null)).toEqual({
      label: "Sin datos de cédula",
      tone: "neutral",
    });
  });
});

describe("getFaceMatchPresentation", () => {
  it("describes an approved facial comparison", () => {
    expect(
      getFaceMatchPresentation(
        KYC_STATUS.APPROVED,
        KYC_FACE_COMPARISON_REASON.APPROVED,
        0.92,
      ),
    ).toEqual({
      description: "La coincidencia facial es suficiente para aprobar la verificación.",
      tone: "success",
    });
  });

  it("describes a rejected comparison without hiding its numeric similarity", () => {
    expect(
      getFaceMatchPresentation(
        KYC_STATUS.REJECTED,
        KYC_FACE_COMPARISON_REASON.BELOW_THRESHOLD,
        0.41,
      ),
    ).toEqual({
      description:
        "La coincidencia facial está por debajo del umbral requerido. La verificación no fue aprobada.",
      tone: "danger",
    });
  });

  it("returns no facial presentation for an invalid comparison", () => {
    expect(
      getFaceMatchPresentation(
        KYC_STATUS.NEEDS_REVIEW,
        "FACE_CAPTURE_INVALID_RESPONSE",
        null,
      ),
    ).toBeNull();
  });

  it("returns no facial presentation for an invalid comparison with a numeric similarity", () => {
    expect(
      getFaceMatchPresentation(
        KYC_STATUS.NEEDS_REVIEW,
        "FACE_CAPTURE_INVALID_RESPONSE",
        0.91,
      ),
    ).toBeNull();
  });
});
