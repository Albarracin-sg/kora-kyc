import { IsOptional, IsString } from "class-validator";

export class StartKycDto {
  @IsOptional()
  @IsString()
  consentVersion?: string;
}
