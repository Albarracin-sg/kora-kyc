ALTER TABLE "KycVerification"
  ADD COLUMN "faceAiVerdict" TEXT,
  ADD COLUMN "faceAiSimilarityPercent" DOUBLE PRECISION,
  ADD COLUMN "faceAiSummary" TEXT,
  ADD COLUMN "faceAiProvider" TEXT,
  ADD COLUMN "faceAiProviderModel" TEXT;
