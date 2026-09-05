-- AlterTable
ALTER TABLE "KycVerification" ADD COLUMN     "documentHeight" TEXT,
ADD COLUMN     "documentIssueDate" TIMESTAMP(3),
ADD COLUMN     "documentSex" TEXT;
