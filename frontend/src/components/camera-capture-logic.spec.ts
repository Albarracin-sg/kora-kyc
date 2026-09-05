import {
  canCapturePhoto,
  canStartCapture,
  CAPTURE_PHASE,
  getCameraRetryState,
  getCapturedPhotoUri,
  selectSafePictureSize,
  shouldStartPictureSizeResolution,
} from "./camera-capture-logic";

describe("camera capture safeguards", () => {
  it("does not allow capture until readiness and resolution are confirmed", () => {
    expect(canCapturePhoto(false, false, CAPTURE_PHASE.IDLE)).toBe(false);
    expect(canCapturePhoto(true, false, CAPTURE_PHASE.IDLE)).toBe(false);
    expect(canCapturePhoto(true, true, CAPTURE_PHASE.CAPTURING)).toBe(false);
    expect(canCapturePhoto(true, true, CAPTURE_PHASE.UPLOADING)).toBe(false);
    expect(canCapturePhoto(true, true, CAPTURE_PHASE.IDLE)).toBe(true);
  });

  it("blocks a capture while another capture is already in progress", () => {
    expect(canStartCapture(true, true, true, CAPTURE_PHASE.IDLE)).toBe(false);
    expect(canStartCapture(false, true, true, CAPTURE_PHASE.IDLE)).toBe(true);
    expect(canStartCapture(false, false, true, CAPTURE_PHASE.IDLE)).toBe(false);
    expect(canStartCapture(false, true, true, CAPTURE_PHASE.UPLOADING)).toBe(false);
  });

  it("resets camera readiness and errors before a controlled remount", () => {
    const retryState = getCameraRetryState(2);

    expect(retryState).toEqual({
      cameraInstanceKey: 3,
      isCameraReady: false,
      cameraMountError: false,
      error: null,
    });
    expect(canCapturePhoto(retryState.isCameraReady, false, CAPTURE_PHASE.IDLE)).toBe(false);
  });

  it("resolves the picture size only once for each camera mount", () => {
    expect(shouldStartPictureSizeResolution(null, 0)).toBe(true);
    expect(shouldStartPictureSizeResolution(0, 0)).toBe(false);
    expect(shouldStartPictureSizeResolution(0, 1)).toBe(true);
  });

  it("rejects capture results without a usable URI", () => {
    expect(getCapturedPhotoUri(undefined)).toBeNull();
    expect(getCapturedPhotoUri(null)).toBeNull();
    expect(getCapturedPhotoUri({ uri: "" })).toBeNull();
    expect(getCapturedPhotoUri({ uri: "   " })).toBeNull();
    expect(getCapturedPhotoUri({ uri: 123 })).toBeNull();
  });

  it("normalizes a valid capture URI without logging or copying image data", () => {
    expect(getCapturedPhotoUri({ uri: "  file://capture-placeholder.jpg  " })).toBe(
      "file://capture-placeholder.jpg",
    );
  });

  it("selects the largest safe 4:3 picture size deterministically", () => {
    expect(selectSafePictureSize(["4032x3024", "1920x1080", "2048x1536", "1600x1200"])).toBe(
      "2048x1536",
    );
  });

  it("uses the largest listed safe size when no safe 4:3 size is available", () => {
    expect(selectSafePictureSize(["3840x2160", "2560x1440", "1280x720"])).toBe("3840x2160");
  });

  it("rejects malformed, unlisted-equivalent, and oversized picture sizes", () => {
    expect(selectSafePictureSize(["4032x3024", "not-a-size", "0x1200"])).toBeNull();
  });
});
