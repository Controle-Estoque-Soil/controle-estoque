import type { FastifyPluginAsync } from 'fastify';

import { parseWithSchema } from '../../utils/validation';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';
import {
  itemCreateBodySchema,
  itemIdParamsSchema,
  itemListQuerySchema,
  itemUpdateBodySchema,
  stockAdjustmentBodySchema,
} from './items.schemas';

export const itemsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/items', async (request) => {
    const query = parseWithSchema(itemListQuerySchema, request.query);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    return {
      data: await service.list(query),
    };
  });

  fastify.get('/items/:id', async (request) => {
    const params = parseWithSchema(itemIdParamsSchema, request.params);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    return {
      data: await service.getById(params.id),
    };
  });

  fastify.get('/items/:id/detail', async (request) => {
    const params = parseWithSchema(itemIdParamsSchema, request.params);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    return service.getByIdWithMovements(params.id);
  });

  fastify.post('/items', async (request, reply) => {
    const body = parseWithSchema(itemCreateBodySchema, request.body);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    const item = await service.create(body, request.user);
    return reply.status(201).send({ data: item });
  });

  fastify.put('/items/:id', async (request) => {
    const params = parseWithSchema(itemIdParamsSchema, request.params);
    const body = parseWithSchema(itemUpdateBodySchema, request.body);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    return {
      data: await service.update(params.id, body),
    };
  });

  fastify.delete('/items/:id', async (request) => {
    const params = parseWithSchema(itemIdParamsSchema, request.params);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    return {
      data: await service.remove(params.id),
    };
  });

  fastify.post('/items/:id/adjust-stock', async (request) => {
    fastify.requireRole(request, 'ADMIN');
    const params = parseWithSchema(itemIdParamsSchema, request.params);
    const body = parseWithSchema(stockAdjustmentBodySchema, request.body);
    const service = new ItemsService(new ItemsRepository(fastify.prisma));
    return {
      data: await service.adjustStock(params.id, body, request.user),
    };
  });
};
