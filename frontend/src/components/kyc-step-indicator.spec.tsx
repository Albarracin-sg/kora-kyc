import { render, screen } from "@testing-library/react-native";
import {
  getKycStages,
  KycStepIndicator,
  KYC_STAGE,
  KYC_STAGE_STATUS,
  type KycStageState,
} from "./kyc-step-indicator";
import {
  DOCUMENT_SIDE,
  KYC_IMAGE_KIND,
  KYC_STATUS,
  type KycImageMetadata,
  type KycStatus,
  type KycVerification,
} from "../types/api";

function createImageMetadata(
  id: string,
  overrides: Partial<KycImageMetadata> = {},
): KycImageMetadata {
  return {
    id,
    kind: KYC_IMAGE_KIND.DOCUMENT,
    side: DOCUMENT_SIDE.FRONT,
    mimeType: "image/jpeg",
    byteSize: 1024,
    width: 800,
    height: 600,
    uploadedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

function createVerification(
  status: KycStatus,
  images: KycImageMetadata[],
): KycVerification {
  return {
    id: "verification-1",
    status,
    reasonCode: null,
    documentType: "CÉDULA",
    documentFullName: null,
    documentNumber: null,
    documentBirthDate: null,
    documentIssueDate: null,
    documentSex: null,
    documentHeight: null,
    documentBloodType: null,
    documentBirthPlace: null,
    documentNationality: null,
    documentCheckResult: null,
    faceSimilarity: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    images,
  };
}

function getStatus(stageState: KycStageState | undefined, stage: string): string {
  return stageState?.stage === stage ? stageState.status : "";
}

describe("getKycStages", () => {
  it("marks FRONT as current when no images are uploaded", () => {
    const stages = getKycStages(createVerification(KYC_STATUS.CREATED, []));

    expect(stages).toHaveLength(4);
    expect(getStatus(stages[0], KYC_STAGE.FRONT)).toBe(KYC_STAGE_STATUS.CURRENT);
  });

  it("marks BACK as current when only the front side is uploaded", () => {
    const stages = getKycStages(
      createVerification(KYC_STATUS.DOCUMENT_UPLOADED, [
        createImageMetadata("front-id"),
      ]),
    );

    expect(getStatus(stages[0], KYC_STAGE.FRONT)).toBe(KYC_STAGE_STATUS.COMPLETED);
    expect(getStatus(stages[1], KYC_STAGE.BACK)).toBe(KYC_STAGE_STATUS.CURRENT);
    expect(getStatus(stages[2], KYC_STAGE.SELFIE)).toBe(KYC_STAGE_STATUS.PENDING);
  });

  it("marks SELFIE as current when both sides are uploaded", () => {
    const stages = getKycStages(
      createVerification(KYC_STATUS.DOCUMENT_UPLOADED, [
        createImageMetadata("front-id"),
        createImageMetadata("back-id", { side: DOCUMENT_SIDE.BACK }),
      ]),
    );

    expect(getStatus(stages[0], KYC_STAGE.FRONT)).toBe(KYC_STAGE_STATUS.COMPLETED);
    expect(getStatus(stages[1], KYC_STAGE.BACK)).toBe(KYC_STAGE_STATUS.COMPLETED);
    expect(getStatus(stages[2], KYC_STAGE.SELFIE)).toBe(KYC_STAGE_STATUS.CURRENT);
    expect(getStatus(stages[3], KYC_STAGE.VALIDATING)).toBe(
      KYC_STAGE_STATUS.PENDING,
    );
  });

  it("marks VALIDATING as current when the selfie is uploaded", () => {
    const stages = getKycStages(
      createVerification(KYC_STATUS.SELFIE_UPLOADED, [
        createImageMetadata("front-id"),
        createImageMetadata("back-id", { side: DOCUMENT_SIDE.BACK }),
        createImageMetadata("selfie-id", {
          kind: KYC_IMAGE_KIND.SELFIE,
          side: null,
        }),
      ]),
    );

    expect(getStatus(stages[3], KYC_STAGE.VALIDATING)).toBe(
      KYC_STAGE_STATUS.CURRENT,
    );
  });

  it("keeps VALIDATING current while the backend is validating", () => {
    const stages = getKycStages(
      createVerification(KYC_STATUS.VALIDATING, [
        createImageMetadata("front-id"),
        createImageMetadata("back-id", { side: DOCUMENT_SIDE.BACK }),
        createImageMetadata("selfie-id", {
          kind: KYC_IMAGE_KIND.SELFIE,
          side: null,
        }),
      ]),
    );

    expect(getStatus(stages[3], KYC_STAGE.VALIDATING)).toBe(
      KYC_STAGE_STATUS.CURRENT,
    );
  });

  it("completes every stage on a terminal status", () => {
    const stages = getKycStages(
      createVerification(KYC_STATUS.APPROVED, [
        createImageMetadata("front-id"),
        createImageMetadata("back-id", { side: DOCUMENT_SIDE.BACK }),
        createImageMetadata("selfie-id", {
          kind: KYC_IMAGE_KIND.SELFIE,
          side: null,
        }),
      ]),
    );

    expect(stages.every((stageState) => stageState.status === KYC_STAGE_STATUS.COMPLETED)).toBe(
      true,
    );
  });
});

describe("KycStepIndicator", () => {
  it("renders the four stage labels with accessibility info", () => {
    render(
      <KycStepIndicator
        verification={createVerification(KYC_STATUS.DOCUMENT_UPLOADED, [
          createImageMetadata("front-id"),
        ])}
      />,
    );

    expect(screen.getByText("Frente")).toBeOnTheScreen();
    expect(screen.getByText("Reverso")).toBeOnTheScreen();
    expect(screen.getByText("Rostro")).toBeOnTheScreen();
    expect(screen.getByText("Validando")).toBeOnTheScreen();
    expect(
      screen.getByLabelText("Progreso de verificación de identidad"),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText("Paso 2 de 4: Reverso, actual"),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText("Paso 1 de 4: Frente, completado"),
    ).toBeOnTheScreen();
  });

  it("renders four pending steps when no verification exists", () => {
    render(<KycStepIndicator verification={null} />);

    expect(screen.getByLabelText("Paso 1 de 4: Frente, actual")).toBeOnTheScreen();
    expect(screen.getByLabelText("Paso 2 de 4: Reverso, pendiente")).toBeOnTheScreen();
    expect(screen.getByLabelText("Paso 3 de 4: Rostro, pendiente")).toBeOnTheScreen();
    expect(screen.getByLabelText("Paso 4 de 4: Validando, pendiente")).toBeOnTheScreen();
  });
});
