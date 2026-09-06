import { useState, type ReactNode } from "react";
import { CameraCapture } from "../components/camera-capture";
import { KycStepIndicator } from "../components/kyc-step-indicator";
import { StepSuccessModal } from "../components/step-success-modal";
import { useKyc } from "../contexts/kyc-context";
import { APP_ROUTE, type AppScreenProps } from "../navigation/routes";

export function SelfieScreen({ navigation }: AppScreenProps<typeof APP_ROUTE.SELFIE>): ReactNode {
  const { verification, uploadSelfieCandidates } = useKyc();
  const [isSuccessVisible, setIsSuccessVisible] = useState(false);

  async function handleCaptureCandidates(uris: string[]): Promise<void> {
    await uploadSelfieCandidates(uris);
    setIsSuccessVisible(true);
  }

  function handleDismissSuccess(): void {
    setIsSuccessVisible(false);
    navigation.navigate(APP_ROUTE.KYC_PROCESSING_RESULT);
  }

  return (
    <>
      <CameraCapture
        step="VERIFICACIÓN DE IDENTIDAD / PASO 03"
        title="Tome una fotografía clara"
        instruction="Use la cámara frontal. Cara centrada y de frente, sin segunda persona, mirada a cámara."
        detail="Use una iluminación uniforme. Kora no realiza comprobaciones de vida ni ofrece garantías de seguridad biométrica."
        facing="front"
        frameShape="selfie"
        onCapture={() => Promise.resolve()}
        onCaptureCandidates={handleCaptureCandidates}
        captureCount={3}
        onCancel={() => navigation.navigate(APP_ROUTE.HOME)}
        indicator={<KycStepIndicator verification={verification} />}
      />
      <StepSuccessModal
        visible={isSuccessVisible}
        title="Foto del rostro guardada"
        message="Siguiente paso: validación de identidad"
        onDismiss={handleDismissSuccess}
      />
    </>
  );
}
