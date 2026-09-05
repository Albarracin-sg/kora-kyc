import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { PrismaService } from "../prisma/prisma.service";

export interface UserProfile {
  id: string;
  email: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async getMe(user: AuthenticatedUser): Promise<UserProfile> {
    const persistedUser = await this.prismaService.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, createdAt: true },
    });
    if (!persistedUser) {
      throw new NotFoundException("User account was not found");
    }

    return persistedUser;
  }
}
