import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { BcryptPasswordService } from '../../lib/password';
import { parseWithSchema } from '../../utils/validation';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import {
  selfProfileUpdateBodySchema,
  userCreateBodySchema,
  userIdParamsSchema,
  userUpdateBodySchema,
} from './users.schemas';

function buildUsersService(fastify: FastifyInstance): UsersService {
  return new UsersService(
    new UsersRepository(fastify.prisma),
    new BcryptPasswordService(fastify.config.BCRYPT_SALT_ROUNDS),
  );
}

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/users', async (request) => {
    fastify.requireRole(request, 'ADMIN');
    const service = buildUsersService(fastify);
    return {
      data: await service.list(),
    };
  });

  fastify.post('/users', async (request, reply) => {
    fastify.requireRole(request, 'ADMIN');
    const body = parseWithSchema(userCreateBodySchema, request.body);
    const service = buildUsersService(fastify);
    const user = await service.create(body);
    return reply.status(201).send({ data: user });
  });

  fastify.put('/users/me/profile', async (request) => {
    const body = parseWithSchema(selfProfileUpdateBodySchema, request.body);
    const service = buildUsersService(fastify);
    return {
      data: await service.updateSelfProfile(request.user, body),
    };
  });

  fastify.put('/users/:id', async (request) => {
    fastify.requireRole(request, 'ADMIN');
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(userUpdateBodySchema, request.body);
    const service = buildUsersService(fastify);
    return {
      data: await service.update(params.id, body, request.user),
    };
  });

  fastify.delete('/users/:id', async (request) => {
    fastify.requireRole(request, 'ADMIN');
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const service = buildUsersService(fastify);
    return {
      data: await service.remove(params.id, request.user),
    };
  });
};
