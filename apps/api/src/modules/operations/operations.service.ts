import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { appErrors } from '../../core/app-error';
import type { JwtUserPayload } from '../../types/auth';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { MovementListQuery, OperationExecuteBody, OperationListQuery } from './operations.schemas';
import { OperationsRepository } from './operations.repository';

type OperationDirection = 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';

type ProductWithBom = Awaited<ReturnType<OperationsRepository['getProductWithBom']>>;
type OrderDetailRecord = NonNullable<Awaited<ReturnType<OperationsRepository['getOrderById']>>>;
type MovementRecord = NonNullable<Awaited<ReturnType<OperationsRepository['getMovementById']>>>;

type PlannedLine = {
  itemId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  itemQty: Prisma.Decimal;
  itemUnitPriceSnapshot: Prisma.Decimal;
  lineCost: Prisma.Decimal;
  currentQtyOnHand: Prisma.Decimal;
  nextQtyOnHand: Prisma.Decimal;
};

type Shortage = {
  itemId: string;
  itemName: string;
  requiredQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
};

function ensurePositiveQty(qty: Prisma.Decimal): void {
  if (!qty.gt(0)) {
    throw appErrors.badRequest('qty must be greater than zero');
  }
}

function serializeOrderDetail(order: OrderDetailRecord) {
  return {
    id: order.id,
    type: order.type,
    productId: order.productId,
    productQty: decimalToString(order.productQty) ?? '0',
    totalCost: decimalToString(order.totalCost) ?? '0',
    unitCost: decimalToString(order.unitCost) ?? '0',
    note: order.note,
    createdAt: order.createdAt.toISOString(),
    product: {
      id: order.product.id,
      name: order.product.name,
      sku: order.product.sku,
    },
    createdByUser: {
      id: order.createdByUser.id,
      name: order.createdByUser.name,
      email: order.createdByUser.email,
      role: order.createdByUser.role,
    },
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemQty: decimalToString(line.itemQty) ?? '0',
      itemUnitPriceSnapshot: decimalToString(line.itemUnitPriceSnapshot) ?? '0',
      lineCost: decimalToString(line.lineCost) ?? '0',
      item: {
        id: line.item.id,
        name: line.item.name,
        sku: line.item.sku,
        unit: line.item.unit,
      },
    })),
  };
}

function parseDateRange(input: { from?: string; to?: string }) {
  return {
    from: input.from ? new Date(input.from) : undefined,
    to: input.to ? new Date(input.to) : undefined,
  };
}

function buildMovementReferenceCandidate(): string {
  return `MOV-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 16).toUpperCase()}`;
}

export class OperationsService {
  constructor(private readonly operationsRepository: OperationsRepository) {}

