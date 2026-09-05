-- CreateEnum
CREATE TYPE "DocumentSide" AS ENUM ('FRONT', 'BACK', 'COMBINED');

-- AlterTable: Add side column to KycImage (nullable for SELFIE kind)
ALTER TABLE "KycImage" ADD COLUMN "side" "DocumentSide";

-- AlterTable: Add coverage tracking to KycVerification
ALTER TABLE "KycVerification" ADD COLUMN "frontPresent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KycVerification" ADD COLUMN "backPresent" BOOLEAN NOT NULL DEFAULT false;

-- Drop old unique constraint on (verificationId, kind)
DROP INDEX "KycImage_verificationId_kind_key";

-- Create new unique constraint on (verificationId, kind, side)
-- PostgreSQL allows multiple NULLs in unique constraints, so SELFIE rows (side=NULL) remain unique per verification
CREATE UNIQUE INDEX "KycImage_verificationId_kind_side_key" ON "KycImage"("verificationId", "kind", "side");
