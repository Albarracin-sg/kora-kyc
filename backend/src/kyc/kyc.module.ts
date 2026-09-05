import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { AssetIntegrityService } from "./assets/asset-integrity.service";
import { ImageNormalizationService } from "./image/image-normalization.service";
import { KycController } from "./kyc.controller";
import { KycProcessingWorker } from "./kyc-processing.worker";
import { KycService } from "./kyc.service";
import { KYC_TOKENS } from "./kyc.tokens";
import { LocalHumanFaceVerificationProvider } from "./providers/local-human-face-verification.provider";
import { FaceServiceVerificationProvider } from "./providers/face-service-verification.provider";
import { LocalTesseractDocumentExtractionProvider } from "./providers/local-tesseract-document-extraction.provider";
import { GeminiDocumentExtractionProvider } from "./providers/gemini-document-extraction.provider";
import { HuggingFaceDocumentExtractionProvider } from "./providers/hugging-face-document-extraction.provider";
import { selectDocumentExtractionProvider } from "./providers/document-extraction-provider.factory";
import { selectFaceVerificationProvider } from "./providers/face-verification-provider.factory";
import { AppConfigService } from "../config/app-config.service";
import { LocalFileStorage } from "./storage/local-file.storage";

@Module({
  imports: [PassportModule.register({ defaultStrategy: "jwt" })],
  controllers: [KycController],
  providers: [
    AssetIntegrityService,
    ImageNormalizationService,
    KycService,
    KycProcessingWorker,
    LocalFileStorage,
    LocalTesseractDocumentExtractionProvider,
    LocalHumanFaceVerificationProvider,
    {
      provide: KYC_TOKENS.FILE_STORAGE,
      useExisting: LocalFileStorage,
    },
    {
      provide: KYC_TOKENS.DOCUMENT_EXTRACTION_PROVIDER,
      useFactory: (
        configService: AppConfigService,
        localProvider: LocalTesseractDocumentExtractionProvider,
      ) =>
        selectDocumentExtractionProvider(
          configService.values,
          () => new GeminiDocumentExtractionProvider(configService),
          () => new HuggingFaceDocumentExtractionProvider(configService),
          localProvider,
        ),
      inject: [AppConfigService, LocalTesseractDocumentExtractionProvider],
    },
    {
      provide: KYC_TOKENS.FACE_VERIFICATION_PROVIDER,
      useFactory: (
        configService: AppConfigService,
        localProvider: LocalHumanFaceVerificationProvider,
      ) =>
        selectFaceVerificationProvider(
          configService.values,
          () => new FaceServiceVerificationProvider(configService),
          localProvider,
        ),
      inject: [AppConfigService, LocalHumanFaceVerificationProvider],
    },
  ],
})
export class KycModule {}
