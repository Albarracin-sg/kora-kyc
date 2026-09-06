-- Additive nullable profile fields; existing verification rows remain unchanged.
ALTER TABLE "KycVerification"
ADD COLUMN "documentBloodType" TEXT,
ADD COLUMN "documentBirthPlace" TEXT;
