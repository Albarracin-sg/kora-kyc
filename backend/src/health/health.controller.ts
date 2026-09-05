import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Service health check" })
  @ApiResponse({ status: 200, description: "Service is healthy" })
  getHealth(): { status: "ok" } {
    return { status: "ok" };
  }
}
