import { APP_ROUTE, type AppRoute } from "../navigation/routes";
import {
  DOCUMENT_SIDE,
  KYC_IMAGE_KIND,
  KYC_STATUS,
  type KycImageMetadata,
  type KycVerification,
} from "../types/api";

export function hasDocumentSide(images: KycImageMetadata[], side: string): boolean {
  return images.some(
    (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === side,
  );
}

export function getDocumentImages(images: KycImageMetadata[]): KycImageMetadata[] {
  const combined = images.find(
    (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === DOCUMENT_SIDE.COMBINED,
  );
  if (combined) {
    return [combined];
  }

  const front = images.find(
    (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === DOCUMENT_SIDE.FRONT,
  );
  const back = images.find(
    (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === DOCUMENT_SIDE.BACK,
  );

  return [...(front ? [front] : []), ...(back ? [back] : [])];
}

export function getSelfieImage(images: KycImageMetadata[]): KycImageMetadata | null {
  return images.find((image) => image.kind === KYC_IMAGE_KIND.SELFIE) ?? null;
}

export function isTerminalKycStatus(status: KycVerification["status"]): boolean {
  return (
    status === KYC_STATUS.APPROVED ||
    status === KYC_STATUS.REJECTED ||
    status === KYC_STATUS.NEEDS_REVIEW ||
    status === KYC_STATUS.PROCESSING_FAILED
  );
}

export function getKycRoute(verification: KycVerification | null): AppRoute {
  if (!verification) {
    return APP_ROUTE.START_KYC;
  }

  if (verification.status === KYC_STATUS.CREATED) {
    return APP_ROUTE.DOCUMENT_SCAN;
  }

  if (verification.status === KYC_STATUS.DOCUMENT_UPLOADED) {
    const hasFront = hasDocumentSide(verification.images, DOCUMENT_SIDE.FRONT);
    const hasBack = hasDocumentSide(verification.images, DOCUMENT_SIDE.BACK);
    const hasCombined = hasDocumentSide(verification.images, DOCUMENT_SIDE.COMBINED);

    if (!hasFront || (!hasBack && !hasCombined)) {
      return APP_ROUTE.DOCUMENT_SCAN;
    }

    return APP_ROUTE.SELFIE;
  }

  return APP_ROUTE.KYC_PROCESSING_RESULT;
}

export function getKycActionLabel(verification: KycVerification | null): string {
  if (!verification) {
    return "Comenzar verificación de identidad";
  }

  if (verification.status === KYC_STATUS.CREATED) {
    return "Capturar el frente del documento";
  }

  if (verification.status === KYC_STATUS.DOCUMENT_UPLOADED) {
    const hasFront = hasDocumentSide(verification.images, DOCUMENT_SIDE.FRONT);
    const hasBack = hasDocumentSide(verification.images, DOCUMENT_SIDE.BACK);
    const hasCombined = hasDocumentSide(verification.images, DOCUMENT_SIDE.COMBINED);

    if (!hasFront) {
      return "Capturar el frente del documento";
    }

    if (!hasBack && !hasCombined) {
      return "Capturar el reverso del documento";
    }

    return "Tomar fotografía del rostro";
  }

  return "Abrir verificación de identidad";
}
