import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { OperationsService } from '../src/modules/operations/operations.service';
import { OperationsRepository } from '../src/modules/operations/operations.repository';

function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function buildOrderDetail() {
  return {
    id: 'order_1',
    type: 'OUTBOUND_PRODUCT' as const,
    productId: 'prod_1',
    productQty: decimal('2'),
    totalCost: decimal('17'),
    unitCost: decimal('8.5'),
    note: null,
    createdAt: new Date('2026-02-23T00:00:00Z'),
    product: {
      id: 'prod_1',
      name: 'Produto Final',
      sku: 'PROD-1',
      active: true,
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
    },
    createdByUser: {
      id: 'user_1',
      email: 'admin@example.com',
      passwordHash: 'hash',
      role: 'ADMIN' as const,
      createdAt: new Date('2026-02-23T00:00:00Z'),
    },
    lines: [
      {
        id: 'line_1',
        orderId: 'order_1',
        itemId: 'item_1',
        itemQty: decimal('4'),
        itemUnitPriceSnapshot: decimal('2'),
        lineCost: decimal('8'),
        item: {
          id: 'item_1',
          name: 'A',
          sku: 'A-1',
          unit: 'kg',
          unitPrice: decimal('2'),
          qtyOnHand: decimal('10'),
          minQty: null,
          active: true,
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
        },
      },
    ],
  };
}

function buildRepositoryMock(options?: { insufficientStock?: boolean; failOnLines?: boolean }) {
  const product = {
    id: 'prod_1',
    name: 'Produto Final',
    sku: 'PROD-1',
    active: true,
    createdAt: new Date('2026-02-23T00:00:00Z'),
    updatedAt: new Date('2026-02-23T00:00:00Z'),
    bomItems: [
      {
        id: 'bom_1',
        productId: 'prod_1',
        itemId: 'item_1',
        qtyRequired: decimal('2'),
        item: {
          id: 'item_1',
          name: 'Item A',
          sku: 'ITEM-A',
          unit: 'kg',
          unitPrice: decimal('2'),
          qtyOnHand: decimal(options?.insufficientStock ? '3' : '10'),
          minQty: decimal('1'),
          active: true,
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
        },
      },
      {
        id: 'bom_2',
        productId: 'prod_1',
        itemId: 'item_2',
        qtyRequired: decimal('1.5'),
        item: {
          id: 'item_2',
          name: 'Item B',
          sku: 'ITEM-B',
          unit: 'l',
          unitPrice: decimal('3'),
          qtyOnHand: decimal('20'),
          minQty: decimal('2'),
          active: true,
          createdAt: new Date('2026-02-23T00:00:00Z'),
          updatedAt: new Date('2026-02-23T00:00:00Z'),
        },
      },
    ],
  };

  const items = [
    {
      id: 'item_1',
      name: 'Item A',
      sku: 'ITEM-A',
      unit: 'kg',
      unitPrice: decimal('2'),
      qtyOnHand: decimal(options?.insufficientStock ? '3' : '10'),
      minQty: decimal('1'),
      active: true,
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
    },
    {
      id: 'item_2',
      name: 'Item B',
      sku: 'ITEM-B',
      unit: 'l',
      unitPrice: decimal('3'),
      qtyOnHand: decimal('20'),
      minQty: decimal('2'),
      active: true,
      createdAt: new Date('2026-02-23T00:00:00Z'),
      updatedAt: new Date('2026-02-23T00:00:00Z'),
    },
  ];

  const tx = {
    product: {
      findUnique: vi.fn(async () => ({ id: 'prod_1' })),
    },
  } as unknown as Prisma.TransactionClient;

  const repository = {
    transaction: vi.fn(async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(tx)),
    getProductWithBom: vi.fn(async () => product),
    lockItems: vi.fn(async () => []),
    getItemsByIds: vi.fn(async () => items),
    updateItemQty: vi.fn(async (id: string, qtyOnHand: Prisma.Decimal) => ({ id, qtyOnHand })),
    incrementProductSoldTotal: vi.fn(async () => ({ id: 'prod_1' })),
    createProductOrder: vi.fn(async () => ({ id: 'order_1' })),
    createProductOrderLines: vi.fn(async () => {
      if (options?.failOnLines) {
        throw new Error('line insert failed');
      }
      return { count: 2 };
    }),
    createStockMovements: vi.fn(async () => ({ count: 2 })),
    getOrderById: vi.fn(async () => buildOrderDetail()),
    listOrders: vi.fn(),
    listMovements: vi.fn(),
  };

  return repository;
}

