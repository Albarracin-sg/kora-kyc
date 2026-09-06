jest.mock("@nestjs/common", () => ({
  Catch: () => (target: unknown) => target,
  HttpException: class HttpException extends Error {
    constructor(private readonly body: unknown, private readonly status: number) {
      super(typeof body === "string" ? body : "Http exception");
    }

    getResponse(): unknown {
      return this.body;
    }

    getStatus(): number {
      return this.status;
    }
  },
  HttpStatus: { BAD_REQUEST: 400 },
  Injectable: () => (target: unknown) => target,
  Logger: class {
    readonly error = jest.fn();
    readonly warn = jest.fn();
    readonly log = jest.fn();
  },
}));

import { firstValueFrom, of } from "rxjs";
import { APP_ENVIRONMENT, type AppConfigService } from "../src/config/app-config.service";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { HttpLoggingInterceptor } from "../src/common/interceptors/http-logging.interceptor";
import { HttpException, HttpStatus } from "@nestjs/common";

interface HttpHost {
  switchToHttp(): {
    getRequest<T>(): T;
    getResponse<T>(): T;
  };
}

function createHttpHost(request: unknown, response: unknown): HttpHost {
  return {
    switchToHttp: () => ({
      getRequest: <T>(): T => request as T,
      getResponse: <T>(): T => response as T,
    }),
  };
}

describe("HTTP security path handling", () => {
  it("removes query strings from normalized error paths and reflected messages", () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: "GET",
      originalUrl: "/kyc/document?side=SECRET_SIDE_VALUE",
      query: { side: "SECRET_SIDE_VALUE" },
    };
    const filter = new HttpExceptionFilter({
      values: { environment: APP_ENVIRONMENT.DEVELOPMENT },
    } as AppConfigService);

    filter.catch(
      new HttpException(
        { message: "Invalid side 'SECRET_SIDE_VALUE'" },
        HttpStatus.BAD_REQUEST,
      ),
      createHttpHost(request, response) as never,
    );

    const body = response.json.mock.calls[0]?.[0] as {
      path: string;
      message: string;
    };
    expect(body.path).toBe("/kyc/document");
    expect(body.message).toBe("Request failed");
    expect(JSON.stringify(body)).not.toContain("SECRET_SIDE_VALUE");
  });

  it("removes query strings from access logs", async () => {
    const interceptor = new HttpLoggingInterceptor();
    const response = { statusCode: 200 };
    const request = {
      method: "GET",
      originalUrl: "/kyc/document?side=SECRET_SIDE_VALUE",
      url: "/kyc/document?side=SECRET_SIDE_VALUE",
      ip: "127.0.0.1",
    };
    const context = createHttpHost(request, response);

    await firstValueFrom(
      interceptor.intercept(context as never, { handle: () => of("ok") }),
    );

    const logger = Reflect.get(interceptor, "logger") as {
      log: jest.Mock;
    };
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("GET /kyc/document 200"),
    );
    expect(logger.log.mock.calls[0]?.[0]).not.toContain("SECRET_SIDE_VALUE");
  });
});
