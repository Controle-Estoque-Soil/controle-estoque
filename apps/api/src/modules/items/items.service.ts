import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { appErrors } from '../../core/app-error';
import type { JwtUserPayload } from '../../types/auth';
import { decimalToString, toDecimal } from '../../utils/decimal';
import type { ItemCreateBody, ItemListQuery, ItemUpdateBody, StockAdjustmentBody } from './items.schemas';
import type { ItemPurchaseSourceRecordInput } from './items.repository';
import { ItemsRepository } from './items.repository';

export interface ItemResponse {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: string;
  purchaseLeadTimeDays: string | null;
  purchaseSources: ItemPurchaseSourceResponse[];
  qtyOnHand: string;
  minQty: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemPurchaseSourceResponse {
  id: string;
  source: string | null;
  price: string | null;
  sortOrder: number;
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
    name: string | null;
    email: string;
    role: string;
  };
}

export interface DirectOutboundItemEmailPayload {
  referenceId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  itemQty: string;
  itemUnitPrice: string;
  estimatedCost: string;
  previousQtyOnHand: string;
  nextQtyOnHand: string;
  note: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string;
}

export interface StockAdjustmentResult {
  item: ItemResponse;
  directOutboundEmailPayload: DirectOutboundItemEmailPayload | null;
}

