jest.mock("@nestjs/common", () => ({
  Injectable: () => (): void => undefined,
}));

jest.mock("@vladmandic/human", () => ({
  Human: jest.fn(),
}));

jest.mock("@tensorflow/tfjs-node", () => ({
  node: { decodeImage: jest.fn() },
  image: { resizeBilinear: jest.fn() },
}));

import {
  DOCUMENT_FACE_DETECTION,
  calculateUpscaledCropSize,
  clampPortraitBox,
  selectDocumentPortrait,
  type DetectedFaceLike,
} from "../src/kyc/providers/local-human-face-verification.provider";

interface SyntheticFace extends DetectedFaceLike {
  id: string;
}

function face(
  id: string,
  box: [number, number, number, number],
  boxScore: number,
): SyntheticFace {
  return { id, box, boxScore };
}

// Mirrors the controlled document photo (frontend/assets/cc/frontal.jpeg, 1200x1600):
// the real portrait is 95x94 px and the known giant artifact is [109,0,811,477].
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 1600;

describe("selectDocumentPortrait", () => {
  it("returns null when no face is detected", () => {
    expect(selectDocumentPortrait<SyntheticFace>([], IMAGE_WIDTH, IMAGE_HEIGHT)).toBeNull();
  });

  it("picks a small weak-scored portrait when it is the only plausible candidate", () => {
    const portrait = face("portrait", [1030, 701, 95, 94], 0.13);

    expect(selectDocumentPortrait([portrait], IMAGE_WIDTH, IMAGE_HEIGHT)).toBe(portrait);
  });

  it("rejects a giant artifact box covering more than 15% of the image", () => {
    const artifact = face("artifact", [109, 0, 811, 477], 0.11);
    const portrait = face("portrait", [1030, 701, 95, 94], 0.13);

    expect(selectDocumentPortrait([artifact, portrait], IMAGE_WIDTH, IMAGE_HEIGHT)).toBe(portrait);
  });

  it("rejects candidates whose short side is below the minimum plausible size", () => {
    const tiny = face("tiny", [600, 400, 18, 20], 0.9);
    const portrait = face("portrait", [1030, 701, 95, 94], 0.13);

    expect(selectDocumentPortrait([tiny, portrait], IMAGE_WIDTH, IMAGE_HEIGHT)).toBe(portrait);
  });

  it("returns null when every candidate is below the document confidence floor", () => {
    const weakPortrait = face("weak", [1030, 701, 95, 94], 0.09);

    expect(selectDocumentPortrait([weakPortrait], IMAGE_WIDTH, IMAGE_HEIGHT)).toBeNull();
  });

  it("returns null when the only plausible-looking box is fully outside the image", () => {
    const outside = face("outside", [-100, -100, 50, 50], 0.95);

    expect(selectDocumentPortrait([outside], IMAGE_WIDTH, IMAGE_HEIGHT)).toBeNull();
  });

  it("picks the highest-scoring plausible candidate, not the largest one", () => {
    const largerButLowerScore = face("larger", [400, 1100, 260, 220], 0.4);
    const smallerButHigherScore = face("better", [700, 900, 120, 130], 0.9);

    expect(
      selectDocumentPortrait([largerButLowerScore, smallerButHigherScore], IMAGE_WIDTH, IMAGE_HEIGHT),
    ).toBe(smallerButHigherScore);
  });
});

describe("clampPortraitBox", () => {
  it("keeps a fully in-bounds box unchanged", () => {
    expect(clampPortraitBox([100, 100, 200, 150], IMAGE_WIDTH, IMAGE_HEIGHT)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 150,
    });
  });

  it("returns null when the box has no in-bounds intersection", () => {
    expect(clampPortraitBox([1500, 1700, 100, 100], IMAGE_WIDTH, IMAGE_HEIGHT)).toBeNull();
  });
});

describe("calculateUpscaledCropSize", () => {
  it("upscales a small portrait so the short side reaches the embedding target", () => {
    const size = calculateUpscaledCropSize(95, 94);
    expect(size).not.toBeNull();
    expect(size).toEqual({ width: 162, height: 160 });
    expect(Math.min(size!.width, size!.height)).toBeGreaterThanOrEqual(
      DOCUMENT_FACE_DETECTION.embedTargetShortSide,
    );
  });

  it("keeps a larger portrait unchanged (no upscale needed)", () => {
    expect(calculateUpscaledCropSize(480, 360)).toEqual({ width: 480, height: 360 });
  });

  it("returns null for non-positive dimensions", () => {
    expect(calculateUpscaledCropSize(0, 100)).toBeNull();
    expect(calculateUpscaledCropSize(100, -5)).toBeNull();
  });
});