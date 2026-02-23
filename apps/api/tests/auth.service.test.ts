import type { Role, User } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PasswordPort } from '../src/lib/password';
import { AuthService } from '../src/modules/auth/auth.service';
import type { AuthRepositoryPort, CreateUserInput } from '../src/modules/auth/auth.repository';

class InMemoryAuthRepository implements AuthRepositoryPort {
  private readonly users: User[] = [];

  async countUsers(): Promise<number> {
    return this.users.length;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const user: User = {
      id: `user_${this.users.length + 1}`,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: new Date(`2026-02-23T00:00:0${this.users.length}Z`),
    };
    this.users.push(user);
    return user;
  }
}

function createPasswordMock(): PasswordPort {
  return {
    hash: vi.fn(async (plainText: string) => `hashed:${plainText}`),
    verify: vi.fn(async (plainText: string, hash: string) => hash === `hashed:${plainText}`),
  };
}

describe('AuthService', () => {
  it('creates the first user as ADMIN even when USER is requested', async () => {
    const repository = new InMemoryAuthRepository();
    const passwordService = createPasswordMock();
    const service = new AuthService(repository, passwordService);

    const user = await service.register(
      {
        email: 'first@example.com',
        password: 'secret123',
        role: 'USER',
      },
      null,
    );

    expect(user.role).toBe<Role>('ADMIN');
    expect(user.passwordHash).toBe('hashed:secret123');
  });

  it('blocks non-admin user creation after bootstrap', async () => {
    const repository = new InMemoryAuthRepository();
    const passwordService = createPasswordMock();
    const service = new AuthService(repository, passwordService);

    await service.register(
      {
        email: 'admin@example.com',
        password: 'secret123',
      },
      null,
    );

    await expect(
      service.register(
        {
          email: 'user@example.com',
          password: 'secret123',
          role: 'USER',
        },
        {
          sub: 'user_2',
          email: 'operator@example.com',
          role: 'USER',
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('rejects login when password is invalid', async () => {
    const repository = new InMemoryAuthRepository();
    const passwordService = createPasswordMock();
    const service = new AuthService(repository, passwordService);

    await service.register(
      {
        email: 'admin@example.com',
        password: 'secret123',
      },
      null,
    );

    await expect(
      service.login({
        email: 'admin@example.com',
        password: 'wrongpass123',
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });
});
