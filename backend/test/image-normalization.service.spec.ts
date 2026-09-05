import sharp = require("sharp");
import type { AppConfigService } from "../src/config/app-config.service";
import {
  ImageNormalizationService,
  IMAGE_NORMALIZATION_FAILURE,
  MAGIC_BYTE_IMAGE_MIME,
  classifyImageNormalizationFailure,
} from "../src/kyc/image/image-normalization.service";

jest.mock("@nestjs/common", () => ({
  BadRequestException: class BadRequestException extends Error {},
  Injectable: () => (target: unknown) => target,
  Logger: class Logger {
    warn(): void {}
  },
  PayloadTooLargeException: class PayloadTooLargeException extends Error {},
  UnsupportedMediaTypeException: class UnsupportedMediaTypeException extends Error {},
}));

const sharpFactory = sharp as unknown as {
  (input?: Buffer | Buffer[] | sharp.SharpOptions, options?: sharp.SharpOptions): sharp.Sharp;
};

describe("ImageNormalizationService", () => {
  it("classifies Sharp input pixel limit errors without retaining their raw message", () => {
    expect(classifyImageNormalizationFailure(new Error("Input image exceeds pixel limit"))).toBe(
      IMAGE_NORMALIZATION_FAILURE.INPUT_PIXEL_LIMIT,
    );
  });

  it("classifies unknown Sharp decode errors as invalid decode", () => {
    expect(classifyImageNormalizationFailure(new Error("Invalid SOS parameters for sequential JPEG"))).toBe(
      IMAGE_NORMALIZATION_FAILURE.INVALID_DECODE,
    );
    expect(classifyImageNormalizationFailure({})).toBe(IMAGE_NORMALIZATION_FAILURE.INVALID_DECODE);
  });

  it("normalizes a synthetic image with the real Sharp CommonJS export", async () => {
    const source = await sharpFactory({
      create: {
        width: 4,
        height: 3,
        channels: 3,
        background: { r: 32, g: 96, b: 160 },
      },
    })
      .png()
      .toBuffer();
    const configService = {
      values: {
        imageMaxBytes: 1024 * 1024,
        imageMaxPixels: 100,
        imageMaxDimension: 64,
      },
    } as unknown as AppConfigService;

    const normalized = await new ImageNormalizationService(configService).normalize(source);

    expect(normalized.mimeType).toBe(MAGIC_BYTE_IMAGE_MIME.JPEG);
    expect(normalized.width).toBe(4);
    expect(normalized.height).toBe(3);
    expect(normalized.byteSize).toBeGreaterThan(0);
    expect(normalized.buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});
