import { randomUUID } from 'node:crypto';
import { Prisma, type ProductKind } from '@prisma/client';
import { AppError, appErrors } from '../../core/app-error';
import type { JwtUserPayload } from '../../types/auth';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { ProductBomReplaceBody, ProductCreateBody, ProductListQuery, ProductUpdateBody } from './products.schemas';
import { ProductsRepository } from './products.repository';

type ProductForCapacity = {
  bomItems: Array<{
    itemId: string;
    qtyRequired: Prisma.Decimal;
    item: {
      id: string;
      name: string;
      sku: string;
      unit: string;
      qtyOnHand: Prisma.Decimal;
    };
  }>;
  bomIntermediateProducts: Array<{
    intermediateProductId: string;
    qtyRequired: Prisma.Decimal;
    intermediateProduct: {
      id: string;
      kind: ProductKind;
      name: string;
      sku: string;
      bomItems: Array<{
        itemId: string;
        qtyRequired: Prisma.Decimal;
        item: {
          id: string;
          name: string;
          sku: string;
          unit: string;
          qtyOnHand: Prisma.Decimal;
        };
      }>;
    };
  }>;
};

type FlattenedBomItemRequirement = {
  itemId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  itemQtyOnHand: Prisma.Decimal;
  qtyRequiredPerProduct: Prisma.Decimal;
};

type FlattenBomResult = {
  lines: FlattenedBomItemRequirement[];
  notes: string[];
};

type ProductWithBomForStockConsumption = ProductForCapacity & {
  id: string;
  kind: ProductKind;
  name: string;
};

