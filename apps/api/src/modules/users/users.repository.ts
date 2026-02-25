import type { PrismaClient, Role, User } from '@prisma/client';

export interface UserCreateRecordInput {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}

export interface UserUpdateRecordInput {
  name?: string;
  email?: string;
  passwordHash?: string;
  role?: Role;
}

export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  getById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  create(data: UserCreateRecordInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  update(id: string, data: UserUpdateRecordInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  delete(id: string): Promise<User> {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
