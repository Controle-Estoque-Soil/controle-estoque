import { z } from 'zod';

export const itemFormSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  sku: z.string().min(1, 'SKU é obrigatório'),
  unit: z.string().min(1, 'Unidade é obrigatória'),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, 'Preço inválido'),
  qtyOnHand: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade inválida').default('0'),
  minQty: z.string().regex(/^\d+(\.\d+)?$/, 'Estoque mínimo inválido').optional().or(z.literal('')),
  active: z.boolean().default(true),
});

export const productFormSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  sku: z.string().min(1, 'SKU é obrigatório'),
  active: z.boolean().default(true),
});

export const operationFormSchema = z.object({
  productId: z.string().min(1, 'Selecione um produto'),
  qty: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade inválida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
  note: z.string().optional(),
  allowNegativeOverride: z.boolean().default(false),
});

export const bomLineSchema = z.object({
  itemId: z.string().min(1, 'Selecione um item'),
  qtyRequired: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade inválida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
});

