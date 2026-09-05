const mockController = jest.fn(() => (target: unknown) => target);
const mockGet = jest.fn(() => (): void => undefined);
const mockHttpCode = jest.fn(() => (): void => undefined);
const mockUseGuards = jest.fn(() => (): void => undefined);

jest.mock("@nestjs/common", () => ({
  Controller: mockController,
  Get: mockGet,
  HttpCode: mockHttpCode,
  HttpStatus: { OK: 200 },
  UseGuards: mockUseGuards,
}));

jest.mock("@nestjs/swagger", () => ({
  ApiTags: () => (): void => undefined,
  ApiOperation: () => (): void => undefined,
  ApiResponse: () => (): void => undefined,
}));

import { HealthController } from "../src/health/health.controller";

describe("HealthController", () => {
  it("exposes a public GET /health endpoint with an OK response", () => {
    expect(mockController).toHaveBeenCalledWith("health");
    expect(mockGet).toHaveBeenCalledWith();
    expect(mockHttpCode).toHaveBeenCalledWith(200);
    expect(mockUseGuards).not.toHaveBeenCalled();
    expect(new HealthController().getHealth()).toEqual({ status: "ok" });
  });
});
