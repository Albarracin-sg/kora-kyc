jest.mock("@nestjs/common", () => ({
  BadRequestException: class BadRequestException extends Error {},
  ConflictException: class ConflictException extends Error {},
  ForbiddenException: class ForbiddenException extends Error {},
  Inject: () => (): void => undefined,
  Injectable: () => (): void => undefined,
  NotFoundException: class NotFoundException extends Error {},
}));

import { KycService, type KycPublicVerification } from "../src/kyc/kyc.service";

interface PublicVerificationMapper {
  (verification: unknown): KycPublicVerification;
}

function createService(): KycService {
  return new KycService(
    {} as never,
    {} as never,
    {} as never,
    { values: {} } as never,
  );
}

function createVerification(documentType: string | null): Record<string, unknown> {
  return {
    id: "verification-opaque-id",
    status: "APPROVED",
    rejectionCode: null,
    documentType,
    documentNumberHash: "must-not-be-public",
    documentFullName: "MARIA ELENA GOMEZ",
    documentNumber: "1234567890",
    documentBirthDate: new Date("1990-05-16T00:00:00.000Z"),
    documentIssueDate: new Date("2010-05-15T00:00:00.000Z"),
    documentSex: "F",
    documentHeight: "1,64 m",
    documentBloodType: "O+",
    documentBirthPlace: "Bogotá",
    documentCheckResult: "VALID",
    faceSimilarity: 0.9,
    frontPresent: true,
    backPresent: true,
    createdAt: new Date("2026-09-05T00:00:00.000Z"),
    updatedAt: new Date("2026-09-05T00:00:00.000Z"),
    images: [],
  };
}

describe("KYC public verification contract", () => {
  it("derives Colombian nationality only from the confirmed document type", () => {
    const mapper = Reflect.get(createService(), "toPublicVerification") as PublicVerificationMapper;

    expect(mapper(createVerification("COLOMBIAN_CEDULA"))).toEqual(
      expect.objectContaining({
        documentBloodType: "O+",
        documentBirthPlace: "Bogotá",
        documentNationality: "COLOMBIAN",
      }),
    );

    const nonColombian = mapper(createVerification("PASSPORT"));
    expect(nonColombian.documentNationality).toBeNull();
    expect(nonColombian).not.toHaveProperty("documentNumberHash");
  });
});
