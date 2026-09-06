import { render, screen } from "@testing-library/react-native";
import { DigitalCedulaCard } from "./digital-cedula-card";
import {
  DOCUMENT_SIDE,
  KYC_FACE_COMPARISON_REASON,
  KYC_IMAGE_KIND,
  KYC_STATUS,
  type KycImageMetadata,
} from "../types/api";

jest.mock("../services/api-client", () => ({
  getAuthenticatedMediaSource: jest.fn(async () => ({
    uri: "https://example.test/kyc/media/image-id",
    headers: { Authorization: "Bearer test-token" },
  })),
}));

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

function createCedulaImages(): KycImageMetadata[] {
  return [
    createImageMetadata("document-front-id"),
    createImageMetadata("document-back-id", { side: DOCUMENT_SIDE.BACK }),
    createImageMetadata("selfie-id", { kind: KYC_IMAGE_KIND.SELFIE, side: null }),
  ];
}

describe("DigitalCedulaCard", () => {
  it("renders the eyebrow label without leaking the KYC status code", async () => {
    render(
      <DigitalCedulaCard
        images={createCedulaImages()}
        faceSimilarity={0.9234}
        statusLabel="Documento válido"
        status={KYC_STATUS.APPROVED}
        reasonCode={KYC_FACE_COMPARISON_REASON.APPROVED}
      />,
    );

    expect(screen.getByText("CÉDULA DIGITAL")).toBeOnTheScreen();
    expect(screen.getByText("Documento válido")).toBeOnTheScreen();
    await screen.findByLabelText("Fotografía del rostro");
  });

  it("shows the facial match percentage when present", async () => {
    render(
      <DigitalCedulaCard
        images={createCedulaImages()}
        faceSimilarity={0.9234}
        statusLabel="Documento válido"
        status={KYC_STATUS.APPROVED}
        reasonCode={KYC_FACE_COMPARISON_REASON.APPROVED}
      />,
    );

    expect(screen.getByText("Coincidencia facial: 92%")).toBeOnTheScreen();
    expect(
      screen.getByText("La coincidencia facial es suficiente para aprobar la verificación."),
    ).toBeOnTheScreen();
    await screen.findByText("Coincidencia facial: 92%");
    await screen.findByLabelText("Fotografía del frente del documento");
    await screen.findByLabelText("Fotografía del reverso del documento");
    await screen.findByLabelText("Fotografía del rostro");
  });

  it("hides the facial match row when no similarity is available", async () => {
    render(
      <DigitalCedulaCard
        images={createCedulaImages()}
        faceSimilarity={null}
        statusLabel="Documento válido"
        status={KYC_STATUS.NEEDS_REVIEW}
        reasonCode="FACE_CAPTURE_INVALID_RESPONSE"
      />,
    );

    expect(screen.queryByText(/Coincidencia facial:/)).not.toBeOnTheScreen();
    await screen.findByLabelText("Fotografía del rostro");
  });

  it("hides the facial match row for an invalid result with numeric similarity", async () => {
    render(
      <DigitalCedulaCard
        images={createCedulaImages()}
        faceSimilarity={0.91}
        statusLabel="La captura requiere revisión"
        status={KYC_STATUS.NEEDS_REVIEW}
        reasonCode="FACE_CAPTURE_INVALID_RESPONSE"
      />,
    );

    expect(screen.queryByText(/Coincidencia facial:/)).not.toBeOnTheScreen();
    await screen.findByLabelText("Fotografía del rostro");
  });

  it("shows a low facial match percentage and rejection verdict", async () => {
    render(
      <DigitalCedulaCard
        images={createCedulaImages()}
        faceSimilarity={0.41}
        statusLabel="Verificación no aprobada"
        status={KYC_STATUS.REJECTED}
        reasonCode={KYC_FACE_COMPARISON_REASON.BELOW_THRESHOLD}
      />,
    );

    expect(screen.getByText("Coincidencia facial: 41%")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "La coincidencia facial está por debajo del umbral requerido. La verificación no fue aprobada.",
      ),
    ).toBeOnTheScreen();
    await screen.findByLabelText("Fotografía del rostro");
  });
});
