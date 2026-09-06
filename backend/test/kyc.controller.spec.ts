const decorator = (..._args: unknown[]) => (..._target: unknown[]): void => undefined;
const mockGet = jest.fn(decorator);

jest.mock("@nestjs/common", () => ({
  BadRequestException: class BadRequestException extends Error {},
  Body: decorator,
  Controller: decorator,
  Get: mockGet,
  Header: decorator,
  HttpCode: decorator,
  HttpStatus: { ACCEPTED: 202 },
  Inject: decorator,
  Injectable: decorator,
  Param: decorator,
  Post: decorator,
  Query: decorator,
  StreamableFile: class StreamableFile {},
  UploadedFile: decorator,
  UseGuards: decorator,
  UseInterceptors: decorator,
  createParamDecorator: () => decorator,
}));

jest.mock("@nestjs/platform-express", () => ({
  FileInterceptor: jest.fn(() => class FileInterceptor {}),
}));

jest.mock("@nestjs/passport", () => ({
  AuthGuard: jest.fn(() => class AuthGuard {}),
}));

jest.mock("@nestjs/swagger", () => ({
  ApiBearerAuth: decorator,
  ApiConsumes: decorator,
  ApiOperation: decorator,
  ApiParam: decorator,
  ApiQuery: decorator,
  ApiResponse: decorator,
  ApiTags: decorator,
}));

import { KycController } from "../src/kyc/kyc.controller";
import type { KycService } from "../src/kyc/kyc.service";

describe("KycController consent requirements", () => {
  it("returns the service consent contract from GET /kyc/consent-requirements", () => {
    const requirements = {
      requiresExternalProcessing: true,
      consentVersion: "remote-verification-v2",
    };
    const service = {
      getConsentRequirements: jest.fn().mockReturnValue(requirements),
    } as unknown as KycService;
    const controller = new KycController(service);

    expect(controller.consentRequirements()).toEqual(requirements);
    expect(service.getConsentRequirements).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("consent-requirements");
  });
});

describe("KycController document side validation", () => {
  it("does not reflect an invalid side value in the error message", () => {
    const controller = new KycController({} as KycService);
    const parseSide = Reflect.get(controller, "parseSide") as (side: string) => unknown;
    const attackerInput = "NOT_A_SIDE_WITH_SECRET";

    expect(() => parseSide.call(controller, attackerInput)).toThrow(
      "Invalid document side. Use FRONT, BACK, or COMBINED",
    );
    expect(() => parseSide.call(controller, attackerInput)).not.toThrow(attackerInput);
  });
});
