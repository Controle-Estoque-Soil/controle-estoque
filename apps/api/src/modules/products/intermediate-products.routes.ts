import type { FastifyPluginAsync } from 'fastify';

import { parseWithSchema } from '../../utils/validation';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';
import {
  productBomReplaceBodySchema,
  productCreateBodySchema,
  productDeleteQuerySchema,
  productIdParamsSchema,
  productListQuerySchema,
  productUpdateBodySchema,
} from './products.schemas';

export const intermediateProductsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/intermediate-products', async (request) => {
    const query = parseWithSchema(productListQuerySchema, request.query);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return {
      data: await service.list(query, 'INTERMEDIATE'),
    };
  });

  fastify.get('/intermediate-products/:id', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return service.getById(params.id, 'INTERMEDIATE');
  });

  fastify.post('/intermediate-products', async (request, reply) => {
    const body = parseWithSchema(productCreateBodySchema, request.body);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    const product = await service.create(body, 'INTERMEDIATE');
    return reply.status(201).send({ data: product });
  });

  fastify.put('/intermediate-products/:id', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const body = parseWithSchema(productUpdateBodySchema, request.body);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return {
      data: await service.update(params.id, body, request.user, 'INTERMEDIATE'),
    };
  });

  fastify.delete('/intermediate-products/:id', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const query = parseWithSchema(productDeleteQuerySchema, request.query);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return {
      data: await service.remove(params.id, 'INTERMEDIATE', { forceCascadeUsageDelete: query.forceCascadeUsageDelete }),
    };
  });

  fastify.put('/intermediate-products/:id/bom', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const body = parseWithSchema(productBomReplaceBodySchema, request.body);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return service.replaceBom(params.id, body, 'INTERMEDIATE');
  });
};
