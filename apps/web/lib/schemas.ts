import { z } from 'zod';

export const itemFormSchema = z.object({
  name: z.string().min(1, 'Nome e obrigatorio'),
  sku: z.string().trim().max(80, 'SKU invalido'),
  unit: z.string().min(1, 'Unidade e obrigatoria'),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, 'Preco invalido'),
  purchaseLeadTimeDays: z.union([z.literal(''), z.string().regex(/^\d+(\.\d+)?$/, 'Tempo medio invalido')]).default(''),
  qtyOnHand: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').default('0'),
  minQty: z.string().regex(/^\d+(\.\d+)?$/, 'Estoque minimo invalido'),
});

export const productFormSchema = z.object({
  name: z.string().min(1, 'Nome e obrigatorio'),
  sku: z.string().trim().max(80, 'SKU invalido'),
  qtyInStock: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade em estoque invalida').default('0'),
  qtySoldTotal: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade vendida invalida').default('0'),
});

export const operationFormSchema = z.object({
  productId: z.string().min(1, 'Selecione um produto'),
  qty: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
  note: z.string().optional(),
  allowNegativeOverride: z.boolean().default(false),
});

export const productInboundSourceSchema = z
  .string()
  .trim()
  .min(1, 'Origem e obrigatoria para entrada de produto')
  .max(500, 'Origem invalida');

export const itemOperationFormSchema = z.object({
  itemId: z.string().min(1, 'Selecione um item'),
  qty: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
  source: z.string().trim().max(500, 'Origem invalida').optional(),
  note: z.string().trim().optional(),
  allowNegativeOverride: z.boolean().default(false),
});

export const bomLineSchema = z.object({
  itemId: z.string().min(1, 'Selecione um item'),
  qtyRequired: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
});
