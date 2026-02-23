import type { Role, User } from '@prisma/client';

import { appErrors } from '../../core/app-error';
import type { PasswordPort } from '../../lib/password';
import type { JwtUserPayload } from '../../types/auth';
import type { AuthRepositoryPort } from './auth.repository';
import type { LoginBody, RegisterBody } from './auth.schemas';

export interface PublicAuthUser {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface AuthLoginResult {
  user: User;
}

export class AuthService {
  constructor(
    private readonly authRepository: AuthRepositoryPort,
    private readonly passwordService: PasswordPort,
  ) {}

  countUsers(): Promise<number> {
    return this.authRepository.countUsers();
  }

  async register(input: RegisterBody, actor: JwtUserPayload | null): Promise<User> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const usersCount = await this.authRepository.countUsers();

    if (usersCount > 0) {
      if (!actor) {
        throw appErrors.unauthorized('Only admins can create users');
      }

      if (actor.role !== 'ADMIN') {
        throw appErrors.forbidden('Only admins can create users');
      }
    }

    const role: Role = usersCount === 0 ? 'ADMIN' : (input.role ?? 'USER');
    const passwordHash = await this.passwordService.hash(input.password);

    return this.authRepository.createUser({
      email: normalizedEmail,
      passwordHash,
      role,
    });
  }

  async login(input: LoginBody): Promise<AuthLoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.authRepository.findByEmail(normalizedEmail);

    if (!user) {
      throw appErrors.unauthorized('Invalid email or password');
    }

    const isValidPassword = await this.passwordService.verify(input.password, user.passwordHash);

    if (!isValidPassword) {
      throw appErrors.unauthorized('Invalid email or password');
    }

    return { user };
  }

  toPublicUser(user: User): PublicAuthUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
