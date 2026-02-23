import { appErrors } from '../../core/app-error';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { ProductBomReplaceBody, ProductCreateBody, ProductListQuery, ProductUpdateBody } from './products.schemas';
import { ProductsRepository } from './products.repository';

function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function serializeProduct(product: {
  id: string;
  name: string;
  sku: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { bomItems: number };
}) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    active: product.active,
    bomItemsCount: product._count?.bomItems,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async list(query: ProductListQuery) {
    const products = await this.productsRepository.list({
      search: query.search?.trim() || undefined,
      active: query.active,
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
          active: bomItem.item.active,
        },
      })),
    };
  }

  async create(input: ProductCreateBody) {
    const product = await this.productsRepository.create({
      name: input.name.trim(),
      sku: normalizeSku(input.sku),
      active: input.active ?? true,
    });

    return serializeProduct(product);
  }

  async update(id: string, input: ProductUpdateBody) {
    const existing = await this.productsRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Product not found');
    }

    const product = await this.productsRepository.update(id, {
      name: input.name?.trim(),
      sku: input.sku ? normalizeSku(input.sku) : undefined,
      active: input.active,
    });

    return serializeProduct(product);
  }

  async remove(id: string) {
    const existing = await this.productsRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Product not found');
    }

    const product = await this.productsRepository.softDelete(id);
    return serializeProduct(product);
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
