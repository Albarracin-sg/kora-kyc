export const DOCUMENT_SIDE = {
  FRONT: "FRONT",
  BACK: "BACK",
  COMBINED: "COMBINED",
} as const;

export type DocumentSide = (typeof DOCUMENT_SIDE)[keyof typeof DOCUMENT_SIDE];

const DOCUMENT_SIDES = Object.values(DOCUMENT_SIDE);

export function isValidDocumentSide(value: string): value is DocumentSide {
  return DOCUMENT_SIDES.includes(value as DocumentSide);
}