  private async generateUniqueMovementReferenceId(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = buildMovementReferenceCandidate();
      const existing = await tx.stockMovement.findFirst({
        where: { referenceId: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw appErrors.internal('Failed to generate unique movement reference');
  }

  private buildUndoMovementNote(originalMovement: MovementRecord) {
    const originalNote = originalMovement.note?.trim();
    return [`[UNDO_MOVEMENT:${originalMovement.id}]`, originalNote].filter(Boolean).join(' ');
  }

  private buildUndoOrderNote(order: OrderDetailRecord) {
    const originalNote = order.note?.trim();
    return [`[UNDO_ORDER:${order.id}]`, originalNote].filter(Boolean).join(' ');
  }

  private async buildPlan(
    type: OperationDirection,
    input: OperationExecuteBody,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    product: NonNullable<ProductWithBom>;
    productQty: Prisma.Decimal;
    lines: PlannedLine[];
    totalCost: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    shortages: Shortage[];
  }> {
    const productQty = toDecimal(input.qty);
    ensurePositiveQty(productQty);

    const product = await this.operationsRepository.getProductWithBom(input.productId, tx);

    if (!product) {
      throw appErrors.notFound('Product not found');
    }

    if (product.bomItems.length === 0) {
      throw appErrors.badRequest('Product BOM is empty');
    }

    const itemIds = product.bomItems.map((bomItem) => bomItem.itemId).sort();
    if (tx) {
      await this.operationsRepository.lockItems(itemIds, tx);
    }

    const currentItems = await this.operationsRepository.getItemsByIds(itemIds, tx);
    const currentItemsMap = new Map(currentItems.map((item) => [item.id, item]));

    if (currentItems.length !== itemIds.length) {
      throw appErrors.badRequest('Product BOM references missing item(s)');
    }

    let totalCost = new Prisma.Decimal(0);
    const shortages: Shortage[] = [];

    const lines: PlannedLine[] = product.bomItems.map((bomItem) => {
      const currentItem = currentItemsMap.get(bomItem.itemId);
      if (!currentItem) {
        throw appErrors.badRequest('Product BOM references missing item(s)');
      }

      const itemQty = bomItem.qtyRequired.mul(productQty);
      const lineCost = itemQty.mul(currentItem.unitPrice);
      totalCost = totalCost.add(lineCost);

      const nextQtyOnHand =
        type === 'OUTBOUND_PRODUCT' ? currentItem.qtyOnHand.sub(itemQty) : currentItem.qtyOnHand.add(itemQty);

      if (type === 'OUTBOUND_PRODUCT' && nextQtyOnHand.isNegative()) {
        shortages.push({
          itemId: currentItem.id,
          itemName: currentItem.name,
          requiredQty: itemQty,
          availableQty: currentItem.qtyOnHand,
        });
      }

      return {
        itemId: currentItem.id,
        itemName: currentItem.name,
        itemSku: currentItem.sku,
        itemUnit: currentItem.unit,
        itemQty,
        itemUnitPriceSnapshot: currentItem.unitPrice,
        lineCost,
        currentQtyOnHand: currentItem.qtyOnHand,
        nextQtyOnHand,
      };
    });

    return {
      product,
      productQty,
      lines,
      totalCost,
      unitCost: totalCost.div(productQty),
      shortages,
    };
  }

  async preview(type: OperationDirection, input: OperationExecuteBody) {
    const plan = await this.buildPlan(type, input);

    return {
      type,
      product: {
        id: plan.product.id,
        name: plan.product.name,
        sku: plan.product.sku,
      },
      productQty: decimalToString(plan.productQty) ?? '0',
      totalCost: decimalToString(plan.totalCost) ?? '0',
      unitCost: decimalToString(plan.unitCost) ?? '0',
      canExecute: plan.shortages.length === 0 || input.allowNegativeOverride,
      shortages: plan.shortages.map((shortage) => ({
        itemId: shortage.itemId,
        itemName: shortage.itemName,
        requiredQty: decimalToString(shortage.requiredQty) ?? '0',
        availableQty: decimalToString(shortage.availableQty) ?? '0',
      })),
      lines: plan.lines.map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        itemUnit: line.itemUnit,
        itemQty: decimalToString(line.itemQty) ?? '0',
        itemUnitPriceSnapshot: decimalToString(line.itemUnitPriceSnapshot) ?? '0',
        lineCost: decimalToString(line.lineCost) ?? '0',
        currentQtyOnHand: decimalToString(line.currentQtyOnHand) ?? '0',
        nextQtyOnHand: decimalToString(line.nextQtyOnHand) ?? '0',
      })),
    };
  }

  async execute(type: OperationDirection, input: OperationExecuteBody, actor: JwtUserPayload) {
    const order = await this.operationsRepository.transaction(async (tx) => {
      const plan = await this.buildPlan(type, input, tx);

      if (type === 'OUTBOUND_PRODUCT' && plan.shortages.length > 0 && !input.allowNegativeOverride) {
        throw appErrors.conflict('Insufficient stock for operation');
      }

      const orderRecord = await this.operationsRepository.createProductOrder(
        {
          type,
          productId: plan.product.id,
          productQty: plan.productQty,
          totalCost: plan.totalCost,
          unitCost: plan.unitCost,
          note: input.note ?? null,
          createdByUserId: actor.sub,
        },
        tx,
      );

      await this.operationsRepository.createProductOrderLines(
        orderRecord.id,
        plan.lines.map((line) => ({
          itemId: line.itemId,
          itemQty: line.itemQty,
          itemUnitPriceSnapshot: line.itemUnitPriceSnapshot,
          lineCost: line.lineCost,
        })),
        tx,
      );

      for (const line of plan.lines) {
        await this.operationsRepository.updateItemQty(line.itemId, line.nextQtyOnHand, tx);
      }

      await this.operationsRepository.createStockMovements(
        plan.lines.map((line) => ({
          itemId: line.itemId,
          deltaQty: type === 'OUTBOUND_PRODUCT' ? line.itemQty.neg() : line.itemQty,
          reason: type === 'OUTBOUND_PRODUCT' ? 'PRODUCT_OUTBOUND' : 'PRODUCT_INBOUND',
          referenceId: orderRecord.id,
          note: input.note ?? null,
          createdByUserId: actor.sub,
        })),
        tx,
      );

      if (type === 'OUTBOUND_PRODUCT') {
        await this.operationsRepository.incrementProductSoldTotal(plan.product.id, plan.productQty, tx);
      }

      const detailedOrder = await this.operationsRepository.getOrderById(orderRecord.id, tx);
      if (!detailedOrder) {
        throw appErrors.internal('Failed to load created operation');
      }

      return detailedOrder;
    });

    return serializeOrderDetail(order);
  }

