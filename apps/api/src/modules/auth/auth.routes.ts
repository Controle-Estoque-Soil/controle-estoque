import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { appErrors } from '../../core/app-error';
import { BcryptPasswordService } from '../../lib/password';
import { parseWithSchema } from '../../utils/validation';
import { PrismaAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { loginBodySchema, registerBodySchema } from './auth.schemas';

function buildAuthService(fastify: FastifyInstance): AuthService {
  const repository = new PrismaAuthRepository(fastify.prisma);
  const passwordService = new BcryptPasswordService(fastify.config.BCRYPT_SALT_ROUNDS);
  return new AuthService(repository, passwordService);
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/register', async (request, reply) => {
    const body = parseWithSchema(registerBodySchema, request.body);
    const authService = buildAuthService(fastify);
    const usersCount = await authService.countUsers();

    let actor = null;
    if (usersCount > 0) {
      await fastify.authenticate(request, reply);
      fastify.requireRole(request, 'ADMIN');
      actor = request.user;
    }

    const user = await authService.register(body, actor);

    return reply.status(201).send({
      user: authService.toPublicUser(user),
    });
  });

  fastify.post('/login', async (request) => {
    const body = parseWithSchema(loginBodySchema, request.body);
    const authService = buildAuthService(fastify);
    const { user } = await authService.login(body);
    const publicUser = authService.toPublicUser(user);

    const accessToken = await fastify.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken,
      user: publicUser,
    };
  });

  fastify.get('/me', async (request, reply) => {
    await fastify.authenticate(request, reply);
    const authService = buildAuthService(fastify);
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.user.sub },
    });

    if (!user) {
      throw appErrors.unauthorized('Authenticated user not found');
    }

    return {
      user: authService.toPublicUser(user),
    };
  });
};
