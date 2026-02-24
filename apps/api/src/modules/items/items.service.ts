import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { appErrors } from '../../core/app-error';
import type { JwtUserPayload } from '../../types/auth';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { ItemCreateBody, ItemListQuery, ItemUpdateBody, StockAdjustmentBody } from './items.schemas';
import { ItemsRepository } from './items.repository';

export interface ItemResponse {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: string;
  qtyOnHand: string;
  minQty: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemMovementResponse {
  id: string;
  deltaQty: string;
  reason: string;
  referenceType: string;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  createdByUser: {
    id: string;
    email: string;
    role: string;
  };
}

function normalizeSku(sku?: string | null): string | undefined {
  const normalized = sku?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function generateAutoSku(prefix: 'ITM'): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function serializeItem(item: {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: Prisma.Decimal;
  qtyOnHand: Prisma.Decimal;
  minQty: Prisma.Decimal | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ItemResponse {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    unitPrice: decimalToString(item.unitPrice) ?? '0',
    qtyOnHand: decimalToString(item.qtyOnHand) ?? '0',
    minQty: decimalToString(item.minQty),
    active: item.active,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeMovement(movement: {
  id: string;
  deltaQty: Prisma.Decimal;
  reason: string;
  referenceType: string;
  referenceId: string | null;
  note: string | null;
  createdAt: Date;
  createdByUser: {
    id: string;
    email: string;
    role: string;
  };
}): ItemMovementResponse {
  return {
    id: movement.id,
    deltaQty: decimalToString(movement.deltaQty) ?? '0',
    reason: movement.reason,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    note: movement.note,
    createdAt: movement.createdAt.toISOString(),
    createdByUser: movement.createdByUser,
  };
}

export class ItemsService {
  constructor(private readonly itemsRepository: ItemsRepository) {}

  async list(query: ItemListQuery): Promise<ItemResponse[]> {
    const items = await this.itemsRepository.list({
      search: query.search?.trim() || undefined,
      active: query.active,
    });

    const filtered = query.belowMin
      ? items.filter((item) => item.minQty != null && item.qtyOnHand.lt(item.minQty))
      : items;

    return filtered.map(serializeItem);
  }

  async getById(id: string): Promise<ItemResponse> {
    const item = await this.itemsRepository.getById(id);
    if (!item) {
      throw appErrors.notFound('Item not found');
    }

    return serializeItem(item);
  }

  async getByIdWithMovements(id: string): Promise<{ item: ItemResponse; movements: ItemMovementResponse[] }> {
    const item = await this.itemsRepository.getByIdWithMovements(id);
    if (!item) {
      throw appErrors.notFound('Item not found');
    }

    return {
      item: serializeItem(item),
      movements: item.movements.map(serializeMovement),
    };
  }

  async create(input: ItemCreateBody, actor: JwtUserPayload): Promise<ItemResponse> {
    const qtyOnHand = toDecimal(input.qtyOnHand);
    const unitPrice = toDecimal(input.unitPrice);
    const minQty = toDecimal(input.minQty);

    if (qtyOnHand.isNegative()) {
      throw appErrors.badRequest('qtyOnHand must be non-negative');
    }

    if (unitPrice.isNegative()) {
      throw appErrors.badRequest('unitPrice must be non-negative');
    }

    const item = await this.itemsRepository.transaction(async (tx) => {
      const created = await this.itemsRepository.create(
        {
          name: input.name.trim(),
          sku: normalizeSku(input.sku) ?? generateAutoSku('ITM'),
          unit: input.unit.trim(),
          unitPrice,
          qtyOnHand,
          minQty,
          active: input.active ?? true,
        },
        tx,
      );

      if (!qtyOnHand.isZero()) {
        await this.itemsRepository.createMovement(
          {
            itemId: created.id,
            deltaQty: qtyOnHand,
            reason: 'MANUAL_ADJUSTMENT',
            referenceType: 'MANUAL_ADJUSTMENT',
            note: 'Initial stock on item creation',
            createdByUserId: actor.sub,
          },
          tx,
        );
      }

      return created;
    });

    return serializeItem(item);
  }

  async update(id: string, input: ItemUpdateBody): Promise<ItemResponse> {
    const existing = await this.itemsRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Item not found');
    }

    const updated = await this.itemsRepository.update(id, {
      name: input.name?.trim(),
      sku: normalizeSku(input.sku),
      unit: input.unit?.trim(),
      unitPrice: input.unitPrice ? toDecimal(input.unitPrice) : undefined,
      minQty:
        input.minQty === undefined
          ? undefined
          : input.minQty === null
            ? null
            : toDecimal(input.minQty),
      active: input.active,
    });

    return serializeItem(updated);
  }

  async remove(id: string): Promise<ItemResponse> {
    const existing = await this.itemsRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Item not found');
    }

    const item = await this.itemsRepository.softDelete(id);
    return serializeItem(item);
  }

  async adjustStock(id: string, input: StockAdjustmentBody, actor: JwtUserPayload): Promise<ItemResponse> {
    const deltaQty = toDecimal(input.deltaQty);

    if (deltaQty.isZero()) {
      throw appErrors.badRequest('deltaQty must not be zero');
    }

    const item = await this.itemsRepository.transaction(async (tx) => {
      const existing = await tx.item.findUnique({ where: { id } });
      if (!existing) {
        throw appErrors.notFound('Item not found');
      }

      const nextQty = existing.qtyOnHand.add(deltaQty);
      if (nextQty.isNegative() && !input.allowNegativeOverride) {
        throw appErrors.conflict('Insufficient stock for manual adjustment');
      }

      const updated = await tx.item.update({
        where: { id },
        data: { qtyOnHand: nextQty },
      });

      await this.itemsRepository.createMovement(
        {
          itemId: id,
          deltaQty,
          reason: 'MANUAL_ADJUSTMENT',
          referenceType: 'MANUAL_ADJUSTMENT',
          note: input.note ?? null,
          createdByUserId: actor.sub,
        },
        tx,
      );

      return updated;
    });

    return serializeItem(item);
  }
}
