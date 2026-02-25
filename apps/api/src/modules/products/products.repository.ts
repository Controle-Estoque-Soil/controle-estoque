import { Prisma, type PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class ProductsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => callback(tx));
  }

  list(filters: { search?: string }) {
    return this.prisma.product.findMany({
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
      include: {
        _count: {
          select: { bomItems: true },
        },
        bomItems: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: true,
                qtyOnHand: true,
              },
            },
          },
          orderBy: [{ item: { name: 'asc' } }],
        },
      },
    });
  }

  getById(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
    });
  }

  getByIdWithBom(id: string, db: DbClient = this.prisma) {
    return db.product.findUnique({
      where: { id },
      include: {
        bomItems: {
          orderBy: [{ item: { name: 'asc' } }],
          include: {
            item: true,
          },
        },
      },
    });
  }

  create(
    data: {
      name: string;
      sku: string;
      manufacturingLeadTimeDays?: Prisma.Decimal | null;
      qtyInStock?: Prisma.Decimal;
      qtySoldTotal?: Prisma.Decimal;
    },
    db: DbClient = this.prisma,
  ) {
    return db.product.create({
      data,
    });
  }

  update(
    id: string,
    data: {
      name?: string;
      sku?: string;
      manufacturingLeadTimeDays?: Prisma.Decimal | null;
      qtyInStock?: Prisma.Decimal;
      qtySoldTotal?: Prisma.Decimal;
    },
    db: DbClient = this.prisma,
  ) {
    return db.product.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.product.delete({
      where: { id },
    });
  }

  countItemsByIds(itemIds: string[], db: DbClient = this.prisma): Promise<number> {
    return db.item.count({
      where: {
        id: { in: itemIds },
      },
    });
  }

  async replaceBom(
    productId: string,
    lines: Array<{ itemId: string; qtyRequired: Prisma.Decimal }>,
    db: DbClient = this.prisma,
  ): Promise<void> {
    await db.productBomItem.deleteMany({
      where: { productId },
    });

    if (lines.length > 0) {
      await db.productBomItem.createMany({
        data: lines.map((line) => ({
          productId,
          itemId: line.itemId,
          qtyRequired: line.qtyRequired,
        })),
      });
    }
  }
}