function normalizeSku(sku?: string | null): string | undefined {
  const normalized = sku?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function resolveItemSkuForUpdate(sku?: string | null): string | undefined {
  if (sku === undefined) {
    return undefined;
  }

  return normalizeSku(sku) ?? generateAutoSku('ITM');
}

function generateAutoSku(prefix: 'ITM'): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function extractDirectOutboundNote(note: string | null | undefined): string | null {
  if (!note) {
    return null;
  }

  const directOutboundPrefix = /^\[ITEM_DIRETO_OUTBOUND\]\s*/i;
  if (!directOutboundPrefix.test(note)) {
    return null;
  }

  const cleaned = note.replace(directOutboundPrefix, '').trim();
  return cleaned || null;
}

function normalizePurchaseSourceInput(
  input: Array<{ source?: string; price?: string }> | undefined,
): ItemPurchaseSourceRecordInput[] | undefined {
  if (!input) {
    return undefined;
  }

  return input
    .map((row, index) => {
      const source = row.source?.trim() || null;
      const price = row.price ? toDecimal(row.price) : null;
      return {
        source,
        price,
        sortOrder: index,
      };
    })
    .filter((row) => row.source != null || row.price != null);
}

function serializeItem(item: {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: Prisma.Decimal;
  purchaseLeadTimeDays: Prisma.Decimal | null;
  qtyOnHand: Prisma.Decimal;
  minQty: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
  purchaseSources?: Array<{
    id: string;
    source: string | null;
    price: Prisma.Decimal | null;
    sortOrder: number;
  }>;
}): ItemResponse {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    unitPrice: decimalToString(item.unitPrice) ?? '0',
    purchaseLeadTimeDays: decimalToString(item.purchaseLeadTimeDays),
    purchaseSources: (item.purchaseSources ?? []).map((source) => ({
      id: source.id,
      source: source.source,
      price: decimalToString(source.price),
      sortOrder: source.sortOrder,
    })),
    qtyOnHand: decimalToString(item.qtyOnHand) ?? '0',
    minQty: decimalToString(item.minQty),
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
    name: string | null;
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
    const purchaseLeadTimeDays = input.purchaseLeadTimeDays ? toDecimal(input.purchaseLeadTimeDays) : null;
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
          purchaseLeadTimeDays,
          qtyOnHand,
          minQty,
          purchaseSources: normalizePurchaseSourceInput(input.purchaseSources),
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

  async update(id: string, input: ItemUpdateBody, actor: JwtUserPayload): Promise<ItemResponse> {
    const nextQtyOnHand = input.qtyOnHand === undefined ? undefined : toDecimal(input.qtyOnHand);

    if (nextQtyOnHand?.isNegative()) {
      throw appErrors.badRequest('qtyOnHand must be non-negative');
    }

    const item = await this.itemsRepository.transaction(async (tx) => {
      const existing = await tx.item.findUnique({ where: { id } });
      if (!existing) {
        throw appErrors.notFound('Item not found');
      }

      const updated = await this.itemsRepository.update(
        id,
        {
          name: input.name?.trim(),
          sku: resolveItemSkuForUpdate(input.sku),
          unit: input.unit?.trim(),
          unitPrice: input.unitPrice ? toDecimal(input.unitPrice) : undefined,
          purchaseLeadTimeDays:
            input.purchaseLeadTimeDays === undefined
              ? undefined
              : input.purchaseLeadTimeDays === null
                ? null
                : toDecimal(input.purchaseLeadTimeDays),
          purchaseSources: normalizePurchaseSourceInput(input.purchaseSources),
          qtyOnHand: nextQtyOnHand,
          minQty:
            input.minQty === undefined
              ? undefined
              : input.minQty === null
                ? null
                : toDecimal(input.minQty),
        },
        tx,
      );

      if (nextQtyOnHand !== undefined) {
        const deltaQty = nextQtyOnHand.sub(existing.qtyOnHand);
        if (!deltaQty.isZero()) {
          await this.itemsRepository.createMovement(
            {
              itemId: id,
              deltaQty,
              reason: 'MANUAL_ADJUSTMENT',
              referenceType: 'MANUAL_ADJUSTMENT',
              note: 'Ajuste de estoque pela edicao do item',
              createdByUserId: actor.sub,
            },
            tx,
          );
        }
      }

      return updated;
    });

    return serializeItem(item);
  }

  async remove(id: string): Promise<ItemResponse> {
    const existing = await this.itemsRepository.getById(id);
    if (!existing) {
      throw appErrors.notFound('Item not found');
    }

    try {
      const item = await this.itemsRepository.delete(id);
      return serializeItem(item);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw appErrors.conflict('Item nao pode ser removido porque possui movimentacoes/BOM/ordens vinculadas');
      }
      throw error;
    }
  }

  async adjustStock(id: string, input: StockAdjustmentBody, actor: JwtUserPayload): Promise<StockAdjustmentResult> {
    const deltaQty = toDecimal(input.deltaQty);

    if (deltaQty.isZero()) {
      throw appErrors.badRequest('deltaQty must not be zero');
    }

    if (input.allowNegativeOverride && actor.role !== 'ADMIN') {
      throw appErrors.forbidden('Somente ADMIN pode usar override de estoque negativo');
    }

    const result = await this.itemsRepository.transaction(async (tx) => {
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

      const movement = await this.itemsRepository.createMovement(
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

      const directOutboundNote = extractDirectOutboundNote(input.note ?? null);
      const directOutboundEmailPayload =
        deltaQty.isNegative() && directOutboundNote !== null
          ? {
              referenceId: movement.referenceId ?? movement.id,
              itemName: updated.name,
              itemSku: updated.sku,
              itemUnit: updated.unit,
              itemQty: decimalToString(deltaQty.abs()) ?? '0',
              itemUnitPrice: decimalToString(updated.unitPrice) ?? '0',
              estimatedCost: decimalToString(deltaQty.abs().mul(updated.unitPrice)) ?? '0',
              previousQtyOnHand: decimalToString(existing.qtyOnHand) ?? '0',
              nextQtyOnHand: decimalToString(updated.qtyOnHand) ?? '0',
              note: directOutboundNote,
              createdAt: movement.createdAt.toISOString(),
              actorName: movement.createdByUser.name ?? null,
              actorEmail: movement.createdByUser.email,
            }
          : null;

      return {
        item: updated,
        directOutboundEmailPayload,
      };
    });

    return {
      item: serializeItem(result.item),
      directOutboundEmailPayload: result.directOutboundEmailPayload,
    };
  }
}
