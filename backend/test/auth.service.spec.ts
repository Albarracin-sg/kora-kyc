import * as bcrypt from "bcrypt";
import type { JwtService } from "@nestjs/jwt";
import type { Prisma } from "@prisma/client";
import { AuthService, hashRefreshToken } from "../src/auth/auth.service";
import type { AppConfigService } from "../src/config/app-config.service";
import type { PrismaService } from "../src/prisma/prisma.service";

jest.mock("@nestjs/common", () => ({
  ConflictException: class ConflictException extends Error {},
  Injectable: () => (target: unknown) => target,
  UnauthorizedException: class UnauthorizedException extends Error {},
}));

jest.mock("@nestjs/jwt", () => ({
  JwtService: class JwtService {},
}));

jest.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
  },
  PrismaClient: class PrismaClient {},
}));

const USER = { id: "auth-regression-user", email: "auth-regression@example.test" };

interface ServiceMocks {
  service: AuthService;
  createUser: jest.Mock;
  findUser: jest.Mock;
  createRefreshToken: jest.Mock;
  updateRefreshToken: jest.Mock;
  findRefreshToken: jest.Mock;
  transactionCreateRefreshToken: jest.Mock;
  signAsync: jest.Mock;
}

function createService(): ServiceMocks {
  const createUser = jest.fn().mockResolvedValue({
    ...USER,
    passwordHash: "stored-password-hash",
  });
  const findUser = jest.fn().mockResolvedValue({
    ...USER,
    passwordHash: "stored-password-hash",
  });
  const createRefreshToken = jest.fn().mockResolvedValue({ id: "refresh-token-id" });
  const findRefreshToken = jest.fn();
  const updateRefreshToken = jest.fn();
  const transactionCreateRefreshToken = jest.fn().mockResolvedValue({ id: "rotated-token-id" });
  const transaction = {
    refreshToken: {
      findUnique: findRefreshToken,
      updateMany: updateRefreshToken,
      create: transactionCreateRefreshToken,
    },
  } as unknown as Prisma.TransactionClient;
  const prismaService = {
    user: { create: createUser, findUnique: findUser },
    refreshToken: { create: createRefreshToken, updateMany: updateRefreshToken },
    $transaction: jest
      .fn()
      .mockImplementation(
        async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(transaction),
      ),
  } as unknown as PrismaService;
  const signAsync = jest.fn().mockResolvedValue("auth-regression-access-token");
  const jwtService = { signAsync } as unknown as JwtService;
  const configService = {
    values: { bcryptRounds: 4, jwtExpiresIn: "15m", refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000 },
  } as unknown as AppConfigService;

  return {
    service: new AuthService(prismaService, jwtService, configService),
    createUser,
    findUser,
    createRefreshToken,
    updateRefreshToken,
    findRefreshToken,
    transactionCreateRefreshToken,
    signAsync,
  };
}

describe("AuthService", () => {
  it("hashes passwords and issues a hashed opaque refresh token in CommonJS runtime", async () => {
    const password = "regression-password";
    const email = "auth-regression@example.test";
    const passwordHash = await bcrypt.hash(password, 4);
    const mocks = createService();
    mocks.createUser.mockResolvedValue({ ...USER, email, passwordHash });
    mocks.findUser.mockResolvedValue({ ...USER, email, passwordHash });

    const registration = await mocks.service.register({ email, password });
    const storedPasswordHash = mocks.createUser.mock.calls[0]?.[0].data.passwordHash as string;
    const login = await mocks.service.login({ email, password });
    const storedRefreshTokenHash = mocks.createRefreshToken.mock.calls[0]?.[0].data.tokenHash as string;

    expect(storedPasswordHash).not.toBe(password);
    expect(await bcrypt.compare(password, storedPasswordHash)).toBe(true);
    expect(registration.user).toEqual(USER);
    expect(login.user).toEqual(USER);
    expect(registration.refreshToken).not.toBe(storedRefreshTokenHash);
    expect(hashRefreshToken(registration.refreshToken)).toBe(storedRefreshTokenHash);
    expect(mocks.createUser).toHaveBeenCalledWith({
      data: { email, passwordHash: storedPasswordHash },
    });
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { email } });
    expect(mocks.signAsync).toHaveBeenCalledWith(
      { sub: USER.id, email: USER.email },
      { expiresIn: "15m" },
    );
  });

  it("rotates a valid refresh token atomically and never persists its raw value", async () => {
    const rawToken = "refresh-token-for-rotation";
    const mocks = createService();
    mocks.findRefreshToken.mockResolvedValue({
      id: "current-refresh-token",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: USER,
    });
    mocks.updateRefreshToken.mockResolvedValue({ count: 1 });

    const response = await mocks.service.refresh({ refreshToken: rawToken });
    const storedNextTokenHash = mocks.transactionCreateRefreshToken.mock.calls[0]?.[0].data
      .tokenHash as string;

    expect(response.user).toEqual(USER);
    expect(response.refreshToken).not.toBe(rawToken);
    expect(storedNextTokenHash).toBe(hashRefreshToken(response.refreshToken));
    expect(mocks.updateRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "current-refresh-token",
          revokedAt: null,
        }),
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(mocks.transactionCreateRefreshToken).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER.id, tokenHash: storedNextTokenHash }),
    });
  });

  it("rejects expired tokens and does not create a replacement", async () => {
    const mocks = createService();
    mocks.findRefreshToken.mockResolvedValue({
      id: "expired-refresh-token",
      expiresAt: new Date(Date.now() - 1),
      revokedAt: null,
      user: USER,
    });

    await expect(mocks.service.refresh({ refreshToken: "expired-refresh-token" })).rejects.toThrow(
      "Invalid refresh token",
    );
    expect(mocks.updateRefreshToken).not.toHaveBeenCalled();
    expect(mocks.transactionCreateRefreshToken).not.toHaveBeenCalled();
  });

  it("revokes a refresh token on logout", async () => {
    const mocks = createService();
    mocks.updateRefreshToken.mockResolvedValue({ count: 1 });

    await mocks.service.logout({ refreshToken: "refresh-token-for-logout" });

    expect(mocks.updateRefreshToken).toHaveBeenCalledWith({
      where: { tokenHash: hashRefreshToken("refresh-token-for-logout"), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
