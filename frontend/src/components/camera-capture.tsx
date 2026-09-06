import { useRef, useState, type ReactNode } from "react";
import {
  CameraView,
  useCameraPermissions,
  type CameraMountError,
  type CameraType,
} from "expo-camera";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PrimaryButton, BUTTON_VARIANT } from "./primary-button";
import { ScreenShell } from "./screen-shell";
import {
  API_ERROR_KIND,
  ApiRequestError,
  getApiRequestLogMetadata,
  getSafeErrorName,
  type ApiErrorKind,
} from "../services/api-client";
import { COLORS, FONT, RADIUS, SPACING } from "../theme/theme";
import {
  canCapturePhoto,
  canStartCapture,
  CAPTURE_PHASE,
  getCameraRetryState,
  getCapturedPhotoUri,
  selectSafePictureSize,
  shouldStartPictureSizeResolution,
  type CapturePhase,
} from "./camera-capture-logic";

const CAMERA_EVENT = {
  READY: "camera_ready",
  MOUNT_FAILED: "camera_mount_failed",
  RETRY_REQUESTED: "camera_retry_requested",
  CAPTURE_STARTED: "capture_started",
  CAPTURE_FAILED: "capture_failed",
  UPLOAD_FAILED: "upload_failed",
} as const;

type CameraEvent = (typeof CAMERA_EVENT)[keyof typeof CAMERA_EVENT];

interface CameraLogMetadata {
  facing?: CameraType;
  frameShape?: CameraCaptureProps["frameShape"];
  reason?: string;
  kind?: ApiErrorKind;
  method?: string;
  endpoint?: string;
  status?: number;
  errorName?: string;
}

interface CameraCaptureProps {
  step: string;
  title: string;
  instruction: string;
  detail: string;
  facing: CameraType;
  frameShape: "document" | "selfie";
  onCapture(uri: string): Promise<void>;
  onCancel(): void;
  indicator?: ReactNode;
}

function logCameraEvent(event: CameraEvent, metadata: CameraLogMetadata = {}): void {
  const message = `[Kora] ${event}`;
  if (
    event === CAMERA_EVENT.CAPTURE_FAILED ||
    event === CAMERA_EVENT.UPLOAD_FAILED ||
    event === CAMERA_EVENT.MOUNT_FAILED
  ) {
    console.warn(message, metadata);
    return;
  }

  console.info(message, metadata);
}

async function capturePhoto(camera: CameraView): Promise<string | null> {
  const photo: unknown = await camera.takePictureAsync({
    quality: 0.84,
    exif: false,
    base64: false,
  });

  return getCapturedPhotoUri(photo);
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.kind === API_ERROR_KIND.NETWORK) {
      return "No se pudo conectar con el servicio de verificación. Revise su conexión e inténtelo de nuevo.";
    }

    return error.message;
  }

  return "No se pudo cargar la fotografía. Inténtelo de nuevo.";
}

