import { Prisma, type PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => callback(tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  getProductWithBom(productId: string, db: DbClient = this.prisma) {
    return db.product.findUnique({
      where: { id: productId },
      include: {
        bomItems: {
          include: {
            item: true,
          },
          orderBy: [{ item: { name: 'asc' } }],
        },
      },
    });
  }

  lockItems(itemIds: string[], db: Prisma.TransactionClient) {
    return db.$queryRaw`SELECT id FROM "items" WHERE id IN (${Prisma.join(itemIds)}) FOR UPDATE`;
  }

  getItemsByIds(itemIds: string[], db: DbClient = this.prisma) {
    return db.item.findMany({
      where: {
        id: { in: itemIds },
      },
    });
  }

  updateItemQty(id: string, qtyOnHand: Prisma.Decimal, db: DbClient = this.prisma) {
    return db.item.update({
      where: { id },
      data: { qtyOnHand },
    });
  }

  createProductOrder(
    data: {
      type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
      productId: string;
      productQty: Prisma.Decimal;
      totalCost: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      note?: string | null;
      createdByUserId: string;
    },
    db: DbClient = this.prisma,
  ) {
    return db.productOrder.create({
      data: {
        type: data.type,
        productId: data.productId,
        productQty: data.productQty,
        totalCost: data.totalCost,
        unitCost: data.unitCost,
        note: data.note ?? null,
        createdByUserId: data.createdByUserId,
      },
    });
  }

  createProductOrderLines(
    orderId: string,
    lines: Array<{
      itemId: string;
      itemQty: Prisma.Decimal;
      itemUnitPriceSnapshot: Prisma.Decimal;
      lineCost: Prisma.Decimal;
    }>,
    db: DbClient = this.prisma,
  ) {
    if (lines.length === 0) {
      return Promise.resolve({ count: 0 });
    }

    return db.productOrderLine.createMany({
      data: lines.map((line) => ({
        orderId,
        itemId: line.itemId,
        itemQty: line.itemQty,
        itemUnitPriceSnapshot: line.itemUnitPriceSnapshot,
        lineCost: line.lineCost,
      })),
    });
  }

  createStockMovements(
    movements: Array<{
      itemId: string;
      deltaQty: Prisma.Decimal;
      reason: 'PRODUCT_INBOUND' | 'PRODUCT_OUTBOUND';
      referenceId: string;
      note?: string | null;
      createdByUserId: string;
    }>,
    db: DbClient = this.prisma,
  ) {
    if (movements.length === 0) {
      return Promise.resolve({ count: 0 });
    }

    return db.stockMovement.createMany({
      data: movements.map((movement) => ({
        itemId: movement.itemId,
        deltaQty: movement.deltaQty,
        reason: movement.reason,
        referenceType: 'PRODUCT_ORDER',
        referenceId: movement.referenceId,
        note: movement.note ?? null,
        createdByUserId: movement.createdByUserId,
      })),
    });
  }

  listMovements(filters: {
    itemId?: string;
    reason?: 'MANUAL_ADJUSTMENT' | 'PRODUCT_INBOUND' | 'PRODUCT_OUTBOUND';
    reference?: string;
    from?: Date;
    to?: Date;
  }) {
    return this.prisma.stockMovement.findMany({
      where: {
        itemId: filters.itemId,
        reason: filters.reason,
        referenceId: filters.reference
          ? {
              contains: filters.reference,
              mode: 'insensitive',
            }
          : undefined,
        createdAt:
          filters.from || filters.to
            ? {
                gte: filters.from,
                lte: filters.to,
              }
            : undefined,
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        item: true,
        createdByUser: true,
      },
      take: 200,
    });
  }

  listOrders(filters: {
    type?: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
    productId?: string;
    from?: Date;
    to?: Date;
  }) {
    return this.prisma.productOrder.findMany({
      where: {
        type: filters.type,
        productId: filters.productId,
        createdAt:
          filters.from || filters.to
            ? {
                gte: filters.from,
                lte: filters.to,
              }
            : undefined,
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        product: true,
        createdByUser: true,
        _count: {
          select: {
            lines: true,
          },
        },
      },
      take: 200,
    });
  }

  getOrdersByIds(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.productOrder.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      include: {
        product: true,
      },
    });
  }

  getOrderById(id: string, db: DbClient = this.prisma) {
    return db.productOrder.findUnique({
      where: { id },
      include: {
        product: true,
        createdByUser: true,
        lines: {
          include: {
            item: true,
          },
          orderBy: [{ item: { name: 'asc' } }],
        },
      },
    });
  }
}
