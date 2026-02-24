import { Prisma, type PrismaClient, type StockMovementReason, type StockMovementReferenceType } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ItemCreateRecordInput {
  name: string;
  sku: string;
  unit: string;
  unitPrice: Prisma.Decimal;
  qtyOnHand: Prisma.Decimal;
  minQty?: Prisma.Decimal | null;
}

export interface ItemUpdateRecordInput {
  name?: string;
  sku?: string;
  unit?: string;
  unitPrice?: Prisma.Decimal;
  minQty?: Prisma.Decimal | null;
}

export interface MovementCreateRecordInput {
  itemId: string;
  deltaQty: Prisma.Decimal;
  reason: StockMovementReason;
  referenceType: StockMovementReferenceType;
  referenceId?: string | null;
  note?: string | null;
  createdByUserId: string;
}

export class ItemsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => callback(tx));
  }

  list(filters: { search?: string }) {
    return this.prisma.item.findMany({
      where: {
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { sku: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
    });
  }

  getById(id: string) {
    return this.prisma.item.findUnique({
      where: { id },
    });
  }

  getByIdWithMovements(id: string) {
    return this.prisma.item.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            createdByUser: true,
          },
        },
      },
    });
  }

  create(data: ItemCreateRecordInput, db: DbClient = this.prisma) {
    return db.item.create({
      data: {
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        unitPrice: data.unitPrice,
        qtyOnHand: data.qtyOnHand,
        minQty: data.minQty ?? null,
      },
    });
  }

  update(id: string, data: ItemUpdateRecordInput, db: DbClient = this.prisma) {
    return db.item.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.item.delete({
      where: { id },
    });
  }

  createMovement(data: MovementCreateRecordInput, db: DbClient = this.prisma) {
    return db.stockMovement.create({
      data: {
        itemId: data.itemId,
        deltaQty: data.deltaQty,
        reason: data.reason,
        referenceType: data.referenceType,
        referenceId: data.referenceId ?? null,
        note: data.note ?? null,
        createdByUserId: data.createdByUserId,
      },
      include: {
        createdByUser: true,
      },
    });
  }
}
