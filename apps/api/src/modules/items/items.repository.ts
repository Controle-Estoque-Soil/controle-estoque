import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type StockMovementReason, type StockMovementReferenceType } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ItemCreateRecordInput {
  name: string;
  sku: string;
  unit: string;
  unitPrice: Prisma.Decimal;
  purchaseLeadTimeDays?: Prisma.Decimal | null;
  qtyOnHand: Prisma.Decimal;
  minQty?: Prisma.Decimal | null;
  purchaseSources?: ItemPurchaseSourceRecordInput[];
}

export interface ItemUpdateRecordInput {
  name?: string;
  sku?: string;
  unit?: string;
  unitPrice?: Prisma.Decimal;
  purchaseLeadTimeDays?: Prisma.Decimal | null;
  qtyOnHand?: Prisma.Decimal;
  minQty?: Prisma.Decimal | null;
  purchaseSources?: ItemPurchaseSourceRecordInput[];
}

export interface ItemPurchaseSourceRecordInput {
  source?: string | null;
  price?: Prisma.Decimal | null;
  sortOrder: number;
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

  private buildMovementReferenceCandidate(): string {
    return `MOV-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 16).toUpperCase()}`;
  }

  private async generateUniqueMovementReferenceId(db: DbClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = this.buildMovementReferenceCandidate();
      const existing = await db.stockMovement.findFirst({
        where: { referenceId: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new Error('Failed to generate unique stock movement reference id');
  }

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
      include: {
        purchaseSources: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }],
    });
  }

  getById(id: string) {
    return this.prisma.item.findUnique({
      where: { id },
      include: {
        purchaseSources: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  getByIdWithMovements(id: string) {
    return this.prisma.item.findUnique({
      where: { id },
      include: {
        purchaseSources: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
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
        purchaseLeadTimeDays: data.purchaseLeadTimeDays ?? null,
        qtyOnHand: data.qtyOnHand,
        minQty: data.minQty ?? null,
        purchaseSources: data.purchaseSources
          ? {
              create: data.purchaseSources.map((source) => ({
                source: source.source ?? null,
                price: source.price ?? null,
                sortOrder: source.sortOrder,
              })),
            }
          : undefined,
      },
      include: {
        purchaseSources: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  update(id: string, data: ItemUpdateRecordInput, db: DbClient = this.prisma) {
    return db.item.update({
      where: { id },
      data: {
        ...data,
        purchaseSources:
          data.purchaseSources === undefined
            ? undefined
            : {
                deleteMany: {},
                create: data.purchaseSources.map((source) => ({
                  source: source.source ?? null,
                  price: source.price ?? null,
                  sortOrder: source.sortOrder,
                })),
              },
      },
      include: {
        purchaseSources: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  delete(id: string) {
    return this.prisma.item.delete({
      where: { id },
      include: {
        purchaseSources: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  async createMovement(data: MovementCreateRecordInput, db: DbClient = this.prisma) {
    const referenceId = data.referenceId ?? (await this.generateUniqueMovementReferenceId(db));

    return db.stockMovement.create({
      data: {
        itemId: data.itemId,
        deltaQty: data.deltaQty,
        reason: data.reason,
        referenceType: data.referenceType,
        referenceId,
        note: data.note ?? null,
        createdByUserId: data.createdByUserId,
      },
      include: {
        createdByUser: true,
      },
    });
  }
}
