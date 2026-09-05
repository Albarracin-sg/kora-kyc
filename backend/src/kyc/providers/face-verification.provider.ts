export interface FaceVerificationResult {
  documentFaceCount: number;
  selfieFaceCount: number;
  distance: number;
  similarity: number;
  accepted: boolean;
}

export interface FaceVerificationProvider {
  verify(documentImage: Buffer, selfieImage: Buffer): Promise<FaceVerificationResult>;
}
