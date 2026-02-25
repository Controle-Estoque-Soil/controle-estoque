import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';

import { parseWithSchema } from '../../utils/validation';
import { OperationsRepository } from './operations.repository';
import { OperationsService } from './operations.service';
import {
  movementListQuerySchema,
  movementIdParamsSchema,
  operationExecuteBodySchema,
  operationIdParamsSchema,
  operationListQuerySchema,
} from './operations.schemas';

function assertOverridePermission(
  fastify: FastifyInstance,
  request: FastifyRequest,
  allowNegativeOverride: boolean,
): void {
  if (allowNegativeOverride) {
    fastify.requireRole(request, 'ADMIN');
  }
}

export const operationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/operations/outbound/preview', async (request) => {
    const body = parseWithSchema(operationExecuteBodySchema, request.body);
    assertOverridePermission(fastify, request, body.allowNegativeOverride ?? false);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    return service.preview('OUTBOUND_PRODUCT', body);
  });

  fastify.post('/operations/inbound/preview', async (request) => {
    const body = parseWithSchema(operationExecuteBodySchema, request.body);
    assertOverridePermission(fastify, request, body.allowNegativeOverride ?? false);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    return service.preview('INBOUND_PRODUCT', body);
  });

  fastify.post('/operations/outbound', async (request, reply) => {
    const body = parseWithSchema(operationExecuteBodySchema, request.body);
    assertOverridePermission(fastify, request, body.allowNegativeOverride ?? false);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    const operation = await service.execute('OUTBOUND_PRODUCT', body, request.user);
    return reply.status(201).send({ data: operation });
  });

  fastify.post('/operations/inbound', async (request, reply) => {
    const body = parseWithSchema(operationExecuteBodySchema, request.body);
    assertOverridePermission(fastify, request, body.allowNegativeOverride ?? false);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    const operation = await service.execute('INBOUND_PRODUCT', body, request.user);
    return reply.status(201).send({ data: operation });
  });

  fastify.get('/operations', async (request) => {
    const query = parseWithSchema(operationListQuerySchema, request.query);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    return {
      data: await service.listOrders(query),
    };
  });

  fastify.get('/operations/:id', async (request) => {
    const params = parseWithSchema(operationIdParamsSchema, request.params);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    return {
      data: await service.getOrderById(params.id),
    };
  });

  fastify.get('/movements', async (request) => {
    const query = parseWithSchema(movementListQuerySchema, request.query);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    return {
      data: await service.listMovements(query),
    };
  });

  fastify.post('/movements/:id/undo', async (request, reply) => {
    const params = parseWithSchema(movementIdParamsSchema, request.params);
    const service = new OperationsService(new OperationsRepository(fastify.prisma));
    const result = await service.undoMovement(params.id, request.user);
    return reply.status(201).send({ data: result });
  });
};
