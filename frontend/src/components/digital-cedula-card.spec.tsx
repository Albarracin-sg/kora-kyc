import { render, screen } from "@testing-library/react-native";
import { DigitalCedulaCard } from "./digital-cedula-card";
import { DOCUMENT_SIDE, KYC_IMAGE_KIND, type KycImageMetadata } from "../types/api";

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
      />,
    );

    expect(screen.getByText("Coincidencia facial")).toBeOnTheScreen();
    await screen.findByText("92%");
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
      />,
    );

    expect(screen.queryByText("Coincidencia facial")).not.toBeOnTheScreen();
    await screen.findByLabelText("Fotografía del rostro");
  });
});