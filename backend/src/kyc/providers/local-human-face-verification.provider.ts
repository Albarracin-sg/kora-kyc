import { Injectable } from "@nestjs/common";
import nodeUtil = require("node:util");
import { pathToFileURL } from "node:url";
import type { Config as HumanConfig, FaceResult, Human, Input } from "@vladmandic/human";
import { AppConfigService } from "../../config/app-config.service";
import { ASSET_GROUP, AssetIntegrityService, LocalModelAssetError } from "../assets/asset-integrity.service";
import {
  calculateFaceDistance,
  calculateFaceSimilarity,
  isDenseFiniteVector,
  isFaceMatchAccepted,
} from "./face-metrics";
import type { FaceVerificationProvider, FaceVerificationResult } from "./face-verification.provider";

export const FACE_DETECTION_MODE = {
  DOCUMENT: "document",
  SELFIE: "selfie",
} as const;

export type FaceDetectionMode =
  (typeof FACE_DETECTION_MODE)[keyof typeof FACE_DETECTION_MODE];

export const FACE_CAPTURE_FAILURE_CODE = {
  NO_FACE: "NO_FACE",
  MULTIPLE_FACES: "MULTIPLE_FACES",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  EMBEDDING_UNAVAILABLE: "EMBEDDING_UNAVAILABLE",
  QUALITY_LOW: "QUALITY_LOW",
  FACE_SERVICE_UNAVAILABLE: "FACE_SERVICE_UNAVAILABLE",
  INVALID_RESPONSE: "INVALID_RESPONSE",
} as const;

export type FaceCaptureFailureCode =
  (typeof FACE_CAPTURE_FAILURE_CODE)[keyof typeof FACE_CAPTURE_FAILURE_CODE];

export class FaceCaptureError extends Error {
  constructor(readonly code: FaceCaptureFailureCode) {
    super("The submitted image cannot be used for face verification");
    this.name = "FaceCaptureError";
  }
}

export class FaceModelUnavailableError extends Error {
  constructor() {
    super("The local face verification model is unavailable");
    this.name = "FaceModelUnavailableError";
  }
}

export interface DetectedFaceLike {
  box: readonly [number, number, number, number];
  boxScore: number;
}

export const DOCUMENT_FACE_DETECTION = {
  minConfidence: 0.1,
  minShortSide: 24,
  maxAreaRatio: 0.15,
  embedTargetShortSide: 160,
} as const;

export interface ClampedPortraitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampPortraitBox(
  box: readonly [number, number, number, number],
  imageWidth: number,
  imageHeight: number,
): ClampedPortraitBox | null {
  const [boxX, boxY, boxWidth, boxHeight] = box;
  const clampedX = Math.max(boxX, 0);
  const clampedY = Math.max(boxY, 0);
  const clampedWidth = Math.min(boxX + boxWidth, imageWidth) - clampedX;
  const clampedHeight = Math.min(boxY + boxHeight, imageHeight) - clampedY;

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }
  return { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight };
}

export function selectDocumentPortrait<T extends DetectedFaceLike>(
  faces: readonly T[],
  imageWidth: number,
  imageHeight: number,
): T | null {
  const maximumPlausibleArea = DOCUMENT_FACE_DETECTION.maxAreaRatio * imageWidth * imageHeight;
  let candidate: T | null = null;

  for (const face of faces) {
    if (face.boxScore < DOCUMENT_FACE_DETECTION.minConfidence) {
      continue;
    }
    const clamped = clampPortraitBox(face.box, imageWidth, imageHeight);
    if (clamped === null) {
      continue;
    }
    if (Math.min(clamped.width, clamped.height) < DOCUMENT_FACE_DETECTION.minShortSide) {
      continue;
    }
    if (clamped.width * clamped.height > maximumPlausibleArea) {
      continue;
    }
    if (candidate === null || face.boxScore > candidate.boxScore) {
      candidate = face;
    }
  }

  return candidate;
}

export interface UpscaledCropSize {
  width: number;
  height: number;
}

export function calculateUpscaledCropSize(
  cropWidth: number,
  cropHeight: number,
): UpscaledCropSize | null {
  if (!(cropWidth > 0) || !(cropHeight > 0)) {
    return null;
  }
  if (
    Math.min(cropWidth, cropHeight) >= DOCUMENT_FACE_DETECTION.embedTargetShortSide
  ) {
    return { width: cropWidth, height: cropHeight };
  }

  const scale = DOCUMENT_FACE_DETECTION.embedTargetShortSide / Math.min(cropWidth, cropHeight);
  return {
    width: Math.round(cropWidth * scale),
    height: Math.round(cropHeight * scale),
  };
}

