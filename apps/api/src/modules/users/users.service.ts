import { Prisma, type Role, type User } from '@prisma/client';

import { appErrors } from '../../core/app-error';
import type { PasswordPort } from '../../lib/password';
import type { JwtUserPayload } from '../../types/auth';
import type { SelfProfileUpdateBody, UserCreateBody, UserUpdateBody } from './users.schemas';
import { UsersRepository } from './users.repository';

export interface UserResponse {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  createdAt: string;
}

function serializeUser(user: User): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordPort,
  ) {}

  async list(): Promise<UserResponse[]> {
    const users = await this.usersRepository.list();
    return users.map(serializeUser);
  }

  async create(input: UserCreateBody): Promise<UserResponse> {
    const passwordHash = await this.passwordService.hash(input.password);

    const created = await this.usersRepository.create({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      passwordHash,
      role: input.role ?? 'USER',
    });

    return serializeUser(created);
  }

  async update(id: string, input: UserUpdateBody, actor: JwtUserPayload): Promise<UserResponse> {
    const existing = await this.usersRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Usuario nao encontrado');
    }

    if (id === actor.sub && input.role && input.role !== existing.role) {
      throw appErrors.conflict('Nao e permitido alterar o proprio role por esta rota');
    }

    const passwordHash = input.password ? await this.passwordService.hash(input.password) : undefined;

    const updated = await this.usersRepository.update(id, {
      name: input.name?.trim(),
      email: input.email?.trim().toLowerCase(),
      passwordHash,
      role: input.role,
    });

    return serializeUser(updated);
  }

  async updateSelfProfile(actor: JwtUserPayload, input: SelfProfileUpdateBody): Promise<UserResponse> {
    const existing = await this.usersRepository.getById(actor.sub);
    if (!existing) {
      throw appErrors.notFound('Usuario autenticado nao encontrado');
    }

    const updated = await this.usersRepository.update(actor.sub, {
      name: input.name.trim(),
    });

    return serializeUser(updated);
  }

  async remove(id: string, actor: JwtUserPayload): Promise<UserResponse> {
    if (id === actor.sub) {
      throw appErrors.conflict('Nao e permitido excluir a propria conta');
    }

    const existing = await this.usersRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Usuario nao encontrado');
    }

    try {
      const deleted = await this.usersRepository.delete(id);
      return serializeUser(deleted);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw appErrors.conflict('Usuario nao pode ser removido porque possui auditoria/ordens vinculadas');
      }
      throw error;
    }
  }
}