export function CameraCapture({
  step,
  title,
  instruction,
  detail,
  facing,
  frameShape,
  onCapture,
  onCancel,
  indicator,
}: CameraCaptureProps): ReactNode {
  const cameraReference = useRef<CameraView | null>(null);
  const captureInProgressRef = useRef(false);
  const pictureSizeResolutionStartedForKey = useRef<number | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraInstanceKey, setCameraInstanceKey] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | null>(null);
  const [pictureSizeResolved, setPictureSizeResolved] = useState(false);
  const [cameraMountError, setCameraMountError] = useState(false);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>(CAPTURE_PHASE.IDLE);
  const [error, setError] = useState<string | null>(null);

  async function takePhoto(): Promise<void> {
    const camera = cameraReference.current;
    if (!camera || !canStartCapture(captureInProgressRef.current, isCameraReady, pictureSizeResolved, capturePhase)) {
      return;
    }

    // Synchronous guard: the React state phase updates asynchronously, so two
    // rapid presses could both pass the state-based check. The ref is set
    // before the first await and cleared on every exit path (see finally).
    captureInProgressRef.current = true;
    setError(null);
    setCapturePhase(CAPTURE_PHASE.CAPTURING);
    logCameraEvent(CAMERA_EVENT.CAPTURE_STARTED, { facing, frameShape });

    try {
      let capturedUri: string | null;
      try {
        capturedUri = await capturePhoto(camera);
      } catch (captureError: unknown) {
        logCameraEvent(CAMERA_EVENT.CAPTURE_FAILED, {
          reason: "camera_error",
          errorName: getSafeErrorName(captureError),
        });
        setError("No se pudo capturar la fotografía. Verifique la cámara e inténtelo de nuevo.");
        return;
      }

      if (!capturedUri) {
        logCameraEvent(CAMERA_EVENT.CAPTURE_FAILED, {
          reason: "missing_uri",
          errorName: "InvalidCaptureResult",
        });
        setError("La cámara no devolvió una imagen válida. Ajuste el encuadre e inténtelo de nuevo.");
        return;
      }

      setCapturePhase(CAPTURE_PHASE.UPLOADING);
      try {
        await onCapture(capturedUri);
      } catch (uploadError: unknown) {
        const apiErrorMetadata = getApiRequestLogMetadata(uploadError);
        logCameraEvent(CAMERA_EVENT.UPLOAD_FAILED, {
          ...(apiErrorMetadata ?? {
            reason: "upload_error",
            errorName: getSafeErrorName(uploadError),
          }),
        });
        setError(getUploadErrorMessage(uploadError));
      }
    } finally {
      captureInProgressRef.current = false;
      setCapturePhase(CAPTURE_PHASE.IDLE);
    }
  }

  async function resolvePictureSize(camera: CameraView): Promise<void> {
    try {
      const selectedPictureSize = selectSafePictureSize(await camera.getAvailablePictureSizesAsync());
      if (cameraReference.current !== camera) {
        return;
      }

      setPictureSize((currentPictureSize) =>
        currentPictureSize === selectedPictureSize ? currentPictureSize : selectedPictureSize,
      );
      setPictureSizeResolved(true);
      setIsCameraReady(selectedPictureSize !== null);
      if (!selectedPictureSize) {
        setError("La cámara no ofrece una resolución segura. Use otro dispositivo o una cámara diferente.");
        return;
      }

      setCameraMountError(false);
      setError(null);
      logCameraEvent(CAMERA_EVENT.READY, { facing, frameShape });
    } catch (pictureSizeError: unknown) {
      if (cameraReference.current !== camera) {
        return;
      }

      setPictureSize(null);
      setPictureSizeResolved(true);
      setIsCameraReady(false);
      setError("No se pudo confirmar una resolución segura. Reintente la cámara o use otro dispositivo.");
      logCameraEvent(CAMERA_EVENT.CAPTURE_FAILED, {
        reason: "picture_size_unavailable",
        errorName: getSafeErrorName(pictureSizeError),
      });
    }
  }

  function handleCameraReady(): void {
    const camera = cameraReference.current;
    if (
      !camera ||
      !shouldStartPictureSizeResolution(pictureSizeResolutionStartedForKey.current, cameraInstanceKey)
    ) {
      return;
    }

    pictureSizeResolutionStartedForKey.current = cameraInstanceKey;
    setIsCameraReady(false);
    setPictureSizeResolved(false);
    setCameraMountError(false);
    void resolvePictureSize(camera);
  }

  function handleMountError(_event: CameraMountError): void {
    setIsCameraReady(false);
    setCameraMountError(true);
    setError("No se pudo iniciar la cámara. Verifique los permisos e inténtelo de nuevo.");
    logCameraEvent(CAMERA_EVENT.MOUNT_FAILED, { errorName: "CameraMountError" });
  }

  function handleRetryCamera(): void {
    if (capturePhase !== CAPTURE_PHASE.IDLE) {
      return;
    }

    const retryState = getCameraRetryState(cameraInstanceKey);
    cameraReference.current = null;
    pictureSizeResolutionStartedForKey.current = null;
    setCameraInstanceKey(retryState.cameraInstanceKey);
    setIsCameraReady(retryState.isCameraReady);
    setPictureSize(null);
    setPictureSizeResolved(false);
    setCameraMountError(retryState.cameraMountError);
    setError(retryState.error);
    logCameraEvent(CAMERA_EVENT.RETRY_REQUESTED, { facing, frameShape });
  }

  const canTakePhoto = canCapturePhoto(isCameraReady, pictureSizeResolved, capturePhase);

  if (!permission) {
    return (
      <ScreenShell scroll={false}>
        <View style={styles.permissionState} accessibilityRole="progressbar">
          <ActivityIndicator color={COLORS.mint} size="large" />
          <Text style={styles.permissionCopy}>Comprobando el acceso a la cámara…</Text>
        </View>
      </ScreenShell>
    );
  }

  if (!permission.granted) {
    return (
      <ScreenShell>
        <View style={styles.permissionState}>
          <Text style={styles.step}>{step}</Text>
          <Text style={styles.permissionTitle}>Se requiere acceso a la cámara.</Text>
          <Text style={styles.permissionCopy}>
            Kora solo utiliza la cámara para capturar el documento y la fotografía del rostro que elija enviar.
          </Text>
          <PrimaryButton label="Permitir acceso a la cámara" onPress={async () => { await requestPermission(); }} />
          <PrimaryButton label="Cancelar" onPress={onCancel} variant={BUTTON_VARIANT.GHOST} />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell scroll={false}>
      <View style={styles.content}>
        {indicator}
        <View style={styles.topCopy}>
          <Text style={styles.step}>{step}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.instruction}>{instruction}</Text>
        </View>

        <View style={styles.cameraContainer}>
          <CameraView
            key={cameraInstanceKey}
            ref={cameraReference}
            style={styles.camera}
            facing={facing}
            mirror={facing === "front"}
            pictureSize={pictureSize ?? undefined}
            onCameraReady={handleCameraReady}
            onMountError={handleMountError}
          />
          <View
            pointerEvents="none"
            style={[styles.captureFrame, frameShape === "selfie" ? styles.selfieFrame : styles.documentFrame]}
          >
            {frameShape === "document" ? <View style={styles.documentFrameInner} /> : null}
          </View>
        </View>

        <View
          accessible
          style={styles.cameraStatus}
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            isCameraReady
              ? "Cámara lista para capturar."
              : cameraMountError
                ? "La cámara no está disponible."
                : pictureSizeResolved
                  ? "No hay una resolución segura disponible."
                : "Preparando la cámara."
          }
        >
          {isCameraReady ? (
            <Text style={styles.cameraReadyCopy}>Cámara lista para capturar.</Text>
          ) : cameraMountError ? (
            <Text style={styles.cameraUnavailableCopy}>La cámara no está disponible.</Text>
          ) : pictureSizeResolved ? (
            <Text style={styles.cameraUnavailableCopy}>No hay una resolución segura disponible.</Text>
          ) : (
            <>
              <ActivityIndicator color={COLORS.mint} />
              <Text style={styles.cameraPreparingCopy}>Preparando la cámara…</Text>
            </>
          )}
        </View>

        <Text style={styles.detail}>{detail}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          {cameraMountError ? (
            <PrimaryButton
              label="Reintentar cámara"
              onPress={handleRetryCamera}
              variant={BUTTON_VARIANT.SECONDARY}
              disabled={capturePhase !== CAPTURE_PHASE.IDLE}
              accessibilityHint="Vuelve a iniciar la cámara"
            />
          ) : null}
          <PrimaryButton
            label={
              capturePhase === CAPTURE_PHASE.CAPTURING
                ? "Capturando fotografía"
                : capturePhase === CAPTURE_PHASE.UPLOADING
                  ? "Cargando fotografía"
                  : "Tomar fotografía"
            }
            onPress={takePhoto}
            disabled={!canTakePhoto}
            accessibilityHint={
              isCameraReady
                ? "Toma y carga la imagen mostrada por la cámara"
                : "Espere a que la cámara confirme una resolución segura para tomar la fotografía"
            }
          />
          <PrimaryButton
            label="Cancelar"
            onPress={onCancel}
            variant={BUTTON_VARIANT.GHOST}
            disabled={capturePhase !== CAPTURE_PHASE.IDLE}
          />
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: SPACING.md,
  },
  topCopy: {
    gap: SPACING.xs,
  },
  step: {
    color: COLORS.mintDark,
    fontFamily: FONT.label,
    fontSize: 11,
    letterSpacing: 1.3,
  },
  title: {
    color: COLORS.ink,
    fontFamily: FONT.display,
    fontSize: 31,
    lineHeight: 36,
  },
  instruction: {
    color: COLORS.ink,
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 21,
  },
  cameraContainer: {
    flex: 1,
    minHeight: 300,
    overflow: "hidden",
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.deep,
  },
  camera: {
    flex: 1,
  },
  captureFrame: {
    position: "absolute",
    alignSelf: "center",
    top: "18%",
    borderWidth: 2,
    borderColor: COLORS.mint,
    backgroundColor: COLORS.transparent,
  },
  documentFrame: {
    width: "82%",
    aspectRatio: 1.58,
    borderRadius: RADIUS.md,
  },
  documentFrameInner: {
    flex: 1,
    margin: 12,
    borderWidth: 1,
    borderColor: COLORS.mintSoft,
    borderRadius: RADIUS.sm,
    opacity: 0.55,
  },
  selfieFrame: {
    width: "64%",
    aspectRatio: 0.8,
    borderRadius: RADIUS.pill,
  },
  cameraStatus: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.line,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  cameraReadyCopy: {
    color: COLORS.mint,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  cameraPreparingCopy: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  cameraUnavailableCopy: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  detail: {
    color: COLORS.muted,
    fontFamily: FONT.body,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    backgroundColor: COLORS.ink,
    borderRadius: RADIUS.lg,
    gap: SPACING.xs,
    padding: SPACING.sm,
  },
  error: {
    color: COLORS.coral,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  permissionState: {
    flex: 1,
    justifyContent: "center",
    gap: SPACING.md,
  },
  permissionTitle: {
    color: COLORS.ink,
    fontFamily: FONT.display,
    fontSize: 34,
    lineHeight: 39,
  },
  permissionCopy: {
    color: COLORS.ink,
    fontFamily: FONT.body,
    fontSize: 16,
    lineHeight: 24,
  },
});
