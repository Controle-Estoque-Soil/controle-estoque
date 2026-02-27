import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';

import { parseWithSchema } from '../../utils/validation';
import { OperationsRepository } from './operations.repository';
import { OutboundOperationEmailService } from './outbound-operation-email.service';
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
  const outboundEmailService = new OutboundOperationEmailService(fastify.config, fastify.log);

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
    fastify.log.info(
      {
        operationId: operation.id,
        productId: operation.product.id,
        productKind: operation.product.kind,
        productName: operation.product.name,
        productQty: operation.productQty,
        actorUserId: request.user.sub,
      },
      'Outbound operation confirmed; dispatching operation email',
    );
    await outboundEmailService.sendProductOutbound({
      referenceId: operation.id,
      scopeLabel: operation.product.kind === 'INTERMEDIATE' ? 'Produto intermediario' : 'Produto',
      productName: operation.product.name,
      productSku: operation.product.sku,
      productQty: operation.productQty,
      totalCost: operation.totalCost,
      unitCost: operation.unitCost,
      note: operation.note,
      createdAt: operation.createdAt,
      actorName: operation.createdByUser.name ?? null,
      actorEmail: operation.createdByUser.email,
      lines: operation.lines.map((line) => ({
        itemName: line.item.name,
        itemSku: line.item.sku,
        itemUnit: line.item.unit,
        itemQty: line.itemQty,
        itemUnitPriceSnapshot: line.itemUnitPriceSnapshot,
        lineCost: line.lineCost,
      })),
    });
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
