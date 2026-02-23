import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ProductsService } from '../src/modules/products/products.service';
import type { ProductBomReplaceBody } from '../src/modules/products/products.schemas';
import { ProductsRepository } from '../src/modules/products/products.repository';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function buildRepositoryMock() {
  return {
    transaction: vi.fn(async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
      const tx = {
        product: {
          findUnique: vi.fn(async () => ({
            id: 'prod_1',
            name: 'Produto',
            sku: 'PROD-1',
            active: true,
            createdAt: new Date('2026-02-23T00:00:00Z'),
            updatedAt: new Date('2026-02-23T00:00:00Z'),
          })),
        },
      } as unknown as Prisma.TransactionClient;

      return callback(tx);
    }),
    list: vi.fn(),
    getById: vi.fn(async () => ({
      id: 'prod_1',
      name: 'Produto',
      sku: 'PROD-1',
      active: true,
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
    })),
    getByIdWithBom: vi.fn(async () => ({
      id: 'prod_1',
      name: 'Produto',
      sku: 'PROD-1',
      active: true,
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
      bomItems: [
        {
          id: 'bom_1',
          itemId: 'item_1',
          productId: 'prod_1',
          qtyRequired: decimal('2'),
          item: {
            id: 'item_1',
            name: 'Farinha',
            sku: 'FAR-1',
            unit: 'kg',
            unitPrice: decimal('10'),
            qtyOnHand: decimal('100'),
            minQty: decimal('10'),
            active: true,
            createdAt: new Date('2026-02-23T00:00:00Z'),
            updatedAt: new Date('2026-02-23T00:00:00Z'),
          },
        },
      ],
    })),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    countItemsByIds: vi.fn(async (itemIds: string[]) => itemIds.length),
    replaceBom: vi.fn(async () => undefined),
  };
}

describe('ProductsService.replaceBom', () => {
  it('rejects duplicate item ids in BOM', async () => {
    const repository = buildRepositoryMock();
    const service = new ProductsService(repository as unknown as ProductsRepository);

    const body: ProductBomReplaceBody = {
      items: [
        { itemId: 'item_1', qtyRequired: '1' },
        { itemId: 'item_1', qtyRequired: '2' },
      ],
    };

    await expect(service.replaceBom('prod_1', body)).rejects.toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });

    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('rejects BOM when one item does not exist', async () => {
    const repository = buildRepositoryMock();
    repository.countItemsByIds.mockResolvedValueOnce(1);
    const service = new ProductsService(repository as unknown as ProductsRepository);

    const body: ProductBomReplaceBody = {
      items: [
        { itemId: 'item_1', qtyRequired: '1' },
        { itemId: 'item_2', qtyRequired: '2' },
      ],
    };

    await expect(service.replaceBom('prod_1', body)).rejects.toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });

    expect(repository.replaceBom).not.toHaveBeenCalled();
  });

  it('converts BOM quantities to Decimal before saving', async () => {
    const repository = buildRepositoryMock();
    const service = new ProductsService(repository as unknown as ProductsRepository);

    const result = await service.replaceBom('prod_1', {
      items: [{ itemId: 'item_1', qtyRequired: '2.5' }],
    });

    expect(repository.replaceBom).toHaveBeenCalledTimes(1);
    const replaceBomMock = repository.replaceBom as unknown as { mock: { calls: unknown[][] } };
    const firstCall = replaceBomMock.mock.calls.at(0);
    expect(firstCall?.[0]).toBe('prod_1');
    const bomPayload = firstCall?.[1] as Array<{ itemId: string; qtyRequired: Prisma.Decimal }> | undefined;
    expect(bomPayload?.[0]?.qtyRequired.toString()).toBe('2.5');
    expect(result.data.id).toBe('prod_1');
  });
});
