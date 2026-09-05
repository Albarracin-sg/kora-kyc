import {
  FACE_MATCH_CONFIGURATION,
  calculateFaceDistance,
  calculateFaceSimilarity,
  isDenseFiniteVector,
  isFaceMatchAccepted,
} from "../src/kyc/providers/face-metrics";

describe("isDenseFiniteVector", () => {
  it("accepts a dense vector of finite components", () => {
    expect(isDenseFiniteVector([0.5, -0.25, 0])).toBe(true);
  });

  it("rejects a vector with missing indices", () => {
    const sparseEmbedding: number[] = [];
    sparseEmbedding[0] = 1;
    sparseEmbedding[2] = 0;

    expect(isDenseFiniteVector(sparseEmbedding)).toBe(false);
  });

  it("rejects non-finite components", () => {
    expect(isDenseFiniteVector([1, Number.NaN])).toBe(false);
    expect(isDenseFiniteVector([1, Number.POSITIVE_INFINITY])).toBe(false);
  });

  it("accepts a zero vector as dense and finite (norm enforcement stays separate)", () => {
    expect(isDenseFiniteVector([0, 0])).toBe(true);
  });
});

describe("face metrics", () => {
  it("calculates Euclidean distance after L2 normalization", () => {
    expect(calculateFaceDistance([1, 0], [0, 1])).toBeCloseTo(Math.sqrt(2), 8);
  });

  it("compares same-direction embeddings on their normalized scale", () => {
    const documentEmbedding = [3, 4];
    const selfieEmbedding = [30, 40];

    expect(calculateFaceDistance(documentEmbedding, selfieEmbedding)).toBeCloseTo(0, 8);
    expect(isFaceMatchAccepted(documentEmbedding, selfieEmbedding)).toBe(true);
    expect(documentEmbedding).toEqual([3, 4]);
    expect(selfieEmbedding).toEqual([30, 40]);
  });

  it("maps identical embeddings to full similarity", () => {
    expect(calculateFaceSimilarity([0.2, 0.4], [0.2, 0.4])).toBe(1);
  });

  it("rejects clearly divergent normalized embeddings", () => {
    const documentEmbedding = [1, 0];
    const selfieEmbedding = [0, 1];

    expect(calculateFaceSimilarity(documentEmbedding, selfieEmbedding)).toBe(0);
    expect(isFaceMatchAccepted(documentEmbedding, selfieEmbedding)).toBe(false);
  });

  it("uses the KYC-owned similarity threshold instead of a Human default", () => {
    const documentEmbedding = [1, 0];
    const acceptedSelfieEmbedding = [1, 0.1];
    const rejectedSelfieEmbedding = [0, 1];

    expect(isFaceMatchAccepted(documentEmbedding, acceptedSelfieEmbedding)).toBe(true);
    expect(isFaceMatchAccepted(documentEmbedding, rejectedSelfieEmbedding)).toBe(false);
    expect(FACE_MATCH_CONFIGURATION.maximumDistance).toBe(0.85);
    expect(FACE_MATCH_CONFIGURATION.minimumSimilarity).toBe(0.72);
  });

  it.each([
    ["a zero-norm vector", [0, 0], [1, 0]],
    ["a non-finite component", [1, Number.NaN], [1, 0]],
    ["an empty vector", [], []],
    ["vectors with different lengths", [1, 0], [1]],
  ])("fails closed for %s", (_description, documentEmbedding, selfieEmbedding) => {
    expect(() => calculateFaceDistance(documentEmbedding, selfieEmbedding)).toThrow();
    expect(() => calculateFaceSimilarity(documentEmbedding, selfieEmbedding)).toThrow();
    expect(() => isFaceMatchAccepted(documentEmbedding, selfieEmbedding)).toThrow();
  });

  it("fails closed for sparse vectors with holes", () => {
    const documentEmbedding = [1, 0, 0];
    const sparseSelfieEmbedding: number[] = [];
    sparseSelfieEmbedding[0] = 1;
    sparseSelfieEmbedding[2] = 0;

    expect(() => calculateFaceDistance(documentEmbedding, sparseSelfieEmbedding)).toThrow();
    expect(() => calculateFaceSimilarity(documentEmbedding, sparseSelfieEmbedding)).toThrow();
    expect(() => isFaceMatchAccepted(documentEmbedding, sparseSelfieEmbedding)).toThrow();
  });
});
