ALTER TABLE "KycImage"
  ADD COLUMN "captureIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "selectedForVerification" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "KycImage_verificationId_kind_side_key";

CREATE UNIQUE INDEX "KycImage_verificationId_kind_side_captureIndex_key"
  ON "KycImage"("verificationId", "kind", "side", "captureIndex");
