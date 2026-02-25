import type { PrismaClient, Role, User } from '@prisma/client';

export interface CreateUserInput {
  name?: string | null;
  email: string;
  passwordHash: string;
  role: Role;
}

export interface AuthRepositoryPort {
  countUsers(): Promise<number>;
  findByEmail(email: string): Promise<User | null>;
  createUser(input: CreateUserInput): Promise<User>;
}

export class PrismaAuthRepository implements AuthRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  countUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  createUser(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        name: input.name ?? null,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
      },
    });
  }
}
