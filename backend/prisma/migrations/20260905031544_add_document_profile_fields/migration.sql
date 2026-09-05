-- AlterTable
ALTER TABLE "KycVerification" ADD COLUMN     "documentBirthDate" TIMESTAMP(3),
ADD COLUMN     "documentCheckResult" TEXT,
ADD COLUMN     "documentFullName" TEXT,
ADD COLUMN     "documentNumber" TEXT;