  async undoMovement(id: string, actor: JwtUserPayload) {
    const result = await this.operationsRepository.transaction(async (tx) => {
      const movement = await this.operationsRepository.getMovementById(id, tx);
      if (!movement) {
        throw appErrors.notFound('Movimentacao nao encontrada');
      }

      if (movement.referenceType === 'PRODUCT_ORDER' && movement.referenceId) {
        return this.undoProductOrderMovement(movement, actor, tx);
      }

      return this.undoItemMovement(movement, actor, tx);
    });

    return result;
  }

  private async undoItemMovement(movement: MovementRecord, actor: JwtUserPayload, tx: Prisma.TransactionClient) {
    if (movement.note?.startsWith('[PRODUTO_ESTOQUE]')) {
      throw appErrors.conflict(
        'Nao e possivel desfazer individualmente uma movimentacao automatica de produto em estoque. Ajuste o produto novamente.',
      );
    }

    if (movement.reversalOfMovementId) {
      throw appErrors.conflict('Nao e permitido desfazer uma movimentacao de reversao');
    }

    const existingReversal = await this.operationsRepository.getMovementReversalByOriginalId(movement.id, tx);
    if (existingReversal) {
      throw appErrors.conflict('Movimentacao ja foi desfeita');
    }

    await this.operationsRepository.lockItems([movement.itemId], tx);
    const [item] = await this.operationsRepository.getItemsByIds([movement.itemId], tx);
    if (!item) {
      throw appErrors.notFound('Item da movimentacao nao encontrado');
    }

    const inverseDelta = movement.deltaQty.neg();
    const nextQty = item.qtyOnHand.add(inverseDelta);
    if (nextQty.isNegative()) {
      throw appErrors.conflict('Nao e possivel desfazer: o item ficaria com estoque negativo');
    }

    await this.operationsRepository.updateItemQty(item.id, nextQty, tx);

    const movementReferenceId = await this.generateUniqueMovementReferenceId(tx);
    const reversalMovement = await tx.stockMovement.create({
      data: {
        itemId: item.id,
        deltaQty: inverseDelta,
        reason: 'MANUAL_ADJUSTMENT',
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: movementReferenceId,
        reversalOfMovementId: movement.id,
        note: this.buildUndoMovementNote(movement),
        createdByUserId: actor.sub,
      },
      include: {
        item: true,
        createdByUser: true,
      },
    });

    return {
      kind: 'ITEM_MOVEMENT' as const,
      originalMovementId: movement.id,
      reversalMovementId: reversalMovement.id,
      referenceId: reversalMovement.referenceId,
      item: {
        id: reversalMovement.item.id,
        name: reversalMovement.item.name,
        sku: reversalMovement.item.sku,
        unit: reversalMovement.item.unit,
      },
      deltaQty: decimalToString(reversalMovement.deltaQty) ?? '0',
    };
  }