export function selectDominantFace<T extends DetectedFaceLike>(faces: readonly T[]): T | null {
  if (faces.length === 0) {
    return null;
  }

  return faces.reduce<T | null>((dominant, face) => {
    if (dominant === null) {
      return face;
    }

    const dominantArea = dominant.box[2] * dominant.box[3];
    const faceArea = face.box[2] * face.box[3];
    if (faceArea > dominantArea) {
      return face;
    }
    if (faceArea === dominantArea && face.boxScore > dominant.boxScore) {
      return face;
    }
    return dominant;
  }, null);
}

interface TensorWithDispose {
  dispose(): void;
}

interface ImageTensor extends TensorWithDispose {
  shape: readonly number[];
  slice(begin: readonly number[], size: readonly number[]): TensorWithDispose;
}

interface TensorflowNodeRuntime {
  node: {
    decodeImage(image: Buffer, channels: number): ImageTensor;
  };
  image: {
    resizeBilinear(
      images: TensorWithDispose,
      size: readonly [number, number],
    ): TensorWithDispose;
  };
}

interface NodeUtilityCompatibility {
  isNullOrUndefined?: (value: unknown) => boolean;
}

const HUMAN_ENGINE_CONFIGURATION = {
  backend: "tensorflow",
  async: false,
  warmup: "none",
  debug: false,
  cacheModels: false,
  cacheSensitivity: 0,
  filter: { enabled: false },
  gesture: { enabled: false },
  face: {
    enabled: true,
    detector: {
      enabled: true,
      modelPath: "blazeface.json",
      rotation: false,
      maxDetected: 2,
      minConfidence: 0.55,
      minSize: 40,
      return: false,
    },
    description: {
      enabled: true,
      modelPath: "faceres.json",
      minConfidence: 0.1,
    },
    mesh: { enabled: false },
    attention: { enabled: false },
    iris: { enabled: false },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
    gear: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  segmentation: { enabled: false },
} as const satisfies Partial<HumanConfig>;

export const DOCUMENT_DETECTOR_OVERRIDE = {
  face: {
    detector: {
      minConfidence: DOCUMENT_FACE_DETECTION.minConfidence,
      minSize: DOCUMENT_FACE_DETECTION.minShortSide,
    },
  },
} as const satisfies Partial<HumanConfig>;

function installTensorflowNodeCompatibility(): void {
  const compatibility = nodeUtil as unknown as NodeUtilityCompatibility;
  if (!compatibility.isNullOrUndefined) {
    compatibility.isNullOrUndefined = (value: unknown): boolean => value === null || value === undefined;
  }
}

@Injectable()
export class LocalHumanFaceVerificationProvider implements FaceVerificationProvider {
  private human: Human | null = null;
  private tensorflow: TensorflowNodeRuntime | null = null;
  private engineInitialization: Promise<void> | null = null;
  private engineTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly configService: AppConfigService,
    private readonly assetIntegrityService: AssetIntegrityService,
  ) {}

  async verify(documentImage: Buffer, selfieImage: Buffer): Promise<FaceVerificationResult> {
    return this.withEngineLock(async () => {
      const documentEmbedding = await this.detectSingleFaceEmbedding(
        documentImage,
        FACE_DETECTION_MODE.DOCUMENT,
      );
      const selfieEmbedding = await this.detectSingleFaceEmbedding(
        selfieImage,
        FACE_DETECTION_MODE.SELFIE,
      );
      const { faceMinimumSimilarity, faceMaximumDistance } = this.configService.values;
      const distance = calculateFaceDistance(documentEmbedding, selfieEmbedding);
      const similarity = calculateFaceSimilarity(
        documentEmbedding,
        selfieEmbedding,
        faceMaximumDistance,
      );

      return {
        documentFaceCount: 1,
        selfieFaceCount: 1,
        distance,
        similarity,
        accepted: isFaceMatchAccepted(
          documentEmbedding,
          selfieEmbedding,
          faceMinimumSimilarity,
          faceMaximumDistance,
        ),
      };
    });
  }

  private async withEngineLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousOperation = this.engineTail;
    let release: () => void = () => undefined;
    this.engineTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previousOperation;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async detectSingleFaceEmbedding(
    image: Buffer,
    mode: FaceDetectionMode,
  ): Promise<number[]> {
    try {
      await this.initializeEngine();
      if (!this.human || !this.tensorflow) {
        throw new FaceModelUnavailableError();
      }

      const input = this.tensorflow.node.decodeImage(image, 3);
      try {
        if (mode === FACE_DETECTION_MODE.DOCUMENT) {
          return await this.documentPortraitEmbedding(input);
        }
        return await this.selfieEmbedding(input);
      } finally {
        input.dispose();
      }
    } catch (error: unknown) {
      if (
        error instanceof FaceCaptureError ||
        error instanceof FaceModelUnavailableError ||
        error instanceof LocalModelAssetError
      ) {
        throw error;
      }

      throw new FaceModelUnavailableError();
    }
  }

  private async selfieEmbedding(input: ImageTensor): Promise<number[]> {
    const result = await this.human?.detect(input as unknown as Input);
    const faces = result?.face.filter(
      (faceResult) =>
        faceResult.boxScore >= HUMAN_ENGINE_CONFIGURATION.face.detector.minConfidence,
    );
    const face = this.selectUsableFace(faces ?? [], FACE_DETECTION_MODE.SELFIE);
    if (face.boxScore < this.configService.values.faceMinimumConfidence) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.LOW_CONFIDENCE);
    }
    return this.requireUsableEmbedding(face);
  }

  private async documentPortraitEmbedding(input: ImageTensor): Promise<number[]> {
    const tensorflow = this.tensorflow;
    if (!tensorflow) {
      throw new FaceModelUnavailableError();
    }
    const imageWidth = input.shape[1] ?? 0;
    const imageHeight = input.shape[0] ?? 0;
    const result = await this.human?.detect(
      input as unknown as Input,
      DOCUMENT_DETECTOR_OVERRIDE,
    );
    const portrait = selectDocumentPortrait(result?.face ?? [], imageWidth, imageHeight);
    if (portrait === null) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.NO_FACE);
    }

    const cropBox = clampPortraitBox(portrait.box, imageWidth, imageHeight);
    if (cropBox === null) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.NO_FACE);
    }

    const crop = input.slice(
      [cropBox.y, cropBox.x, 0],
      [cropBox.height, cropBox.width, 3],
    );
    try {
      const cropSize = calculateUpscaledCropSize(cropBox.width, cropBox.height);
      if (cropSize === null) {
        throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.NO_FACE);
      }

      let embeddingInput: TensorWithDispose = crop;
      let upscaled: TensorWithDispose | null = null;
      if (cropSize.width !== cropBox.width || cropSize.height !== cropBox.height) {
        upscaled = tensorflow.image.resizeBilinear(
          crop,
          [cropSize.height, cropSize.width],
        );
        embeddingInput = upscaled;
      }

      try {
        const cropResult = await this.human?.detect(
          embeddingInput as unknown as Input,
          DOCUMENT_DETECTOR_OVERRIDE,
        );
        const faces = (cropResult?.face ?? []).filter(
          (faceResult) =>
            faceResult.boxScore >= DOCUMENT_FACE_DETECTION.minConfidence,
        );
        return this.requireUsableEmbedding(this.selectBestScoringFace(faces));
      } finally {
        upscaled?.dispose();
      }
    } finally {
      crop.dispose();
    }
  }

  private requireUsableEmbedding(face: FaceResult): number[] {
    if (!face.embedding || face.embedding.length === 0) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE);
    }

    if (
      !isDenseFiniteVector(face.embedding) ||
      face.embedding.every((value) => value === 0)
    ) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.EMBEDDING_UNAVAILABLE);
    }

    return face.embedding;
  }

  private selectBestScoringFace(faces: readonly FaceResult[]): FaceResult {
    const best = faces.reduce<FaceResult | null>((candidate, face) => {
      if (candidate === null || face.boxScore > candidate.boxScore) {
        return face;
      }
      return candidate;
    }, null);
    if (best === null) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.NO_FACE);
    }
    return best;
  }

  private selectUsableFace(faces: readonly FaceResult[], mode: FaceDetectionMode): FaceResult {
    const [primaryFace, ...remainingFaces] = faces;
    if (primaryFace === undefined) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.NO_FACE);
    }

    if (remainingFaces.length === 0) {
      return primaryFace;
    }

    if (mode === FACE_DETECTION_MODE.SELFIE) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.MULTIPLE_FACES);
    }

    const dominantFace = selectDominantFace(faces);
    if (dominantFace === null) {
      throw new FaceCaptureError(FACE_CAPTURE_FAILURE_CODE.NO_FACE);
    }
    return dominantFace;
  }

  private async initializeEngine(): Promise<void> {
    if (!this.engineInitialization) {
      this.engineInitialization = this.createEngine();
    }

    try {
      await this.engineInitialization;
    } catch (error: unknown) {
      this.engineInitialization = null;
      throw error;
    }
  }

  private async createEngine(): Promise<void> {
    await this.assetIntegrityService.ensureGroup(ASSET_GROUP.HUMAN);
    installTensorflowNodeCompatibility();
    const humanModule = await import("@vladmandic/human");
    const tensorflowModule = await import("@tensorflow/tfjs-node");
    const configuration: Partial<HumanConfig> = {
      ...HUMAN_ENGINE_CONFIGURATION,
      modelBasePath: pathToFileURL(`${this.configService.values.humanModelsPath}/`).toString(),
    };

    this.human = new humanModule.Human(configuration);
    this.tensorflow = tensorflowModule as unknown as TensorflowNodeRuntime;
    await this.human.load();
  }
}
