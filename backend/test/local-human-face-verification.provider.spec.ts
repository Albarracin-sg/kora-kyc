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

import { Human } from "@vladmandic/human";
import * as tfjsModule from "@tensorflow/tfjs-node";
import { AppConfigService } from "../src/config/app-config.service";
import { KYC_DOCUMENT_PROVIDER, createAppConfiguration } from "../src/config/app-config.service";
import { AssetIntegrityService } from "../src/kyc/assets/asset-integrity.service";
import {
  FACE_CAPTURE_FAILURE_CODE,
  FACE_DETECTION_MODE,
  FaceCaptureError,
  LocalHumanFaceVerificationProvider,
  selectDominantFace,
  type FaceDetectionMode,
} from "../src/kyc/providers/local-human-face-verification.provider";
import type { FaceVerificationProvider } from "../src/kyc/providers/face-verification.provider";

const BASE_ENVIRONMENT: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://localhost:5432/kora",
  JWT_SECRET: "test-jwt-secret",
  KYC_DOCUMENT_HASH_PEPPER: "test-pepper",
  KYC_DOCUMENT_PROVIDER: KYC_DOCUMENT_PROVIDER.LOCAL,
};

// Mirrors the controlled document photo (frontend/assets/cc/frontal.jpeg, 1200x1600).
const IMAGE_SHAPE: readonly [number, number, number] = [1600, 1200, 3];
const IMAGE_WIDTH = IMAGE_SHAPE[1];
const IMAGE_HEIGHT = IMAGE_SHAPE[0];

interface MockFace {
  box: [number, number, number, number];
  boxScore: number;
  embedding: number[];
}

interface MockTensor {
  dispose: jest.Mock;
  shape: readonly number[];
  slice: jest.Mock;
}

function createFace(
  box: [number, number, number, number],
  boxScore: number,
  embedding: number[],
): MockFace {
  return { box, boxScore, embedding };
}

function createMockTensor(shape: readonly number[]): MockTensor {
  return {
    dispose: jest.fn(),
    shape,
    slice: jest.fn((_begin: readonly number[], size: readonly number[]) => createMockTensor(size)),
  };
}

function createFixture(): {
  provider: FaceVerificationProvider;
  humanDetect: jest.Mock;
  resizeBilinear: jest.Mock;
  inputTensor: MockTensor;
} {
  jest.clearAllMocks();
  const humanDetect = jest.fn();
  (Human as unknown as jest.Mock).mockImplementation(() => ({
    load: jest.fn().mockResolvedValue(undefined),
    detect: humanDetect,
  }));
  const decodeImage = (tfjsModule.node as unknown as { decodeImage: jest.Mock }).decodeImage;
  const inputTensor = createMockTensor(IMAGE_SHAPE);
  decodeImage.mockReturnValue(inputTensor);
  const resizeBilinear = (tfjsModule.image as unknown as { resizeBilinear: jest.Mock })
    .resizeBilinear;
  resizeBilinear.mockImplementation(
    (_images: unknown, size: readonly [number, number]) => createMockTensor([size[0], size[1], 3]),
  );

  const configuration = createAppConfiguration(BASE_ENVIRONMENT, process.cwd());
  const configService = { values: configuration } as unknown as AppConfigService;
  const assetIntegrityService = {
    ensureGroup: jest.fn().mockResolvedValue(undefined),
  } as unknown as AssetIntegrityService;

  const provider = new LocalHumanFaceVerificationProvider(
    configService,
    assetIntegrityService,
  );
  return { provider, humanDetect, resizeBilinear, inputTensor };
}

function expectFaceCaptureError(
  promise: Promise<unknown>,
  code: (typeof FACE_CAPTURE_FAILURE_CODE)[keyof typeof FACE_CAPTURE_FAILURE_CODE],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: "FaceCaptureError",
    code,
  } satisfies Partial<FaceCaptureError>);
}

const DOCUMENT_IMAGE = Buffer.from("synthetic-document-image");
const SELFIE_IMAGE = Buffer.from("synthetic-selfie-image");

