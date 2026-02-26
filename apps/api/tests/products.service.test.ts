import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ProductsService } from '../src/modules/products/products.service';
import type { ProductBomReplaceBody } from '../src/modules/products/products.schemas';
import { ProductsRepository } from '../src/modules/products/products.repository';
import type { JwtUserPayload } from '../src/types/auth';

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
            kind: 'FINAL' as const,
            name: 'Produto',
            sku: 'PROD-1',
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
      kind: 'FINAL' as const,
      name: 'Produto',
      sku: 'PROD-1',
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
    })),
    getByIdWithBom: vi.fn(async () => ({
      id: 'prod_1',
      kind: 'FINAL' as const,
      name: 'Produto',
      sku: 'PROD-1',
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
            createdAt: new Date('2026-02-23T00:00:00Z'),
            updatedAt: new Date('2026-02-23T00:00:00Z'),
          },
        },
      ],
      bomIntermediateProducts: [],
    })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countItemsByIds: vi.fn(async (itemIds: string[]) => itemIds.length),
    getProductsByIds: vi.fn(async () => []),
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

describe('ProductsService.update (manual qtyInStock)', () => {
  function buildProductForUpdate(params: {
    kind: 'FINAL' | 'INTERMEDIATE';
    bomItems?: Array<{ itemId: string; qtyRequired: string; itemName?: string; qtyOnHand?: string }>;
    bomIntermediateProducts?: Array<{
      intermediateProductId: string;
      qtyRequired: string;
      intermediateProduct: {
        id: string;
        name: string;
        sku: string;
        bomItems: Array<{ itemId: string; qtyRequired: string; itemName?: string; qtyOnHand?: string }>;
      };
    }>;
  }) {
    return {
      id: 'prod_1',
      kind: params.kind,
      name: params.kind === 'INTERMEDIATE' ? 'Subconjunto' : 'Produto final',
      sku: params.kind === 'INTERMEDIATE' ? 'INT-1' : 'PRD-1',
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
      bomItems: (params.bomItems ?? []).map((line, index) => ({
        id: `bom_${index + 1}`,
        itemId: line.itemId,
        productId: 'prod_1',
        qtyRequired: decimal(line.qtyRequired),
        item: {
          id: line.itemId,
          name: line.itemName ?? `Item ${index + 1}`,
          sku: `SKU-${index + 1}`,
          unit: 'un',
          unitPrice: decimal('1'),
          qtyOnHand: decimal(line.qtyOnHand ?? '100'),
          minQty: decimal('0'),
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
        },
      })),
      bomIntermediateProducts: (params.bomIntermediateProducts ?? []).map((line, index) => ({
        id: `ibom_${index + 1}`,
        productId: 'prod_1',
        intermediateProductId: line.intermediateProductId,
        qtyRequired: decimal(line.qtyRequired),
        intermediateProduct: {
          id: line.intermediateProduct.id,
          kind: 'INTERMEDIATE' as const,
          name: line.intermediateProduct.name,
          sku: line.intermediateProduct.sku,
          qtyInStock: decimal('0'),
          qtySoldTotal: decimal('0'),
          manufacturingLeadTimeDays: null,
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
          bomItems: line.intermediateProduct.bomItems.map((nestedLine, nestedIndex) => ({
            id: `nested_${nestedIndex + 1}`,
            itemId: nestedLine.itemId,
            productId: line.intermediateProduct.id,
            qtyRequired: decimal(nestedLine.qtyRequired),
            item: {
              id: nestedLine.itemId,
              name: nestedLine.itemName ?? `Nested ${nestedIndex + 1}`,
              sku: `NEST-${nestedIndex + 1}`,
              unit: 'un',
              unitPrice: decimal('1'),
              qtyOnHand: decimal(nestedLine.qtyOnHand ?? '100'),
              minQty: decimal('0'),
              createdAt: new Date('2026-02-23T00:00:00Z'),
              updatedAt: new Date('2026-02-23T00:00:00Z'),
            },
          })),
        },
      })),
    };
  }

  function buildUpdateHarness(params: {
    existingKind: 'FINAL' | 'INTERMEDIATE';
    existingQtyInStock?: string;
    productWithBom: ReturnType<typeof buildProductForUpdate>;
    currentItems: Array<{ id: string; name: string; qtyOnHand: string }>;
  }) {
    const tx = {
      product: {
        findUnique: vi.fn(async () => ({
          id: 'prod_1',
          kind: params.existingKind,
          name: params.productWithBom.name,
          sku: params.productWithBom.sku,
          qtyInStock: decimal(params.existingQtyInStock ?? '0'),
          qtySoldTotal: decimal('0'),
          manufacturingLeadTimeDays: null,
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
        })),
      },
      item: {
        findMany: vi.fn(async () =>
          params.currentItems.map((item) => ({
            id: item.id,
            name: item.name,
            qtyOnHand: decimal(item.qtyOnHand),
            unit: 'un',
            sku: `${item.id}-SKU`,
            unitPrice: decimal('1'),
            minQty: decimal('0'),
            createdAt: new Date('2026-02-23T00:00:00Z'),
            updatedAt: new Date('2026-02-23T00:00:00Z'),
          })),
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { qtyOnHand: Prisma.Decimal } }) => ({
          id: where.id,
          qtyOnHand: data.qtyOnHand,
        })),
      },
      stockMovement: {
        findFirst: vi.fn(async () => null),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      $queryRaw: vi.fn(async () => []),
    } as unknown as Prisma.TransactionClient;

    const repository = {
      transaction: vi.fn(async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(tx)),
      list: vi.fn(),
      getById: vi.fn(),
      getByIdWithBom: vi.fn(async () => params.productWithBom),
      create: vi.fn(),
      update: vi.fn(async (_id: string, data: { qtyInStock?: Prisma.Decimal }, db: Prisma.TransactionClient) => {
        void db;
        return {
          id: 'prod_1',
          kind: params.existingKind,
          name: params.productWithBom.name,
          sku: params.productWithBom.sku,
          manufacturingLeadTimeDays: null,
          qtyInStock: data.qtyInStock ?? decimal(params.existingQtyInStock ?? '0'),
          qtySoldTotal: decimal('0'),
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
        };
      }),
      delete: vi.fn(),
      countItemsByIds: vi.fn(),
      getProductsByIds: vi.fn(),
      replaceBom: vi.fn(),
    };

    return {
      tx: tx as unknown as {
        item: { update: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
        stockMovement: { createMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
        $queryRaw: ReturnType<typeof vi.fn>;
      },
      repository,
      service: new ProductsService(repository as unknown as ProductsRepository),
    };
  }

  it('consumes BOM items when increasing stock of intermediate product', async () => {
    const productWithBom = buildProductForUpdate({
      kind: 'INTERMEDIATE',
      bomItems: [{ itemId: 'item_chip', qtyRequired: '2', itemName: 'Chip TIM' }],
    });

    const { service, repository, tx } = buildUpdateHarness({
      existingKind: 'INTERMEDIATE',
      existingQtyInStock: '0',
      productWithBom,
      currentItems: [{ id: 'item_chip', name: 'Chip TIM', qtyOnHand: '10' }],
    });

    const actor: JwtUserPayload = { sub: 'user_1', email: 'user@example.com', role: 'ADMIN' };
    const result = await service.update('prod_1', { qtyInStock: '3' }, actor, 'INTERMEDIATE');

    expect(repository.getByIdWithBom).toHaveBeenCalled();
    expect(tx.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item_chip' },
        data: expect.objectContaining({ qtyOnHand: expect.any(Prisma.Decimal) }),
      }),
    );
    const itemUpdateCalls = (
      tx.item.update as unknown as {
        mock: { calls: Array<Array<{ where: { id: string }; data: { qtyOnHand: Prisma.Decimal } }>> };
      }
    ).mock.calls;
    expect(itemUpdateCalls[0]?.[0]?.data?.qtyOnHand.toString()).toBe('4');
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
    expect(result.qtyInStock).toBe('3');
  });

  it('consumes nested intermediate BOM items when increasing stock of final product', async () => {
    const productWithBom = buildProductForUpdate({
      kind: 'FINAL',
      bomIntermediateProducts: [
        {
          intermediateProductId: 'int_1',
          qtyRequired: '2',
          intermediateProduct: {
            id: 'int_1',
            name: 'Modem',
            sku: 'INT-1',
            bomItems: [{ itemId: 'item_modem_chip', qtyRequired: '3', itemName: 'Chip de modem' }],
          },
        },
      ],
    });

    const { service, tx } = buildUpdateHarness({
      existingKind: 'FINAL',
      existingQtyInStock: '0',
      productWithBom,
      currentItems: [{ id: 'item_modem_chip', name: 'Chip de modem', qtyOnHand: '100' }],
    });

    const actor: JwtUserPayload = { sub: 'user_1', email: 'user@example.com', role: 'ADMIN' };
    await service.update('prod_1', { qtyInStock: '4' }, actor, 'FINAL');

    const itemUpdateCalls = (
      tx.item.update as unknown as {
        mock: { calls: Array<Array<{ where: { id: string }; data: { qtyOnHand: Prisma.Decimal } }>> };
      }
    ).mock.calls;
    expect(itemUpdateCalls[0]?.[0]?.where?.id).toBe('item_modem_chip');
    expect(itemUpdateCalls[0]?.[0]?.data?.qtyOnHand.toString()).toBe('76');
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('returns BOM items when decreasing stock of intermediate product', async () => {
    const productWithBom = buildProductForUpdate({
      kind: 'INTERMEDIATE',
      bomItems: [{ itemId: 'item_chip', qtyRequired: '2', itemName: 'Chip TIM' }],
    });

    const { service, tx } = buildUpdateHarness({
      existingKind: 'INTERMEDIATE',
      existingQtyInStock: '2',
      productWithBom,
      currentItems: [{ id: 'item_chip', name: 'Chip TIM', qtyOnHand: '6' }],
    });

    const actor: JwtUserPayload = { sub: 'user_1', email: 'user@example.com', role: 'ADMIN' };
    await service.update('prod_1', { qtyInStock: '0' }, actor, 'INTERMEDIATE');

    const itemUpdateCalls = (
      tx.item.update as unknown as {
        mock: { calls: Array<Array<{ where: { id: string }; data: { qtyOnHand: Prisma.Decimal } }>> };
      }
    ).mock.calls;
    expect(itemUpdateCalls[0]?.[0]?.where?.id).toBe('item_chip');
    expect(itemUpdateCalls[0]?.[0]?.data?.qtyOnHand.toString()).toBe('10');

    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('returns nested intermediate BOM items when decreasing stock of final product partially', async () => {
    const productWithBom = buildProductForUpdate({
      kind: 'FINAL',
      bomIntermediateProducts: [
        {
          intermediateProductId: 'int_1',
          qtyRequired: '2',
          intermediateProduct: {
            id: 'int_1',
            name: 'Modem',
            sku: 'INT-1',
            bomItems: [{ itemId: 'item_modem_chip', qtyRequired: '3', itemName: 'Chip de modem' }],
          },
        },
      ],
    });

    const { service, tx } = buildUpdateHarness({
      existingKind: 'FINAL',
      existingQtyInStock: '2',
      productWithBom,
      currentItems: [{ id: 'item_modem_chip', name: 'Chip de modem', qtyOnHand: '10' }],
    });

    const actor: JwtUserPayload = { sub: 'user_1', email: 'user@example.com', role: 'ADMIN' };
    await service.update('prod_1', { qtyInStock: '1' }, actor, 'FINAL');

    const itemUpdateCalls = (
      tx.item.update as unknown as {
        mock: { calls: Array<Array<{ where: { id: string }; data: { qtyOnHand: Prisma.Decimal } }>> };
      }
    ).mock.calls;
    expect(itemUpdateCalls[0]?.[0]?.where?.id).toBe('item_modem_chip');
    expect(itemUpdateCalls[0]?.[0]?.data?.qtyOnHand.toString()).toBe('16');
  });
});
