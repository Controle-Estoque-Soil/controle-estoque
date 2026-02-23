import type { FastifyPluginAsync } from 'fastify';

import { parseWithSchema } from '../../utils/validation';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';
import {
  productBomReplaceBodySchema,
  productCreateBodySchema,
  productIdParamsSchema,
  productListQuerySchema,
  productUpdateBodySchema,
} from './products.schemas';

export const productsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/products', async (request) => {
    const query = parseWithSchema(productListQuerySchema, request.query);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return {
      data: await service.list(query),
    };
  });

  fastify.get('/products/:id', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return service.getById(params.id);
  });

  fastify.post('/products', async (request, reply) => {
    const body = parseWithSchema(productCreateBodySchema, request.body);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    const product = await service.create(body);
    return reply.status(201).send({ data: product });
  });

  fastify.put('/products/:id', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const body = parseWithSchema(productUpdateBodySchema, request.body);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return {
      data: await service.update(params.id, body),
    };
  });

  fastify.delete('/products/:id', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return {
      data: await service.remove(params.id),
    };
  });

  fastify.put('/products/:id/bom', async (request) => {
    const params = parseWithSchema(productIdParamsSchema, request.params);
    const body = parseWithSchema(productBomReplaceBodySchema, request.body);
    const service = new ProductsService(new ProductsRepository(fastify.prisma));
    return service.replaceBom(params.id, body);
  });
};