  private async undoProductOrderMovement(movement: MovementRecord, actor: JwtUserPayload, tx: Prisma.TransactionClient) {
    const orderId = movement.referenceId;
    if (!orderId) {
      throw appErrors.badRequest('Movimentacao de produto sem referencia de ordem');
    }

    const order = await this.operationsRepository.getOrderById(orderId, tx);
    if (!order) {
      throw appErrors.notFound('Ordem da movimentacao nao encontrada');
    }

    if (order.reversalOfOrderId) {
      throw appErrors.conflict('Nao e permitido desfazer uma ordem de reversao');
    }

    const existingReversalOrder = await this.operationsRepository.getOrderReversalByOriginalId(order.id, tx);
    if (existingReversalOrder) {
      throw appErrors.conflict('Movimentacao de produto ja foi desfeita');
    }

    await this.operationsRepository.lockProduct(order.productId, tx);

    const itemIds = Array.from(new Set(order.lines.map((line) => line.itemId))).sort();
    if (itemIds.length > 0) {
      await this.operationsRepository.lockItems(itemIds, tx);
    }

    const items = await this.operationsRepository.getItemsByIds(itemIds, tx);
    const itemsMap = new Map(items.map((item) => [item.id, item]));
    if (items.length !== itemIds.length) {
      throw appErrors.badRequest('A ordem referencia item(s) inexistente(s)');
    }

    for (const line of order.lines) {
      const currentItem = itemsMap.get(line.itemId);
      if (!currentItem) {
        throw appErrors.badRequest('A ordem referencia item(s) inexistente(s)');
      }

      const inverseDelta = order.type === 'OUTBOUND_PRODUCT' ? line.itemQty : line.itemQty.neg();
      const nextQty = currentItem.qtyOnHand.add(inverseDelta);
      if (nextQty.isNegative()) {
        throw appErrors.conflict(`Nao e possivel desfazer: item ${currentItem.name} ficaria com estoque negativo`);
      }

      await this.operationsRepository.updateItemQty(currentItem.id, nextQty, tx);
    }

    if (order.type === 'OUTBOUND_PRODUCT') {
      const product = await this.operationsRepository.getProductById(order.productId, tx);
      if (!product) {
        throw appErrors.notFound('Produto da ordem nao encontrado');
      }

      const nextSoldTotal = Prisma.Decimal.max(product.qtySoldTotal.sub(order.productQty), new Prisma.Decimal(0));

      await this.operationsRepository.updateProductQtyCounters(
        product.id,
        {
          qtySoldTotal: nextSoldTotal,
        },
        tx,
      );
    }

    const reversalType: OperationDirection = order.type === 'OUTBOUND_PRODUCT' ? 'INBOUND_PRODUCT' : 'OUTBOUND_PRODUCT';
    const undoNote = this.buildUndoOrderNote(order);
    const reversalOrder = await this.operationsRepository.createProductOrder(
      {
        type: reversalType,
        productId: order.productId,
        productQty: order.productQty,
        totalCost: order.totalCost ?? new Prisma.Decimal(0),
        unitCost: order.unitCost ?? new Prisma.Decimal(0),
        note: undoNote,
        reversalOfOrderId: order.id,
        createdByUserId: actor.sub,
      },
      tx,
    );

    await this.operationsRepository.createProductOrderLines(
      reversalOrder.id,
      order.lines.map((line) => ({
        itemId: line.itemId,
        itemQty: line.itemQty,
        itemUnitPriceSnapshot: line.itemUnitPriceSnapshot,
        lineCost: line.lineCost,
      })),
      tx,
    );

    await this.operationsRepository.createStockMovements(
      order.lines.map((line) => ({
        itemId: line.itemId,
        deltaQty: order.type === 'OUTBOUND_PRODUCT' ? line.itemQty : line.itemQty.neg(),
        reason: order.type === 'OUTBOUND_PRODUCT' ? 'PRODUCT_INBOUND' : 'PRODUCT_OUTBOUND',
        referenceId: reversalOrder.id,
        note: undoNote,
        createdByUserId: actor.sub,
      })),
      tx,
    );

    return {
      kind: 'PRODUCT_ORDER' as const,
      originalOrderId: order.id,
      reversalOrderId: reversalOrder.id,
      product: {
        id: order.product.id,
        name: order.product.name,
        sku: order.product.sku,
      },
      type: reversalType,
      productQty: decimalToString(order.productQty) ?? '0',
    };
  }

