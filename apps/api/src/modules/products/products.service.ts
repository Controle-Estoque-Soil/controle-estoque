import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { appErrors } from '../../core/app-error';
import type { JwtUserPayload } from '../../types/auth';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { ProductBomReplaceBody, ProductCreateBody, ProductListQuery, ProductUpdateBody } from './products.schemas';
import { ProductsRepository } from './products.repository';

function normalizeSku(sku?: string | null): string | undefined {
  const normalized = sku?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function resolveProductSkuForUpdate(sku?: string | null): string | undefined {
  if (sku === undefined) {
    return undefined;
  }

  return normalizeSku(sku) ?? generateAutoSku('PRD');
}

function generateAutoSku(prefix: 'PRD'): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function buildMovementReferenceCandidate(): string {
  return `MOV-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 16).toUpperCase()}`;
}

function serializeProduct(product: {
  id: string;
  name: string;
  sku: string;
  qtyInStock: Prisma.Decimal;
  qtySoldTotal: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
  _count?: { bomItems: number };
}) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    qtyInStock: decimalToString(product.qtyInStock) ?? '0',
    qtySoldTotal: decimalToString(product.qtySoldTotal) ?? '0',
    bomItemsCount: product._count?.bomItems,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

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

    throw new Error('Failed to generate unique stock movement reference id');
  }

  async list(query: ProductListQuery) {
    const products = await this.productsRepository.list({
      search: query.search?.trim() || undefined,
    });

    return products.map(serializeProduct);
  }

  async getById(id: string) {
    const product = await this.productsRepository.getByIdWithBom(id);
    if (!product) {
      throw appErrors.notFound('Product not found');
    }

    return {
      data: serializeProduct(product),
      bom: product.bomItems.map((bomItem) => ({
        id: bomItem.id,
        itemId: bomItem.itemId,
        qtyRequired: decimalToString(bomItem.qtyRequired) ?? '0',
        item: {
          id: bomItem.item.id,
          name: bomItem.item.name,
          sku: bomItem.item.sku,
          unit: bomItem.item.unit,
          unitPrice: decimalToString(bomItem.item.unitPrice) ?? '0',
          qtyOnHand: decimalToString(bomItem.item.qtyOnHand) ?? '0',
          minQty: decimalToString(bomItem.item.minQty),
        },
      })),
    };
  }

  async create(input: ProductCreateBody) {
    const product = await this.productsRepository.create({
      name: input.name.trim(),
      sku: normalizeSku(input.sku) ?? generateAutoSku('PRD'),
      qtyInStock: input.qtyInStock ? toDecimal(input.qtyInStock) : undefined,
      qtySoldTotal: input.qtySoldTotal ? toDecimal(input.qtySoldTotal) : undefined,
    });

    return serializeProduct(product);
  }

  async update(id: string, input: ProductUpdateBody, actor: JwtUserPayload) {
    const product = await this.productsRepository.transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { id },
      });

      if (!existing) {
        throw appErrors.notFound('Product not found');
      }

      const nextQtyInStock = input.qtyInStock !== undefined ? toDecimal(input.qtyInStock) : existing.qtyInStock;
      const qtyStockIncrease = nextQtyInStock.gt(existing.qtyInStock) ? nextQtyInStock.sub(existing.qtyInStock) : new Prisma.Decimal(0);

      if (qtyStockIncrease.gt(0)) {
        const productWithBom = await this.productsRepository.getByIdWithBom(id, tx);
        if (!productWithBom) {
          throw appErrors.notFound('Product not found');
        }

        if (productWithBom.bomItems.length === 0) {
          throw appErrors.badRequest(
            'Nao e possivel aumentar estoque de produto sem BOM. Cadastre a BOM antes de informar quantidade em estoque.',
          );
        }

        const itemIds = productWithBom.bomItems.map((bomItem) => bomItem.itemId).sort();
        await tx.$queryRaw`SELECT id FROM "items" WHERE id IN (${Prisma.join(itemIds)}) FOR UPDATE`;

        const currentItems = await tx.item.findMany({
          where: { id: { in: itemIds } },
        });
        const currentItemsMap = new Map(currentItems.map((item) => [item.id, item]));

        if (currentItems.length !== itemIds.length) {
          throw appErrors.badRequest('BOM references missing item(s)');
        }

        const movementReferenceId = await this.generateUniqueMovementReferenceId(tx);
        const stockMovementRows: Prisma.StockMovementCreateManyInput[] = [];

        for (const bomItem of productWithBom.bomItems) {
          const item = currentItemsMap.get(bomItem.itemId);
          if (!item) {
            throw appErrors.badRequest('BOM references missing item(s)');
          }

          const consumeQty = bomItem.qtyRequired.mul(qtyStockIncrease);
          const nextItemQty = item.qtyOnHand.sub(consumeQty);

          if (nextItemQty.isNegative()) {
            throw appErrors.conflict(
              `Estoque insuficiente para aumentar estoque do produto. Item: ${item.name} (disponivel ${decimalToString(item.qtyOnHand) ?? '0'})`,
            );
          }

          await tx.item.update({
            where: { id: item.id },
            data: { qtyOnHand: nextItemQty },
          });

          stockMovementRows.push({
            itemId: item.id,
            deltaQty: consumeQty.neg(),
            reason: 'MANUAL_ADJUSTMENT',
            referenceType: 'MANUAL_ADJUSTMENT',
            referenceId: movementReferenceId,
            note: `[PRODUTO_ESTOQUE] Consumo automatico por aumento de estoque do produto "${productWithBom.name}" (+${decimalToString(qtyStockIncrease) ?? '0'} un)`,
            createdByUserId: actor.sub,
          });
        }

        if (stockMovementRows.length > 0) {
          await tx.stockMovement.createMany({
            data: stockMovementRows,
          });
        }
      }

      return this.productsRepository.update(
        id,
        {
          name: input.name?.trim(),
          sku: resolveProductSkuForUpdate(input.sku),
          qtyInStock: input.qtyInStock !== undefined ? nextQtyInStock : undefined,
          qtySoldTotal: input.qtySoldTotal !== undefined ? toDecimal(input.qtySoldTotal) : undefined,
        },
        tx,
      );
    });

    return serializeProduct(product);
  }

  async remove(id: string) {
    const existing = await this.productsRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Product not found');
    }

    try {
      const product = await this.productsRepository.delete(id);
      return serializeProduct(product);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw appErrors.conflict('Produto nao pode ser removido porque possui ordens/movimentacoes vinculadas');
      }
      throw error;
    }
  }

  async replaceBom(productId: string, input: ProductBomReplaceBody) {
    const duplicateItemIds = new Set<string>();
    const seenItemIds = new Set<string>();

    for (const line of input.items) {
      if (seenItemIds.has(line.itemId)) {
        duplicateItemIds.add(line.itemId);
      }
      seenItemIds.add(line.itemId);
    }

    if (duplicateItemIds.size > 0) {
      throw appErrors.badRequest(`Duplicate itemId(s) in BOM: ${Array.from(duplicateItemIds).join(', ')}`);
    }

    await this.productsRepository.transaction(async (tx) => {
      const existingProduct = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!existingProduct) {
        throw appErrors.notFound('Product not found');
      }

      if (input.items.length > 0) {
        const itemIds = input.items.map((line) => line.itemId);
        const itemsCount = await this.productsRepository.countItemsByIds(itemIds, tx);

        if (itemsCount !== itemIds.length) {
          throw appErrors.badRequest('BOM contains itemId that does not exist');
        }
      }

      await this.productsRepository.replaceBom(
        productId,
        input.items.map((line) => ({
          itemId: line.itemId,
          qtyRequired: toDecimal(line.qtyRequired),
        })),
        tx,
      );
    });

    return this.getById(productId);
  }
}
