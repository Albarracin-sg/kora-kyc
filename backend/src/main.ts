import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/app-config.service";

/**
 * Content-Security-Policy applied globally with helmet.
 *
 * The API returns JSON, not HTML, so this CSP only affects the self-hosted
 * docs. Scalar (`/docs`) loads its renderer from jsdelivr and injects an
 * inline theme stylesheet; Swagger UI (`/api`) serves its assets from the same
 * origin. The policy allows `self` plus the single trusted CDN host and
 * `unsafe-inline` styles exclusively for the docs UIs. Native mobile clients do
 * not enforce CSP, so their JSON traffic is unaffected.
 */
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
  imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
  fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
  connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  upgradeInsecureRequests: [],
} as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(AppConfigService);

  app.use(
    helmet({
      contentSecurityPolicy: { directives: CSP_DIRECTIVES },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.enableCors({
    origin: configService.values.corsOrigins,
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Kora KYC API")
    .setDescription(
      "API de verificacion de identidad KYC. " +
      "Permite gestionar casos de verificacion con captura de documento (cedula colombiana) y selfie. " +
      "El procesamiento documental usa Gemini y la comparacion facial es local.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .addTag("Auth", "Registro e inicio de sesion")
    .addTag("Users", "Perfil del usuario autenticado")
    .addTag("KYC", "Gestion de verificacion de identidad")
    .build();

  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api", app, openApiDocument);

  app.use(
    "/docs",
    apiReference({
      url: "/api-json",
    }),
  );

  await app.listen(configService.values.port, "0.0.0.0");
}

void bootstrap();