describe('OperationsService.execute', () => {
  it('calculates consumption and cost correctly for outbound', async () => {
    const repository = buildRepositoryMock();
    const service = new OperationsService(repository as unknown as OperationsRepository);

    const result = await service.execute(
      'OUTBOUND_PRODUCT',
      {
        productId: 'prod_1',
        qty: '2',
        allowNegativeOverride: false,
      },
      {
        sub: 'user_1',
        email: 'admin@example.com',
        role: 'ADMIN',
      },
    );

    expect(repository.createProductOrder).toHaveBeenCalledTimes(1);
    const createProductOrderMock = repository.createProductOrder as unknown as { mock: { calls: unknown[][] } };
    const orderPayload = createProductOrderMock.mock.calls[0]?.[0] as
      | { totalCost: Prisma.Decimal; unitCost: Prisma.Decimal }
      | undefined;
    if (!orderPayload) {
      throw new Error('Expected createProductOrder to be called');
    }
    expect(orderPayload.totalCost.toString()).toBe('17');
    expect(orderPayload.unitCost.toString()).toBe('8.5');

    const updateCalls = (repository.updateItemQty as unknown as { mock: { calls: unknown[][] } }).mock.calls as Array<
      [string, Prisma.Decimal]
    >;
    expect(updateCalls[0]?.[0]).toBe('item_1');
    expect(updateCalls[0]?.[1].toString()).toBe('6');
    expect(updateCalls[1]?.[0]).toBe('item_2');
    expect(updateCalls[1]?.[1].toString()).toBe('17');

    const createStockMovementsMock = repository.createStockMovements as unknown as { mock: { calls: unknown[][] } };
    const movementPayload = createStockMovementsMock.mock.calls[0]?.[0] as
      | Array<{ deltaQty: Prisma.Decimal }>
      | undefined;
    if (!movementPayload) {
      throw new Error('Expected createStockMovements to be called');
    }
    expect(movementPayload[0].deltaQty.toString()).toBe('-4');
    expect(movementPayload[1].deltaQty.toString()).toBe('-3');
    const incrementProductSoldTotalMock = repository.incrementProductSoldTotal as unknown as { mock: { calls: unknown[][] } };
    const incrementCall = incrementProductSoldTotalMock.mock.calls[0] as [string, Prisma.Decimal] | undefined;
    expect(incrementCall?.[0]).toBe('prod_1');
    expect(incrementCall?.[1].toString()).toBe('2');
    expect(result.id).toBe('order_1');
  });

  it('blocks outbound when stock is insufficient', async () => {
    const repository = buildRepositoryMock({ insufficientStock: true });
    const service = new OperationsService(repository as unknown as OperationsRepository);

    await expect(
      service.execute(
        'OUTBOUND_PRODUCT',
        {
          productId: 'prod_1',
          qty: '2',
          allowNegativeOverride: false,
        },
        {
          sub: 'user_1',
          email: 'user@example.com',
          role: 'USER',
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });

    expect(repository.createProductOrder).not.toHaveBeenCalled();
    expect(repository.updateItemQty).not.toHaveBeenCalled();
    expect(repository.incrementProductSoldTotal).not.toHaveBeenCalled();
  });

  it('stores order line price snapshots from current item prices', async () => {
    const repository = buildRepositoryMock();
    const service = new OperationsService(repository as unknown as OperationsRepository);

    await service.execute(
      'OUTBOUND_PRODUCT',
      {
        productId: 'prod_1',
        qty: '2',
        allowNegativeOverride: false,
      },
      {
        sub: 'user_1',
        email: 'admin@example.com',
        role: 'ADMIN',
      },
    );

    const createProductOrderLinesMock = repository.createProductOrderLines as unknown as { mock: { calls: unknown[][] } };
    const linesPayload = createProductOrderLinesMock.mock.calls[0]?.[1] as
      | Array<{ itemUnitPriceSnapshot: Prisma.Decimal; lineCost: Prisma.Decimal }>
      | undefined;
    if (!linesPayload) {
      throw new Error('Expected createProductOrderLines to be called');
    }
    expect(linesPayload[0].itemUnitPriceSnapshot.toString()).toBe('2');
    expect(linesPayload[0].lineCost.toString()).toBe('8');
    expect(linesPayload[1].itemUnitPriceSnapshot.toString()).toBe('3');
    expect(linesPayload[1].lineCost.toString()).toBe('9');
  });

  it('runs persistence steps inside a transaction and aborts later steps on failure', async () => {
    const repository = buildRepositoryMock({ failOnLines: true });
    const service = new OperationsService(repository as unknown as OperationsRepository);

    await expect(
      service.execute(
        'OUTBOUND_PRODUCT',
        {
          productId: 'prod_1',
          qty: '2',
          allowNegativeOverride: false,
        },
        {
          sub: 'user_1',
          email: 'admin@example.com',
          role: 'ADMIN',
        },
      ),
    ).rejects.toThrow('line insert failed');

    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.createProductOrder).toHaveBeenCalledTimes(1);
    expect(repository.updateItemQty).not.toHaveBeenCalled();
    expect(repository.createStockMovements).not.toHaveBeenCalled();
    expect(repository.incrementProductSoldTotal).not.toHaveBeenCalled();
  });
});
