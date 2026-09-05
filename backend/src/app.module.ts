import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./config/app-config.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { AppThrottlerGuard } from "./common/guards/app-throttler.guard";
import { SecurityThrottlerModule } from "./common/http/throttler.module";
import { HttpLoggingInterceptor } from "./common/interceptors/http-logging.interceptor";
import { KycModule } from "./kyc/kyc.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    SecurityThrottlerModule.forRootAsync(),
    AuthModule,
    UsersModule,
    KycModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class AppModule {}
