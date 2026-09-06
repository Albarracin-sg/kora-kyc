import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { KycMediaImage } from "./kyc-media-image";
import { getAuthenticatedMediaSource } from "../services/api-client";

let mockIsFocused = true;

jest.mock("@react-navigation/native", () => ({
  useIsFocused: () => mockIsFocused,
}));

jest.mock("../services/api-client", () => ({
  getAuthenticatedMediaSource: jest.fn(),
}));

const getAuthenticatedMediaSourceMock = getAuthenticatedMediaSource as jest.MockedFunction<
  typeof getAuthenticatedMediaSource
>;

const FIRST_SOURCE = {
  uri: "https://example.com/media/first.jpg",
  headers: { Authorization: "Bearer first-token" },
};

const SECOND_SOURCE = {
  uri: "https://example.com/media/second.jpg",
  headers: { Authorization: "Bearer second-token" },
};

const DOCUMENT_IMAGE_LABEL = "Imagen del documento";

async function resolveDocumentImage(): Promise<ReturnType<typeof screen.getByLabelText>> {
  // The loading and failed placeholders share the accessibility label with the
  // Image, so only fire "error" once the source-backed Image is actually
  // rendered.
  await waitFor(() => {
    expect(screen.queryByLabelText(DOCUMENT_IMAGE_LABEL)?.props.source?.uri).toBe(
      FIRST_SOURCE.uri,
    );
  });
  return screen.getByLabelText(DOCUMENT_IMAGE_LABEL);
}

describe("KycMediaImage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFocused = true;
  });

  it("shows the placeholder after two consecutive image errors", async () => {
    getAuthenticatedMediaSourceMock
      .mockResolvedValueOnce(FIRST_SOURCE)
      .mockRejectedValueOnce(new Error("refreshed source still failed"));

    render(
      <KycMediaImage
        mediaId="media-1"
        accessibilityLabel={DOCUMENT_IMAGE_LABEL}
      />,
    );

    const image = await resolveDocumentImage();
    fireEvent(image, "error");

    expect(await screen.findByText("Imagen no disponible")).toBeOnTheScreen();
    expect(getAuthenticatedMediaSourceMock).toHaveBeenCalledTimes(2);
  });

  it("renders the refreshed source after a single image error recovers", async () => {
    getAuthenticatedMediaSourceMock
      .mockResolvedValueOnce(FIRST_SOURCE)
      .mockResolvedValueOnce(SECOND_SOURCE);

    render(
      <KycMediaImage
        mediaId="media-1"
        accessibilityLabel={DOCUMENT_IMAGE_LABEL}
      />,
    );

    const image = await resolveDocumentImage();
    fireEvent(image, "error");

    await waitFor(() => {
      expect(screen.queryByLabelText(DOCUMENT_IMAGE_LABEL)?.props.source?.uri).toBe(
        SECOND_SOURCE.uri,
      );
    });
    expect(getAuthenticatedMediaSourceMock).toHaveBeenCalledTimes(2);
  });

  it("releases the private data URI when the screen loses focus", async () => {
    getAuthenticatedMediaSourceMock.mockResolvedValueOnce(FIRST_SOURCE);
    const rendered = render(<KycMediaImage mediaId="media-1" accessibilityLabel={DOCUMENT_IMAGE_LABEL} />);
    await resolveDocumentImage();
    mockIsFocused = false;
    rendered.rerender(<KycMediaImage mediaId="media-1" accessibilityLabel={DOCUMENT_IMAGE_LABEL} />);
    expect(screen.queryByLabelText(DOCUMENT_IMAGE_LABEL)?.props.source).toBeUndefined();
  });
});
