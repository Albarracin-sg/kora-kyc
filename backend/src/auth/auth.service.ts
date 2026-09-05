import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { AppConfigService } from "../config/app-config.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginDto } from "./dto/login.dto";
import type { RegisterDto } from "./dto/register.dto";
import type { RefreshTokenDto } from "./dto/refresh-token.dto";
import type { AuthResponse, JwtPayload } from "./auth.types";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createOpaqueRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
  ) {}

  async register(input: RegisterDto): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    try {
      const passwordHash = await bcrypt.hash(input.password, this.configService.values.bcryptRounds);
      const user = await this.prismaService.user.create({
        data: { email, passwordHash },
      });

      return this.createAuthResponse({ id: user.id, email: user.email });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Email is already registered");
      }

      throw error;
    }
  }

  async login(input: LoginDto): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const user = await this.prismaService.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.createAuthResponse({ id: user.id, email: user.email });
  }

  async refresh(input: RefreshTokenDto): Promise<AuthResponse> {
    const rawToken = input.refreshToken.trim();
    if (!rawToken) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const now = new Date();
    const rotated = await this.prismaService.$transaction(async (transaction) => {
      const persistedToken = await transaction.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(rawToken) },
        include: { user: { select: { id: true, email: true } } },
      });

      if (
        !persistedToken ||
        persistedToken.revokedAt !== null ||
        persistedToken.expiresAt <= now
      ) {
        throw new UnauthorizedException("Invalid refresh token");
      }

      const revocation = await transaction.refreshToken.updateMany({
        where: {
          id: persistedToken.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      if (revocation.count !== 1) {
        throw new UnauthorizedException("Invalid refresh token");
      }

      const issuedToken = this.issueRefreshToken(now);
      await transaction.refreshToken.create({
        data: {
          userId: persistedToken.user.id,
          tokenHash: hashRefreshToken(issuedToken.rawToken),
          expiresAt: issuedToken.expiresAt,
        },
      });

      return {
        refreshToken: issuedToken.rawToken,
        user: persistedToken.user,
      };
    });

    return this.createAccessResponse(rotated.user, rotated.refreshToken);
  }

  async logout(input: RefreshTokenDto): Promise<void> {
    const rawToken = input.refreshToken.trim();
    if (!rawToken) {
      return;
    }

    await this.prismaService.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createAuthResponse(user: AuthenticatedUser): Promise<AuthResponse> {
    const issuedToken = this.issueRefreshToken(new Date());
    await this.prismaService.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(issuedToken.rawToken),
        expiresAt: issuedToken.expiresAt,
      },
    });
    return this.createAccessResponse(user, issuedToken.rawToken);
  }

  private async createAccessResponse(
    user: AuthenticatedUser,
    refreshToken: string,
  ): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.configService.values.jwtExpiresIn,
    });

    return { accessToken, refreshToken, user };
  }

  private issueRefreshToken(issuedAt: Date): IssuedRefreshToken {
    const rawToken = createOpaqueRefreshToken();
    return {
      rawToken,
      expiresAt: new Date(issuedAt.getTime() + this.configService.values.refreshTokenTtlMs),
    };
  }
}
