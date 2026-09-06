export const CAPTURE_PHASE = {
  IDLE: "idle",
  CAPTURING: "capturing",
  UPLOADING: "uploading",
} as const;

const MAX_CAPTURE_PIXELS = 12_000_000;
const MIN_CAPTURE_SHORT_SIDE = 480;

interface PictureSizeCandidate {
  pictureSize: string;
  pixels: number;
  isFourByThree: boolean;
}

export type CapturePhase = (typeof CAPTURE_PHASE)[keyof typeof CAPTURE_PHASE];

interface CameraRetryState {
  cameraInstanceKey: number;
  isCameraReady: boolean;
  cameraMountError: boolean;
  error: string | null;
}

export function getCameraRetryState(cameraInstanceKey: number): CameraRetryState {
  return {
    cameraInstanceKey: cameraInstanceKey + 1,
    isCameraReady: false,
    cameraMountError: false,
    error: null,
  };
}

export function shouldStartPictureSizeResolution(
  resolutionStartedForCameraKey: number | null,
  cameraInstanceKey: number,
): boolean {
  return resolutionStartedForCameraKey !== cameraInstanceKey;
}

export function canCapturePhoto(
  isCameraReady: boolean,
  isPictureSizeResolved: boolean,
  phase: CapturePhase,
): boolean {
  return isCameraReady && isPictureSizeResolved && phase === CAPTURE_PHASE.IDLE;
}

export function canStartCapture(
  isCaptureInProgress: boolean,
  isCameraReady: boolean,
  isPictureSizeResolved: boolean,
  phase: CapturePhase,
): boolean {
  return (
    !isCaptureInProgress && canCapturePhoto(isCameraReady, isPictureSizeResolved, phase)
  );
}

function parsePictureSize(pictureSize: string): PictureSizeCandidate | null {
  const match = /^(\d+)x(\d+)$/i.exec(pictureSize.trim());
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    pictureSize: pictureSize.trim(),
    pixels,
    isFourByThree: width * 3 === height * 4 || width * 4 === height * 3,
  };
}

export function selectSafePictureSize(availableSizes: readonly string[]): string | null {
  const candidates = availableSizes
    .map(parsePictureSize)
    .filter((candidate): candidate is PictureSizeCandidate => candidate !== null && candidate.pixels <= MAX_CAPTURE_PIXELS)
    .sort((first, second) => {
      if (first.isFourByThree !== second.isFourByThree) {
        return first.isFourByThree ? -1 : 1;
      }
      if (first.pixels !== second.pixels) {
        return second.pixels - first.pixels;
      }
      return first.pictureSize.localeCompare(second.pictureSize);
    });

  return candidates[0]?.pictureSize ?? null;
}

export function getCapturedPhotoUri(photo: unknown): string | null {
  if (
    typeof photo !== "object" ||
    photo === null ||
    !("uri" in photo) ||
    !("width" in photo) ||
    !("height" in photo)
  ) {
    return null;
  }

  const { uri, width, height } = photo;
  if (typeof uri !== "string") {
    return null;
  }

  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < MIN_CAPTURE_SHORT_SIDE ||
    height < MIN_CAPTURE_SHORT_SIDE
  ) {
    return null;
  }

  const normalizedUri = uri.trim();
  return normalizedUri ? normalizedUri : null;
}