// Document fixtures. [x, y, width, height] on a 1200x1600 image.
const STRONG_DOCUMENT_FACE = createFace([700, 900, 220, 240], 0.9, [0.5, 0.5]);
const SMALL_PORTRAIT = createFace([1030, 701, 95, 94], 0.13, [0.5, 0.5]);
const GIANT_ARTIFACT = createFace([109, 0, 811, 477], 0.11, [0.5, 0.5]);
const TINY_CANDIDATE = createFace([600, 400, 18, 20], 0.9, [0.5, 0.5]);
const SELFIE_FACE = createFace([200, 180, 320, 320], 0.98, [0.5, 0.5]);

describe("selectDominantFace", () => {
  it("returns null when no faces are detected", () => {
    expect(selectDominantFace<MockFace>([])).toBeNull();
  });

  it("picks the face with the largest box area regardless of order", () => {
    const secondary = createFace([120, 300, 320, 240], 0.9, [0.1, 0.9]);
    const dominant = createFace([120, 240, 480, 360], 0.95, [0.9, 0.1]);

    expect(selectDominantFace([secondary, dominant])).toBe(dominant);
    expect(selectDominantFace([dominant, secondary])).toBe(dominant);
  });

  it("breaks area ties by the highest box score", () => {
    const sameArea = createFace([0, 0, 200, 100], 0.8, [1, 0]);
    const sameAreaHigherScore = createFace([10, 10, 200, 100], 0.95, [0, 1]);

    expect(selectDominantFace([sameArea, sameAreaHigherScore])).toBe(sameAreaHigherScore);
  });
});

