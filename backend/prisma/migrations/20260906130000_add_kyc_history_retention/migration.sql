ALTER TABLE "KycVerification"
ADD COLUMN "finalizedAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "KycVerification"
SET
  "finalizedAt" = COALESCE("finalizedAt", LEAST("updatedAt", CURRENT_TIMESTAMP)),
  "expiresAt" = COALESCE(
    "expiresAt",
    LEAST(COALESCE("finalizedAt", "updatedAt"), CURRENT_TIMESTAMP) + INTERVAL '90 days'
  )
WHERE "status" IN ('APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'PROCESSING_FAILED')
  AND "expiresAt" IS NULL;

CREATE INDEX "KycVerification_userId_finalizedAt_id_idx"
ON "KycVerification"("userId", "finalizedAt", "id");

CREATE INDEX "KycVerification_expiresAt_idx"
ON "KycVerification"("expiresAt");
