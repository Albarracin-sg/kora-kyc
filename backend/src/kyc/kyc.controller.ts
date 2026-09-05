import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Express } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { DOCUMENT_SIDE, type DocumentSide } from "./domain/document-side";
import { KycService, type KycPublicVerification } from "./kyc.service";

const MULTIPART_LIMITS = {
  fileSize: 10 * 1024 * 1024,
  files: 1,
} as const;

@ApiTags("KYC")
@ApiBearerAuth()
@Controller("kyc")
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post("start")
  @ApiOperation({ summary: "Start or resume a KYC verification" })
  @ApiResponse({ status: 201, description: "KYC verification created or resumed" })
  async start(@CurrentUser() user: AuthenticatedUser): Promise<KycPublicVerification> {
    return this.kycService.start(user);
  }

  @Post("document")
  @UseInterceptors(FileInterceptor("image", { limits: MULTIPART_LIMITS }))
  @ApiOperation({ summary: "Upload a document image for the active KYC verification" })
  @ApiConsumes("multipart/form-data")
  @ApiQuery({
    name: "side",
    required: true,
    enum: Object.values(DOCUMENT_SIDE),
    description: "Document side: FRONT, BACK, or COMBINED",
  })
  @ApiResponse({ status: 200, description: "Document image accepted" })
  @ApiResponse({ status: 400, description: "Missing image or invalid side parameter" })
  @ApiResponse({ status: 409, description: "Document cannot be uploaded in the current KYC state" })
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query("side") sideQuery: string | undefined,
  ): Promise<KycPublicVerification> {
    const side = this.parseSide(sideQuery);
    return this.kycService.uploadDocument(user, this.requireFile(file), side);
  }

  @Post("selfie")
  @UseInterceptors(FileInterceptor("image", { limits: MULTIPART_LIMITS }))
  @ApiOperation({ summary: "Upload a selfie image for the active KYC verification" })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 200, description: "Selfie image accepted" })
  @ApiResponse({ status: 409, description: "Selfie cannot be uploaded in the current KYC state" })
  async uploadSelfie(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<KycPublicVerification> {
    return this.kycService.uploadSelfie(user, this.requireFile(file));
  }

  @Post("verify")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Request validation of the active KYC verification" })
  @ApiResponse({ status: 202, description: "Validation request accepted" })
  @ApiResponse({ status: 409, description: "KYC verification not ready for validation" })
  async verify(@CurrentUser() user: AuthenticatedUser): Promise<KycPublicVerification> {
    return this.kycService.verify(user);
  }

  @Get("current")
  @ApiOperation({ summary: "Get the active KYC verification for the authenticated user" })
  @ApiResponse({ status: 200, description: "Active KYC verification or null" })
  async current(@CurrentUser() user: AuthenticatedUser): Promise<KycPublicVerification | null> {
    return this.kycService.getCurrent(user);
  }

  @Get("media/:mediaId")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Stream an owned KYC image (document or selfie)" })
  @ApiParam({ name: "mediaId", description: "KYC image identifier" })
  @ApiResponse({ status: 200, description: "Image streamed inline" })
  @ApiResponse({ status: 400, description: "Invalid media identifier" })
  @ApiResponse({ status: 403, description: "Media does not belong to the user" })
  @ApiResponse({ status: 404, description: "Media not found" })
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param("mediaId") mediaId: string,
  ): Promise<StreamableFile> {
    const media = await this.kycService.readOwnedMedia(user, mediaId);
    return new StreamableFile(media.buffer, {
      type: media.mimeType,
      disposition: "inline",
    });
  }

  private parseSide(sideQuery: string | undefined): DocumentSide {
    if (!sideQuery) {
      throw new BadRequestException("Query parameter 'side' is required (FRONT, BACK, or COMBINED)");
    }

    const normalized = sideQuery.trim().toUpperCase();
    if (!DOCUMENT_SIDE[normalized as keyof typeof DOCUMENT_SIDE]) {
      throw new BadRequestException(`Invalid side '${sideQuery}'. Must be FRONT, BACK, or COMBINED`);
    }

    return normalized as DocumentSide;
  }

  private requireFile(file: Express.Multer.File | undefined): Buffer {
    if (!file) {
      throw new BadRequestException("An image multipart field named image is required");
    }

    return file.buffer;
  }
}
