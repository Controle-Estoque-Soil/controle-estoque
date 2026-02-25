import { Prisma, type PrismaClient, type ProductKind } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class ProductsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => callback(tx));
  }

  list(filters: { search?: string; kind?: ProductKind }) {
    return this.prisma.product.findMany({
      where: {
        kind: filters.kind,
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
          select: { bomItems: true, bomIntermediateProducts: true },
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
        bomIntermediateProducts: {
          include: {
            intermediateProduct: {
              include: {
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
            },
          },
          orderBy: [{ intermediateProduct: { name: 'asc' } }],
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
        bomIntermediateProducts: {
          orderBy: [{ intermediateProduct: { name: 'asc' } }],
          include: {
            intermediateProduct: {
              include: {
                bomItems: {
                  include: {
                    item: true,
                  },
                  orderBy: [{ item: { name: 'asc' } }],
                },
              },
            },
          },
        },
      },
    });
  }

  create(
    data: {
      kind: ProductKind;
      name: string;
      sku: string;
      manufacturingLeadTimeDays?: string | null;
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
      manufacturingLeadTimeDays?: string | null;
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

  getProductsByIds(productIds: string[], db: DbClient = this.prisma) {
    if (productIds.length === 0) {
      return Promise.resolve([]);
    }

    return db.product.findMany({
      where: {
        id: { in: productIds },
      },
    });
  }

  async replaceBom(
    productId: string,
    lines: Array<{ itemId: string; qtyRequired: Prisma.Decimal }>,
    intermediateLines: Array<{ intermediateProductId: string; qtyRequired: Prisma.Decimal }>,
    db: DbClient = this.prisma,
  ): Promise<void> {
    await db.productBomItem.deleteMany({
      where: { productId },
    });
    await db.productBomIntermediateProduct.deleteMany({
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

    if (intermediateLines.length > 0) {
      await db.productBomIntermediateProduct.createMany({
        data: intermediateLines.map((line) => ({
          productId,
          intermediateProductId: line.intermediateProductId,
          qtyRequired: line.qtyRequired,
        })),
      });
    }
  }
}
