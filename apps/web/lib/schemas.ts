import { z } from 'zod';

export const itemFormSchema = z.object({
  name: z.string().min(1, 'Nome e obrigatorio'),
  sku: z.string().trim().max(80, 'SKU invalido'),
  unit: z.string().min(1, 'Unidade e obrigatoria'),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, 'Preco invalido'),
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

export const itemOperationFormSchema = z.object({
  itemId: z.string().min(1, 'Selecione um item'),
  qty: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
  note: z.string().trim().min(1, 'Nota e obrigatoria para operacao por item'),
  allowNegativeOverride: z.boolean().default(false),
});

export const bomLineSchema = z.object({
  itemId: z.string().min(1, 'Selecione um item'),
  qtyRequired: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
});