describe("Local face verification", () => {
  it("selects a small weak-scored portrait on the document and upscales its crop before embedding", async () => {
    const { provider, humanDetect, resizeBilinear, inputTensor } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [SMALL_PORTRAIT] })
      .mockResolvedValueOnce({
        face: [createFace([0, 0, 162, 160], 0.95, [0.5, 0.5])],
      })
      .mockResolvedValueOnce({ face: [SELFIE_FACE] });

    await expect(provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE)).resolves.toMatchObject({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0,
      similarity: 1,
      accepted: true,
    });

    expect(inputTensor.slice).toHaveBeenCalledWith([701, 1030, 0], [94, 95, 3]);
    expect(resizeBilinear).toHaveBeenCalledTimes(1);
    expect(resizeBilinear).toHaveBeenCalledWith(expect.anything(), [160, 162]);
  });

  it("verifies a single-face document against a single-face selfie without upscaling", async () => {
    const { provider, humanDetect, resizeBilinear, inputTensor } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({ face: [SELFIE_FACE] });

    await expect(provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE)).resolves.toMatchObject({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0,
      similarity: 1,
      accepted: true,
    });

    expect(resizeBilinear).not.toHaveBeenCalled();
    expect(inputTensor.slice).toHaveBeenCalledWith([900, 700, 0], [240, 220, 3]);
  });

  it("accepts same-direction FaceRes descriptors with different magnitudes", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [3, 4])] })
      .mockResolvedValueOnce({ face: [createFace([200, 180, 320, 320], 0.98, [30, 40])] });

    await expect(provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE)).resolves.toMatchObject({
      distance: 0,
      similarity: 1,
      accepted: true,
    });
  });

  it("fails closed when the document image contains no face", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect.mockResolvedValueOnce({ face: [] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.NO_FACE,
    );
  });

  it("fails closed when every document candidate is below the document confidence floor", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect.mockResolvedValueOnce({
      face: [createFace([1030, 701, 95, 94], 0.09, [0.5, 0.5])],
    });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.NO_FACE,
    );
  });

  it("fails closed when the document portrait is too small to embed reliably", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect.mockResolvedValueOnce({ face: [TINY_CANDIDATE] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.NO_FACE,
    );
  });

  it("rejects a giant artifact covering the document and fails closed", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect.mockResolvedValueOnce({ face: [GIANT_ARTIFACT] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.NO_FACE,
    );
  });

  it("ignores an implausible high-score box and uses the only plausible portrait", async () => {
    const { provider, humanDetect, resizeBilinear, inputTensor } = createFixture();
    humanDetect
      .mockResolvedValueOnce({
        face: [
          createFace([700, 900, 220, 240], 0.12, [0.5, 0.5]),
          TINY_CANDIDATE,
          SMALL_PORTRAIT,
        ],
      })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 162, 160], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({ face: [SELFIE_FACE] });

    await expect(provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE)).resolves.toMatchObject({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0,
      similarity: 1,
      accepted: true,
    });

    expect(inputTensor.slice).toHaveBeenCalledWith([701, 1030, 0], [94, 95, 3]);
    expect(resizeBilinear).toHaveBeenCalledWith(expect.anything(), [160, 162]);
  });

  it("fails closed (LOW_CONFIDENCE) when the selfie face is below the operator confidence", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({ face: [createFace([200, 180, 320, 320], 0.6, [0.5, 0.5])] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.LOW_CONFIDENCE,
    );
  });

  it("keeps the selfie strict and rejects multiple selfie faces", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({
        face: [
          createFace([200, 180, 320, 320], 0.98, [0.5, 0.5]),
          createFace([400, 180, 320, 320], 0.9, [0.2, 0.2]),
        ],
      });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.MULTIPLE_FACES,
    );
  });

  it("ignores a second selfie face below the detector minimum confidence", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({
        face: [
          createFace([200, 180, 320, 320], 0.98, [0.5, 0.5]),
          createFace([400, 180, 320, 320], 0.2, [0.9, 0.9]),
        ],
      });

    await expect(provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE)).resolves.toMatchObject({
      documentFaceCount: 1,
      selfieFaceCount: 1,
      distance: 0,
      similarity: 1,
      accepted: true,
    });
  });

  it("keeps the selfie pipeline free of document-only cropping and upscaling", async () => {
    const { provider, humanDetect, resizeBilinear, inputTensor } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({ face: [SELFIE_FACE] });

    await expect(provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE)).resolves.toMatchObject({
      accepted: true,
    });

    expect(inputTensor.slice).toHaveBeenCalledTimes(1);
    expect(resizeBilinear).not.toHaveBeenCalled();
  });

  it("fails closed when the document crop embedding is sparse with holes", async () => {
    const { provider, humanDetect } = createFixture();
    const sparseEmbedding: number[] = [];
    sparseEmbedding[0] = 0.5;
    sparseEmbedding[2] = 0.5;
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, sparseEmbedding)] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("fails closed when the selfie embedding contains NaN", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({
        face: [createFace([200, 180, 320, 320], 0.98, [0.5, Number.NaN])],
      });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("fails closed when the selfie embedding contains Infinity", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({
        face: [createFace([200, 180, 320, 320], 0.98, [0.5, Number.POSITIVE_INFINITY])],
      });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("fails closed when the document crop embedding has zero L2 norm", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0, 0])] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("fails closed when the selfie embedding has zero L2 norm", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [0.5, 0.5])] })
      .mockResolvedValueOnce({ face: [createFace([200, 180, 320, 320], 0.98, [0, 0])] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("fails closed when a detected face has no usable embedding", async () => {
    const { provider, humanDetect } = createFixture();
    humanDetect
      .mockResolvedValueOnce({ face: [STRONG_DOCUMENT_FACE] })
      .mockResolvedValueOnce({ face: [createFace([0, 0, 220, 240], 0.95, [])] });

    await expectFaceCaptureError(
      provider.verify(DOCUMENT_IMAGE, SELFIE_IMAGE),
      FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE,
    );
  });

  it("exposes the detection mode contract used by the verification flow", () => {
    const modes: FaceDetectionMode[] = [
      FACE_DETECTION_MODE.DOCUMENT,
      FACE_DETECTION_MODE.SELFIE,
    ];
    expect(modes).toEqual(["document", "selfie"]);
  });
});