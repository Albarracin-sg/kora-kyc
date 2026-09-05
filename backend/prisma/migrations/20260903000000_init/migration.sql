CREATE TYPE "KycStatus" AS ENUM (
  'CREATED',
  'DOCUMENT_UPLOADED',
  'SELFIE_UPLOADED',
  'VALIDATING',
  'APPROVED',
  'REJECTED',
  'NEEDS_REVIEW',
  'PROCESSING_FAILED'
);

CREATE TYPE "KycImageKind" AS ENUM ('DOCUMENT', 'SELFIE');
CREATE TYPE "KycJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycVerification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "KycStatus" NOT NULL DEFAULT 'CREATED',
  "rejectionCode" TEXT,
  "documentType" TEXT,
  "documentNumberHash" TEXT,
  "documentOcrConfidence" DOUBLE PRECISION,
  "faceDistance" DOUBLE PRECISION,
  "faceSimilarity" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycImage" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "kind" "KycImageKind" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycProcessingJob" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "status" "KycJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "lockToken" TEXT,
  "completedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KycProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "KycVerification_userId_createdAt_idx" ON "KycVerification"("userId", "createdAt");
CREATE INDEX "KycVerification_status_idx" ON "KycVerification"("status");
CREATE UNIQUE INDEX "KycImage_storageKey_key" ON "KycImage"("storageKey");
CREATE UNIQUE INDEX "KycImage_verificationId_kind_key" ON "KycImage"("verificationId", "kind");
CREATE INDEX "KycImage_verificationId_idx" ON "KycImage"("verificationId");
CREATE UNIQUE INDEX "KycProcessingJob_verificationId_key" ON "KycProcessingJob"("verificationId");
CREATE INDEX "KycProcessingJob_status_createdAt_idx" ON "KycProcessingJob"("status", "createdAt");

ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycImage" ADD CONSTRAINT "KycImage_verificationId_fkey"
  FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycProcessingJob" ADD CONSTRAINT "KycProcessingJob_verificationId_fkey"
  FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
