import { Prisma } from '@prisma/client';

import { appErrors } from '../../core/app-error';
import type { JwtUserPayload } from '../../types/auth';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { MovementListQuery, OperationExecuteBody, OperationListQuery } from './operations.schemas';
import { OperationsRepository } from './operations.repository';

type OperationDirection = 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';

type ProductWithBom = Awaited<ReturnType<OperationsRepository['getProductWithBom']>>;
type OrderDetailRecord = NonNullable<Awaited<ReturnType<OperationsRepository['getOrderById']>>>;

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

export class OperationsService {
  constructor(private readonly operationsRepository: OperationsRepository) {}

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

      const detailedOrder = await this.operationsRepository.getOrderById(orderRecord.id, tx);
      if (!detailedOrder) {
        throw appErrors.internal('Failed to load created operation');
      }

      return detailedOrder;
    });

    return serializeOrderDetail(order);
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
      from: dateRange.from,
      to: dateRange.to,
    });

    return movements.map((movement) => ({
      id: movement.id,
      itemId: movement.itemId,
      deltaQty: decimalToString(movement.deltaQty) ?? '0',
      reason: movement.reason,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
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
        email: movement.createdByUser.email,
        role: movement.createdByUser.role,
      },
    }));
  }
}
