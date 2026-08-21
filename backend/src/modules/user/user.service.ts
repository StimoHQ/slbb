import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserCreateInput } from 'prisma/generated/models';

@Injectable()
export class UserService {
  constructor(private readonly prismaService: PrismaService) {}

  public async create(user: UserCreateInput) {
    return await this.prismaService.user.create({
      data: user,
    });
  }
}