function normalizeSku(sku?: string | null): string | undefined {
  const normalized = sku?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function getSkuPrefix(kind: ProductKind): 'PRD' | 'INT' {
  return kind === 'INTERMEDIATE' ? 'INT' : 'PRD';
}

function resolveProductSkuForUpdate(sku: string | null | undefined, kind: ProductKind): string | undefined {
  if (sku === undefined) {
    return undefined;
  }

  return normalizeSku(sku) ?? generateAutoSku(getSkuPrefix(kind));
}

function normalizeOptionalLeadTime(value?: string | null): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function generateAutoSku(prefix: 'PRD' | 'INT'): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function serializeProduct(product: {
  id: string;
  kind: ProductKind;
  name: string;
  sku: string;
  manufacturingLeadTimeDays: string | null;
  qtyInStock: Prisma.Decimal;
  qtySoldTotal: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
  _count?: { bomItems: number; bomIntermediateProducts: number };
}) {
  const bomItemsCount = product._count?.bomItems;
  const bomIntermediateProductsCount = product._count?.bomIntermediateProducts ?? 0;
  return {
    id: product.id,
    kind: product.kind,
    name: product.name,
    sku: product.sku,
    manufacturingLeadTimeDays: product.manufacturingLeadTimeDays,
    qtyInStock: decimalToString(product.qtyInStock) ?? '0',
    qtySoldTotal: decimalToString(product.qtySoldTotal) ?? '0',
    bomItemsCount,
    bomIntermediateProductsCount,
    bomComponentsCount: (bomItemsCount ?? 0) + bomIntermediateProductsCount,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function ensureExpectedKind(product: { kind: ProductKind }, expectedKind?: ProductKind) {
  if (expectedKind && product.kind !== expectedKind) {
    throw appErrors.notFound('Product not found');
  }
}

function flattenProductBom(product: ProductForCapacity): FlattenBomResult {
  const notes: string[] = [];
  const aggregated = new Map<string, FlattenedBomItemRequirement>();

  for (const line of product.bomItems) {
    const existing = aggregated.get(line.itemId);
    if (existing) {
      existing.qtyRequiredPerProduct = existing.qtyRequiredPerProduct.add(line.qtyRequired);
      continue;
    }

    aggregated.set(line.itemId, {
      itemId: line.itemId,
      itemName: line.item.name,
      itemSku: line.item.sku,
      itemUnit: line.item.unit,
      itemQtyOnHand: line.item.qtyOnHand,
      qtyRequiredPerProduct: line.qtyRequired,
    });
  }

  for (const intermediateLine of product.bomIntermediateProducts) {
    const intermediate = intermediateLine.intermediateProduct;

    if (intermediate.kind !== 'INTERMEDIATE') {
      notes.push(`Componente invalido na BOM: ${intermediate.name} nao e produto intermediario.`);
      continue;
    }

    if (intermediate.bomItems.length === 0) {
      notes.push(`Produto intermediario "${intermediate.name}" sem BOM cadastrada.`);
      continue;
    }

    for (const nestedItemLine of intermediate.bomItems) {
      const effectiveQty = intermediateLine.qtyRequired.mul(nestedItemLine.qtyRequired);
      const existing = aggregated.get(nestedItemLine.itemId);
      if (existing) {
        existing.qtyRequiredPerProduct = existing.qtyRequiredPerProduct.add(effectiveQty);
        continue;
      }

      aggregated.set(nestedItemLine.itemId, {
        itemId: nestedItemLine.itemId,
        itemName: nestedItemLine.item.name,
        itemSku: nestedItemLine.item.sku,
        itemUnit: nestedItemLine.item.unit,
        itemQtyOnHand: nestedItemLine.item.qtyOnHand,
        qtyRequiredPerProduct: effectiveQty,
      });
    }
  }

  return {
    lines: Array.from(aggregated.values()).sort((a, b) => a.itemName.localeCompare(b.itemName, 'pt-BR')),
    notes,
  };
}

function computeProductionCapacity(product: ProductForCapacity) {
  const hasNoComponents = product.bomItems.length === 0 && product.bomIntermediateProducts.length === 0;
  if (hasNoComponents) {
    return {
      productionCapacity: '0',
      capacityLimiters: [] as Array<{
        itemId: string;
        itemName: string;
        itemSku: string;
        itemUnit: string;
        itemQtyOnHand: string;
        qtyRequiredPerProduct: string;
        maxProductsFromItem: string;
      }>,
      capacityItems: [] as Array<{
        itemId: string;
        itemName: string;
        itemSku: string;
        itemUnit: string;
        itemQtyOnHand: string;
        qtyRequiredPerProduct: string;
        maxProductsFromItem: string;
      }>,
      capacityNotes: ['Produto sem BOM cadastrada.'],
    };
  }

  const flattened = flattenProductBom(product);
  if (flattened.notes.length > 0) {
    return {
      productionCapacity: '0',
      capacityLimiters: [] as Array<{
        itemId: string;
        itemName: string;
        itemSku: string;
        itemUnit: string;
        itemQtyOnHand: string;
        qtyRequiredPerProduct: string;
        maxProductsFromItem: string;
      }>,
      capacityItems: [] as Array<{
        itemId: string;
        itemName: string;
        itemSku: string;
        itemUnit: string;
        itemQtyOnHand: string;
        qtyRequiredPerProduct: string;
        maxProductsFromItem: string;
      }>,
      capacityNotes: flattened.notes,
    };
  }

  if (flattened.lines.length === 0) {
    return {
      productionCapacity: '0',
      capacityLimiters: [],
      capacityItems: [],
      capacityNotes: ['Produto sem itens validos na BOM.'],
    };
  }

  const capacities = flattened.lines.map((line) => {
    const rawCapacity = line.itemQtyOnHand.div(line.qtyRequiredPerProduct);
    return { line, maxProductsFromItem: rawCapacity.floor() };
  });

  const minCapacity = capacities.reduce(
    (currentMin, entry) => (entry.maxProductsFromItem.lt(currentMin) ? entry.maxProductsFromItem : currentMin),
    capacities[0]?.maxProductsFromItem ?? new Prisma.Decimal(0),
  );

  const minCapacityString = decimalToString(minCapacity) ?? '0';
  const capacityItems = capacities
    .sort((a, b) => {
      if (a.maxProductsFromItem.eq(b.maxProductsFromItem)) {
        return a.line.itemName.localeCompare(b.line.itemName, 'pt-BR');
      }
      return a.maxProductsFromItem.lt(b.maxProductsFromItem) ? -1 : 1;
    })
    .map((entry) => ({
      itemId: entry.line.itemId,
      itemName: entry.line.itemName,
      itemSku: entry.line.itemSku,
      itemUnit: entry.line.itemUnit,
      itemQtyOnHand: decimalToString(entry.line.itemQtyOnHand) ?? '0',
      qtyRequiredPerProduct: decimalToString(entry.line.qtyRequiredPerProduct) ?? '0',
      maxProductsFromItem: decimalToString(entry.maxProductsFromItem) ?? '0',
    }));

  const capacityLimiters = capacityItems.filter((entry) => entry.maxProductsFromItem === minCapacityString);

  return {
    productionCapacity: minCapacityString,
    capacityLimiters,
    capacityItems,
    capacityNotes: [] as string[],
  };
}

async function syncItemsForManualStockChange(params: {
  tx: Prisma.TransactionClient;
  product: ProductWithBomForStockConsumption;
  qtyStockDelta: Prisma.Decimal;
}) {
  const { tx, product, qtyStockDelta } = params;

  if (qtyStockDelta.eq(0)) {
    return;
  }

  const noComponents = product.bomItems.length === 0 && product.bomIntermediateProducts.length === 0;
  if (noComponents) {
    if (qtyStockDelta.gt(0)) {
      throw appErrors.badRequest(
        'Nao e possivel aumentar estoque de produto sem BOM. Cadastre a BOM antes de informar quantidade em estoque.',
      );
    }
    return;
  }

  const flattened = flattenProductBom(product);
  if (flattened.notes.length > 0) {
    throw appErrors.badRequest(flattened.notes[0] ?? 'BOM invalida');
  }

  const itemIds = flattened.lines.map((line) => line.itemId).sort();
  await tx.$queryRaw`SELECT id FROM "items" WHERE id IN (${Prisma.join(itemIds)}) FOR UPDATE`;

  const currentItems = await tx.item.findMany({
    where: { id: { in: itemIds } },
  });
  const currentItemsMap = new Map(currentItems.map((item) => [item.id, item]));

  if (currentItems.length !== itemIds.length) {
    throw appErrors.badRequest('BOM references missing item(s)');
  }

  for (const flattenedLine of flattened.lines) {
    const item = currentItemsMap.get(flattenedLine.itemId);
    if (!item) {
      throw appErrors.badRequest('BOM references missing item(s)');
    }

    const itemDeltaQty = flattenedLine.qtyRequiredPerProduct.mul(qtyStockDelta).neg();
    const nextItemQty = item.qtyOnHand.add(itemDeltaQty);

    if (nextItemQty.isNegative()) {
      throw appErrors.conflict(
        `Estoque insuficiente para aumentar estoque do produto. Item: ${item.name} (disponivel ${decimalToString(item.qtyOnHand) ?? '0'})`,
      );
    }

    await tx.item.update({
      where: { id: item.id },
      data: { qtyOnHand: nextItemQty },
    });
  }
}

export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async list(query: ProductListQuery, expectedKind: ProductKind = 'FINAL') {
    const products = await this.productsRepository.list({
      search: query.search?.trim() || undefined,
      kind: expectedKind,
    });

    return products.map((product) => {
      const capacity = computeProductionCapacity(product);
      return {
        ...serializeProduct(product),
        productionCapacity: capacity.productionCapacity,
        productionCapacityLimiters: capacity.capacityLimiters,
        productionCapacityItems: capacity.capacityItems,
        productionCapacityNotes: capacity.capacityNotes,
      };
    });
  }

  async getById(id: string, expectedKind: ProductKind = 'FINAL') {
    const product = await this.productsRepository.getByIdWithBom(id);
    if (!product) {
      throw appErrors.notFound('Product not found');
    }
    ensureExpectedKind(product, expectedKind);

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
      intermediateBom: product.bomIntermediateProducts.map((bomLine) => ({
        id: bomLine.id,
        intermediateProductId: bomLine.intermediateProductId,
        qtyRequired: decimalToString(bomLine.qtyRequired) ?? '0',
        intermediateProduct: {
          id: bomLine.intermediateProduct.id,
          kind: bomLine.intermediateProduct.kind,
          name: bomLine.intermediateProduct.name,
          sku: bomLine.intermediateProduct.sku,
          bomItemsCount: bomLine.intermediateProduct.bomItems.length,
        },
      })),
    };
  }

  async create(input: ProductCreateBody, kind: ProductKind = 'FINAL') {
    const product = await this.productsRepository.create({
      kind,
      name: input.name.trim(),
      sku: normalizeSku(input.sku) ?? generateAutoSku(getSkuPrefix(kind)),
      manufacturingLeadTimeDays: normalizeOptionalLeadTime(input.manufacturingLeadTimeDays),
      qtyInStock: input.qtyInStock ? toDecimal(input.qtyInStock) : undefined,
      qtySoldTotal: input.qtySoldTotal ? toDecimal(input.qtySoldTotal) : undefined,
    });

    return serializeProduct(product);
  }

  async update(id: string, input: ProductUpdateBody, _actor: JwtUserPayload, expectedKind: ProductKind = 'FINAL') {
    const product = await this.productsRepository.transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { id },
      });

      if (!existing) {
        throw appErrors.notFound('Product not found');
      }
      ensureExpectedKind(existing, expectedKind);

      const nextQtyInStock = input.qtyInStock !== undefined ? toDecimal(input.qtyInStock) : existing.qtyInStock;
      const qtyStockDelta = nextQtyInStock.sub(existing.qtyInStock);

      if (!qtyStockDelta.eq(0)) {
        const productWithBom = await this.productsRepository.getByIdWithBom(id, tx);
        if (!productWithBom) {
          throw appErrors.notFound('Product not found');
        }
        ensureExpectedKind(productWithBom, expectedKind);
        await syncItemsForManualStockChange({
          tx,
          product: productWithBom,
          qtyStockDelta,
        });
      }

      return this.productsRepository.update(
        id,
        {
          name: input.name?.trim(),
          sku: resolveProductSkuForUpdate(input.sku, existing.kind),
          manufacturingLeadTimeDays: normalizeOptionalLeadTime(input.manufacturingLeadTimeDays),
          qtyInStock: input.qtyInStock !== undefined ? nextQtyInStock : undefined,
          qtySoldTotal: input.qtySoldTotal !== undefined ? toDecimal(input.qtySoldTotal) : undefined,
        },
        tx,
      );
    });

    return serializeProduct(product);
  }

  async remove(
    id: string,
    expectedKind: ProductKind = 'FINAL',
    options?: { forceCascadeUsageDelete?: boolean },
  ) {
    const product = await this.productsRepository.transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { id },
        include: {
          bomItems: {
            include: { item: true },
            orderBy: [{ item: { name: 'asc' } }],
          },
          bomIntermediateProducts: {
            include: {
              intermediateProduct: {
                include: {
                  bomItems: {
                    include: { item: true },
                    orderBy: [{ item: { name: 'asc' } }],
                  },
                },
              },
            },
            orderBy: [{ intermediateProduct: { name: 'asc' } }],
          },
          usedAsIntermediateIn: {
            include: {
              product: {
                select: { id: true, name: true, sku: true, kind: true },
              },
            },
          },
        },
      });

      if (!existing) {
        throw appErrors.notFound('Product not found');
      }
      ensureExpectedKind(existing, expectedKind);

      if (
        existing.kind === 'INTERMEDIATE' &&
        existing.usedAsIntermediateIn.length > 0 &&
        !options?.forceCascadeUsageDelete
      ) {
        throw new AppError(
          409,
          'CONFLICT',
          'Produto intermediario esta vinculado a produto(s) final(is). Confirme para remover os vinculos e deletar.',
          {
            requiresConfirmation: 'INTERMEDIATE_USED_IN_FINAL',
            usageCount: existing.usedAsIntermediateIn.length,
            usedByProducts: existing.usedAsIntermediateIn.map((link) => ({
              id: link.product.id,
              name: link.product.name,
              sku: link.product.sku,
            })),
          },
        );
      }

      if (existing.qtyInStock.gt(0)) {
        await syncItemsForManualStockChange({
          tx,
          product: existing,
          qtyStockDelta: existing.qtyInStock.neg(),
        });
      }

      if (existing.kind === 'INTERMEDIATE') {
        await tx.productBomIntermediateProduct.deleteMany({
          where: { intermediateProductId: existing.id },
        });
      }

      const productOrders = await tx.productOrder.findMany({
        where: { productId: existing.id },
        select: { id: true, reversalOfOrderId: true },
      });
      const productOrderIds = productOrders.map((order) => order.id);

      if (productOrderIds.length > 0) {
        await tx.stockMovement.deleteMany({
          where: {
            referenceType: 'PRODUCT_ORDER',
            referenceId: { in: productOrderIds },
          },
        });

        await tx.productOrder.deleteMany({
          where: {
            productId: existing.id,
            reversalOfOrderId: { not: null },
          },
        });
        await tx.productOrder.deleteMany({
          where: { productId: existing.id },
        });
      }

      return tx.product.delete({
        where: { id: existing.id },
      });
    });

    return serializeProduct(product);
  }

  async replaceBom(productId: string, input: ProductBomReplaceBody, expectedKind: ProductKind = 'FINAL') {
    const intermediateProducts = input.intermediateProducts ?? [];
    const duplicateItemIds = new Set<string>();
    const seenItemIds = new Set<string>();
    const duplicateIntermediateIds = new Set<string>();
    const seenIntermediateIds = new Set<string>();

    for (const line of input.items) {
      if (seenItemIds.has(line.itemId)) {
        duplicateItemIds.add(line.itemId);
      }
      seenItemIds.add(line.itemId);
    }

    for (const line of intermediateProducts) {
      if (seenIntermediateIds.has(line.intermediateProductId)) {
        duplicateIntermediateIds.add(line.intermediateProductId);
      }
      seenIntermediateIds.add(line.intermediateProductId);
    }

    if (duplicateItemIds.size > 0) {
      throw appErrors.badRequest(`Duplicate itemId(s) in BOM: ${Array.from(duplicateItemIds).join(', ')}`);
    }

    if (duplicateIntermediateIds.size > 0) {
      throw appErrors.badRequest(
        `Duplicate intermediateProductId(s) in BOM: ${Array.from(duplicateIntermediateIds).join(', ')}`,
      );
    }

    await this.productsRepository.transaction(async (tx) => {
      const existingProduct = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!existingProduct) {
        throw appErrors.notFound('Product not found');
      }
      ensureExpectedKind(existingProduct, expectedKind);

      if (existingProduct.kind === 'INTERMEDIATE' && intermediateProducts.length > 0) {
        throw appErrors.badRequest('Produto intermediario pode conter apenas itens na BOM');
      }

      if (input.items.length > 0) {
        const itemIds = input.items.map((line) => line.itemId);
        const itemsCount = await this.productsRepository.countItemsByIds(itemIds, tx);

        if (itemsCount !== itemIds.length) {
          throw appErrors.badRequest('BOM contains itemId that does not exist');
        }
      }

      if (intermediateProducts.length > 0) {
        const intermediateProductIds = intermediateProducts.map((line) => line.intermediateProductId);
        if (intermediateProductIds.includes(productId)) {
          throw appErrors.badRequest('Produto nao pode referenciar ele mesmo como intermediario');
        }

        const referencedProducts = await this.productsRepository.getProductsByIds(intermediateProductIds, tx);
        if (referencedProducts.length !== intermediateProductIds.length) {
          throw appErrors.badRequest('BOM contains intermediate product that does not exist');
        }

        const invalidKinds = referencedProducts.filter((product) => product.kind !== 'INTERMEDIATE');
        if (invalidKinds.length > 0) {
          throw appErrors.badRequest('BOM final aceita apenas produtos intermediarios como componente');
        }
      }

      await this.productsRepository.replaceBom(
        productId,
        input.items.map((line) => ({
          itemId: line.itemId,
          qtyRequired: toDecimal(line.qtyRequired),
        })),
        intermediateProducts.map((line) => ({
          intermediateProductId: line.intermediateProductId,
          qtyRequired: toDecimal(line.qtyRequired),
        })),
        tx,
      );
    });

    return this.getById(productId, expectedKind);
  }
}
