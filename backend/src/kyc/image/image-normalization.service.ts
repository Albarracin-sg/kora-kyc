import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import sharp = require("sharp");
import { AppConfigService } from "../../config/app-config.service";

const sharpFactory = sharp as unknown as {
  (input?: Buffer | Buffer[] | sharp.SharpOptions, options?: sharp.SharpOptions): sharp.Sharp;
};

export const MAGIC_BYTE_IMAGE_MIME = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
} as const;

export type MagicByteImageMime =
  (typeof MAGIC_BYTE_IMAGE_MIME)[keyof typeof MAGIC_BYTE_IMAGE_MIME];

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export const IMAGE_NORMALIZATION_FAILURE = {
  INPUT_PIXEL_LIMIT: "input_pixel_limit",
  INVALID_DECODE: "invalid_decode",
} as const;

export type ImageNormalizationFailure =
  (typeof IMAGE_NORMALIZATION_FAILURE)[keyof typeof IMAGE_NORMALIZATION_FAILURE];

export function classifyImageNormalizationFailure(error: unknown): ImageNormalizationFailure {
  if (!(error instanceof Error)) {
    return IMAGE_NORMALIZATION_FAILURE.INVALID_DECODE;
  }

  const message = error.message.toLowerCase();
  if (message.includes("pixel limit") || message.includes("limitinputpixels")) {
    return IMAGE_NORMALIZATION_FAILURE.INPUT_PIXEL_LIMIT;
  }

  return IMAGE_NORMALIZATION_FAILURE.INVALID_DECODE;
}

function hasBytes(buffer: Buffer, ...bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

export function detectImageMimeFromMagicBytes(buffer: Buffer): MagicByteImageMime | null {
  if (hasBytes(buffer, 0xff, 0xd8, 0xff)) {
    return MAGIC_BYTE_IMAGE_MIME.JPEG;
  }

  if (hasBytes(buffer, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return MAGIC_BYTE_IMAGE_MIME.PNG;
  }

  if (
    hasBytes(buffer, 0x52, 0x49, 0x46, 0x46) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return MAGIC_BYTE_IMAGE_MIME.WEBP;
  }

  return null;
}

export function isPdfMagicBytes(buffer: Buffer): boolean {
  return hasBytes(buffer, 0x25, 0x50, 0x44, 0x46, 0x2d);
}

@Injectable()
export class ImageNormalizationService {
  private readonly logger = new Logger(ImageNormalizationService.name);

  constructor(private readonly configService: AppConfigService) {}

  async normalize(upload: Buffer): Promise<NormalizedImage> {
    const { imageMaxBytes, imageMaxPixels, imageMaxDimension } = this.configService.values;

    if (upload.length === 0) {
      throw new BadRequestException("An image file is required");
    }

    if (upload.length > imageMaxBytes) {
      throw new PayloadTooLargeException("The image exceeds the configured upload limit");
    }

    if (isPdfMagicBytes(upload)) {
      throw new UnsupportedMediaTypeException(
        "PDF documents are not supported in this MVP. Capture the document as a JPEG, PNG, or WebP image.",
      );
    }

    if (!detectImageMimeFromMagicBytes(upload)) {
      throw new UnsupportedMediaTypeException(
        "Only JPEG, PNG, and WebP images validated by file signature are accepted",
      );
    }

    try {
      const source = sharpFactory(upload, { limitInputPixels: imageMaxPixels, failOn: "error" });
      const sourceMetadata = await source.metadata();
      const sourceWidth = sourceMetadata.width;
      const sourceHeight = sourceMetadata.height;

      if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > imageMaxPixels) {
        throw new BadRequestException("The image exceeds the configured pixel limit");
      }

      const normalized = await sharpFactory(upload, { limitInputPixels: imageMaxPixels, failOn: "error" })
        .rotate()
        .resize({
          width: imageMaxDimension,
          height: imageMaxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      return {
        buffer: normalized.data,
        mimeType: MAGIC_BYTE_IMAGE_MIME.JPEG,
        byteSize: normalized.data.length,
        width: normalized.info.width,
        height: normalized.info.height,
        sha256: createHash("sha256").update(normalized.data).digest("hex"),
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const failure = classifyImageNormalizationFailure(error);
      this.logger.warn(`image_normalization_rejected cause=${failure}`);
      throw new BadRequestException("The image could not be safely normalized");
    }
  }
}
