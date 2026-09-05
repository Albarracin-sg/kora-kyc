jest.mock("@nestjs/common", () => ({
  ConflictException: class ConflictException extends Error {},
  Inject: () => (): void => undefined,
  Injectable: () => (): void => undefined,
}));

import type { AppConfigService } from "../src/config/app-config.service";
import { REMOTE_BIOMETRIC_CONSENT_VERSION } from "../src/kyc/domain/remote-biometric-consent";
import { DOCUMENT_SIDE } from "../src/kyc/domain/document-side";
import type { ImageNormalizationService } from "../src/kyc/image/image-normalization.service";
import { KycService } from "../src/kyc/kyc.service";
import type { FileStorage } from "../src/kyc/storage/file-storage.port";
import type { PrismaService } from "../src/prisma/prisma.service";

const USER = { id: "user-id", email: "user@example.test" };

function createService(
  remoteFaceService: boolean,
  externalDocumentProvider = false,
): {
  service: KycService;
  create: jest.Mock;
  findFirst: jest.Mock;
  update: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue({ images: [] });
  const findFirst = jest.fn().mockResolvedValue(null);
  const update = jest.fn().mockResolvedValue({ images: [] });
  const prisma = {
    kycVerification: { create, findFirst, update },
  } as unknown as PrismaService;
  const config = {
    values: {
      documentProvider: externalDocumentProvider ? "huggingface" : "local",
      faceVerificationProvider: remoteFaceService ? "face_service" : "local",
    },
  } as AppConfigService;

  return {
    service: new KycService(
      prisma,
      {} as ImageNormalizationService,
      {} as FileStorage,
      config,
    ),
    create,
    findFirst,
    update,
  };
}

describe("KycService remote biometric consent", () => {
  it("rejects starting any externally processed verification without the exact consent version", async () => {
    const { service, create } = createService(true);

    await expect(service.start(USER)).rejects.toMatchObject({
      message: "Remote verification consent is required before starting KYC",
    });
    await expect(service.start(USER, "obsolete-consent-v0")).rejects.toMatchObject({
      message: "Remote verification consent is required before starting KYC",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires consent when the document provider is external even with local face comparison", async () => {
    const { service, create } = createService(false, true);

    await expect(service.start(USER)).rejects.toMatchObject({
      message: "Remote verification consent is required before starting KYC",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "local document and local face comparison",
      remoteFaceService: false,
      externalDocumentProvider: false,
      requiresConsent: false,
    },
    {
      label: "external document and local face comparison",
      remoteFaceService: false,
      externalDocumentProvider: true,
      requiresConsent: true,
    },
    {
      label: "local document and remote face service",
      remoteFaceService: true,
      externalDocumentProvider: false,
      requiresConsent: true,
    },
    {
      label: "external document and remote face service",
      remoteFaceService: true,
      externalDocumentProvider: true,
      requiresConsent: true,
    },
  ])("applies the consent matrix to $label", async ({
    remoteFaceService,
    externalDocumentProvider,
    requiresConsent,
  }) => {
    const { service, create } = createService(remoteFaceService, externalDocumentProvider);
    expect(service.getConsentRequirements()).toEqual({
      requiresExternalProcessing: requiresConsent,
      consentVersion: requiresConsent ? REMOTE_BIOMETRIC_CONSENT_VERSION : null,
    });

    if (requiresConsent) {
      await expect(service.start(USER)).rejects.toMatchObject({
        message: "Remote verification consent is required before starting KYC",
      });
      expect(create).not.toHaveBeenCalled();

      await service.start(USER, REMOTE_BIOMETRIC_CONSENT_VERSION);
      expect(create).toHaveBeenCalledTimes(1);
      return;
    }

    await service.start(USER);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("persists only the consent version and server timestamp for externally processed verification", async () => {
    const { service, create } = createService(true);

    await service.start(USER, REMOTE_BIOMETRIC_CONSENT_VERSION);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER.id,
          consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
          consentAcceptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("publishes whether external processing is required and its current consent version", () => {
    const remoteService = createService(true).service;
    const localService = createService(false).service;

    expect(remoteService.getConsentRequirements()).toEqual({
      requiresExternalProcessing: true,
      consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
    });
    expect(localService.getConsentRequirements()).toEqual({
      requiresExternalProcessing: false,
      consentVersion: null,
    });
  });

  it("upgrades an active verification with valid consent before resuming capture", async () => {
    const { service, create, findFirst, update } = createService(true);
    const activeVerification = {
      id: "verification-id",
      userId: USER.id,
      status: "CREATED",
      consentVersion: null,
      consentAcceptedAt: null,
      images: [],
    };
    findFirst.mockResolvedValue(activeVerification);
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...activeVerification,
      ...data,
      updatedAt: data.consentAcceptedAt,
    }));

    const resumedVerification = await service.start(USER, REMOTE_BIOMETRIC_CONSENT_VERSION);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: activeVerification.id },
      data: {
        consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
        consentAcceptedAt: expect.any(Date),
      },
      include: { images: true },
    });
    const updateData = update.mock.calls[0]?.[0]?.data as { consentAcceptedAt: Date };
    expect(updateData.consentAcceptedAt).toBeInstanceOf(Date);
    expect(resumedVerification.updatedAt).toBe(updateData.consentAcceptedAt);
  });

  it("does not treat an active verification with a missing timestamp as consented", async () => {
    const { service, findFirst, update } = createService(true);
    findFirst.mockResolvedValue({
      id: "verification-id",
      userId: USER.id,
      status: "CREATED",
      consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
      consentAcceptedAt: undefined,
      images: [],
    });
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "verification-id",
      userId: USER.id,
      status: "CREATED",
      ...data,
      images: [],
    }));

    await service.start(USER, REMOTE_BIOMETRIC_CONSENT_VERSION);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consentVersion: REMOTE_BIOMETRIC_CONSENT_VERSION,
          consentAcceptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("keeps local face verification compatible without remote consent", async () => {
    const { service, create } = createService(false);

    await service.start(USER);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: USER.id, status: "CREATED" },
      }),
    );
  });

  it("blocks document, selfie, and validation endpoints when a remote verification lacks consent", async () => {
    const { service, findFirst } = createService(true);
    findFirst.mockResolvedValue({
      id: "verification-id",
      userId: USER.id,
      status: "CREATED",
      consentVersion: null,
      consentAcceptedAt: null,
      images: [],
    });

    await expect(service.uploadDocument(USER, Buffer.from("image"), DOCUMENT_SIDE.FRONT)).rejects.toMatchObject({
      message: "Remote verification consent is required before continuing KYC",
    });
    await expect(service.uploadSelfie(USER, Buffer.from("image"))).rejects.toMatchObject({
      message: "Remote verification consent is required before continuing KYC",
    });
    await expect(service.verify(USER)).rejects.toMatchObject({
      message: "Remote verification consent is required before continuing KYC",
    });
  });
});
