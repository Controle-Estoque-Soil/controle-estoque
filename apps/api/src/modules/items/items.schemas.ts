import { z } from 'zod';

const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Invalid decimal value');

const nonNegativeDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Invalid non-negative decimal value');

export const itemIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const itemCreateBodySchema = z.object({
  name: z.string().min(1).max(150),
  sku: z.string().min(1).max(80),
  unit: z.string().min(1).max(20),
  unitPrice: nonNegativeDecimalStringSchema,
  qtyOnHand: nonNegativeDecimalStringSchema.default('0'),
  minQty: nonNegativeDecimalStringSchema.nullable().optional(),
  active: z.boolean().optional().default(true),
});

export type ItemCreateBody = z.infer<typeof itemCreateBodySchema>;

export const itemUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    sku: z.string().min(1).max(80).optional(),
    unit: z.string().min(1).max(20).optional(),
    unitPrice: nonNegativeDecimalStringSchema.optional(),
    minQty: nonNegativeDecimalStringSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field is required');

export type ItemUpdateBody = z.infer<typeof itemUpdateBodySchema>;

export const itemListQuerySchema = z.object({
  search: z.string().trim().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  belowMin: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ItemListQuery = z.infer<typeof itemListQuerySchema>;

export const stockAdjustmentBodySchema = z.object({
  deltaQty: decimalStringSchema.refine((value) => !/^0(?:\.0+)?$/.test(value), {
    message: 'deltaQty must not be zero',
  }),
  note: z.string().max(500).optional(),
  allowNegativeOverride: z.boolean().optional().default(false),
});

export type StockAdjustmentBody = z.infer<typeof stockAdjustmentBodySchema>;
