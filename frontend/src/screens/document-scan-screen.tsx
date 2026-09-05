import { useState, type ReactNode } from "react";
import { CameraCapture } from "../components/camera-capture";
import { KycStepIndicator } from "../components/kyc-step-indicator";
import { StepSuccessModal } from "../components/step-success-modal";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";
import {
  DOCUMENT_SIDE,
  KYC_IMAGE_KIND,
  KYC_STATUS,
  type KycImageMetadata,
} from "../types/api";

function hasImageWithSide(images: KycImageMetadata[], side: string): boolean {
  return images.some(
    (image) => image.kind === KYC_IMAGE_KIND.DOCUMENT && image.side === side,
  );
}

export function DocumentScanScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.DOCUMENT_SCAN>): ReactNode {
  const { verification, uploadDocument } = useKyc();
  const [completedStep, setCompletedStep] = useState<"front" | "back" | null>(null);

  const images = verification?.images ?? [];
  const hasFront = hasImageWithSide(images, DOCUMENT_SIDE.FRONT);
  const hasBack = hasImageWithSide(images, DOCUMENT_SIDE.BACK);
  const hasCombined = hasImageWithSide(images, DOCUMENT_SIDE.COMBINED);

  const isBackCapture =
    verification?.status === KYC_STATUS.DOCUMENT_UPLOADED &&
    hasFront &&
    !hasBack &&
    !hasCombined;

  const successContent =
    completedStep === "front"
      ? { title: "Frente cargado", message: "Siguiente paso: reverso del documento" }
      : completedStep === "back"
        ? { title: "Reverso cargado", message: "Siguiente paso: foto del rostro" }
        : null;

  async function handleCapture(uri: string): Promise<void> {
    const side = isBackCapture ? DOCUMENT_SIDE.BACK : DOCUMENT_SIDE.FRONT;
    await uploadDocument(uri, side);
    setCompletedStep(side === DOCUMENT_SIDE.FRONT ? "front" : "back");
  }

  function handleDismissSuccess(): void {
    const step = completedStep;
    setCompletedStep(null);
    if (step === "front") {
      navigation.navigate(APP_ROUTE.DOCUMENT_SCAN);
    } else {
      navigation.navigate(APP_ROUTE.SELFIE);
    }
  }

  return (
    <>
      <CameraCapture
        step="VERIFICACIÓN DE IDENTIDAD / PASO 02"
        title={isBackCapture ? "Capture el reverso de la cédula" : "Capture el frente de la cédula"}
        instruction={
          isBackCapture
            ? "Use la cámara trasera. Coloque el reverso de la cédula dentro del marco, centrado y apoyado."
            : "Use la cámara trasera. Coloque la cédula dentro del marco, plana y apoyada, llenando todo el encuadre."
        }
        detail="Busque luz pareja y evite reflejos y sombras. No se aceptan archivos PDF."
        facing="back"
        frameShape="document"
        onCapture={handleCapture}
        onCancel={() => navigation.navigate(APP_ROUTE.HOME)}
        indicator={<KycStepIndicator verification={verification} />}
      />
      <StepSuccessModal
        visible={completedStep !== null}
        title={successContent?.title ?? ""}
        message={successContent?.message ?? ""}
        onDismiss={handleDismissSuccess}
      />
    </>
  );
}