  async listOrders(query: OperationListQuery) {
    const dateRange = parseDateRange(query);
    const orders = await this.operationsRepository.listOrders({
      type: query.type,
      productId: query.productId,
      from: dateRange.from,
      to: dateRange.to,
    });

    return orders.map((order) => ({
      id: order.id,
      type: order.type,
      productQty: decimalToString(order.productQty) ?? '0',
      totalCost: decimalToString(order.totalCost) ?? '0',
      unitCost: decimalToString(order.unitCost) ?? '0',
      createdAt: order.createdAt.toISOString(),
      note: order.note,
      product: {
        id: order.product.id,
        name: order.product.name,
        sku: order.product.sku,
      },
      createdByUser: {
        id: order.createdByUser.id,
        name: order.createdByUser.name,
        email: order.createdByUser.email,
        role: order.createdByUser.role,
      },
      linesCount: order._count.lines,
    }));
  }

  async getOrderById(id: string) {
    const order = await this.operationsRepository.getOrderById(id);
    if (!order) {
      throw appErrors.notFound('Operation not found');
    }

    return serializeOrderDetail(order);
  }

  async listMovements(query: MovementListQuery) {
    const dateRange = parseDateRange(query);
    const movements = await this.operationsRepository.listMovements({
      itemId: query.itemId,
      reason: query.reason,
      reference: query.reference?.trim() || undefined,
      from: dateRange.from,
      to: dateRange.to,
    });

    const productOrderIds = Array.from(
      new Set(
        movements
          .filter((movement) => movement.referenceType === 'PRODUCT_ORDER' && movement.referenceId)
          .map((movement) => movement.referenceId as string),
      ),
    );

    const productOrders = await this.operationsRepository.getOrdersByIds(productOrderIds);
    const productOrdersMap = new Map(productOrders.map((order) => [order.id, order]));
    const productOrderReversals = await this.operationsRepository.getOrderReversalsByOriginalIds(productOrderIds);
    const productOrderReversalByOriginalId = new Map(productOrderReversals.map((order) => [order.reversalOfOrderId as string, order]));

    const manualMovementIds = movements
      .filter((movement) => movement.referenceType !== 'PRODUCT_ORDER')
      .map((movement) => movement.id);
    const movementReversals = await this.operationsRepository.getMovementReversalsByOriginalIds(manualMovementIds);
    const movementReversalByOriginalId = new Map(
      movementReversals.map((movement) => [movement.reversalOfMovementId as string, movement]),
    );

    return movements.map((movement) => ({
      productOrder:
        movement.referenceType === 'PRODUCT_ORDER' && movement.referenceId
          ? (() => {
              const order = productOrdersMap.get(movement.referenceId);
              if (!order) {
                return null;
              }
              const reversalOrder = productOrderReversalByOriginalId.get(order.id);
              return {
                id: order.id,
                type: order.type,
                productQty: decimalToString(order.productQty) ?? '0',
                reversalOfOrderId: order.reversalOfOrderId,
                isReversal: Boolean(order.reversalOfOrderId),
                isUndone: Boolean(reversalOrder),
                reversalOrderId: reversalOrder?.id ?? null,
                product: {
                  id: order.product.id,
                  name: order.product.name,
                  sku: order.product.sku,
                },
              };
            })()
          : null,
      id: movement.id,
      itemId: movement.itemId,
      deltaQty: decimalToString(movement.deltaQty) ?? '0',
      reason: movement.reason,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      reversalOfMovementId: movement.reversalOfMovementId,
      isReversal: Boolean(movement.reversalOfMovementId),
      isUndone:
        movement.referenceType === 'PRODUCT_ORDER'
          ? Boolean(movement.referenceId && productOrderReversalByOriginalId.has(movement.referenceId))
          : movementReversalByOriginalId.has(movement.id),
      reversalMovementId: movement.referenceType === 'PRODUCT_ORDER' ? null : movementReversalByOriginalId.get(movement.id)?.id ?? null,
      note: movement.note,
      createdAt: movement.createdAt.toISOString(),
      item: {
        id: movement.item.id,
        name: movement.item.name,
        sku: movement.item.sku,
        unit: movement.item.unit,
      },
      createdByUser: {
        id: movement.createdByUser.id,
        name: movement.createdByUser.name,
        email: movement.createdByUser.email,
        role: movement.createdByUser.role,
      },
    }));
  }
}
