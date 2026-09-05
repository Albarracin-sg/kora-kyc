export const FACE_MATCH_CONFIGURATION = {
  maximumDistance: 0.85,
  minimumSimilarity: 0.72,
} as const;

const INVALID_COMPARABLE_EMBEDDING_ERROR =
  "Face embeddings must be non-empty, finite, and equal in length";
const INVALID_EMBEDDING_NORM_ERROR = "Face embeddings must have non-zero finite L2 norms";

export function isDenseFiniteVector(embedding: readonly number[]): boolean {
  for (let index = 0; index < embedding.length; index += 1) {
    if (!(index in embedding) || !Number.isFinite(embedding[index])) {
      return false;
    }
  }
  return true;
}

function assertComparableEmbeddings(
  documentEmbedding: readonly number[],
  selfieEmbedding: readonly number[],
): void {
  if (
    documentEmbedding.length === 0 ||
    documentEmbedding.length !== selfieEmbedding.length ||
    !isDenseFiniteVector(documentEmbedding) ||
    !isDenseFiniteVector(selfieEmbedding)
  ) {
    throw new Error(INVALID_COMPARABLE_EMBEDDING_ERROR);
  }
}

function normalizeFaceEmbedding(embedding: readonly number[]): number[] {
  const magnitude = Math.sqrt(
    embedding.reduce((total, value) => total + value ** 2, 0),
  );
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error(INVALID_EMBEDDING_NORM_ERROR);
  }

  return embedding.map((value) => value / magnitude);
}

export function calculateFaceDistance(
  documentEmbedding: readonly number[],
  selfieEmbedding: readonly number[],
): number {
  assertComparableEmbeddings(documentEmbedding, selfieEmbedding);
  const normalizedDocumentEmbedding = normalizeFaceEmbedding(documentEmbedding);
  const normalizedSelfieEmbedding = normalizeFaceEmbedding(selfieEmbedding);

  const squaredDistance = normalizedDocumentEmbedding.reduce((total, documentValue, index) => {
    const selfieValue = normalizedSelfieEmbedding[index];
    if (selfieValue === undefined) {
      throw new Error("Face embeddings must be equal in length");
    }

    return total + (documentValue - selfieValue) ** 2;
  }, 0);

  return Math.sqrt(squaredDistance);
}

export function calculateFaceSimilarity(
  documentEmbedding: readonly number[],
  selfieEmbedding: readonly number[],
  maximumDistance: number = FACE_MATCH_CONFIGURATION.maximumDistance,
): number {
  if (!Number.isFinite(maximumDistance) || maximumDistance <= 0) {
    throw new Error("Maximum face distance must be a positive finite number");
  }

  const distance = calculateFaceDistance(documentEmbedding, selfieEmbedding);
  return Math.max(0, Math.min(1, 1 - distance / maximumDistance));
}

export function isFaceMatchAccepted(
  documentEmbedding: readonly number[],
  selfieEmbedding: readonly number[],
  minimumSimilarity: number = FACE_MATCH_CONFIGURATION.minimumSimilarity,
  maximumDistance: number = FACE_MATCH_CONFIGURATION.maximumDistance,
): boolean {
  if (!Number.isFinite(minimumSimilarity) || minimumSimilarity <= 0 || minimumSimilarity > 1) {
    throw new Error("Minimum face similarity must be greater than 0 and at most 1");
  }

  return calculateFaceSimilarity(documentEmbedding, selfieEmbedding, maximumDistance) >= minimumSimilarity;
}
