import { z } from 'zod';

const nonNegativeDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Invalid non-negative decimal value');

const optionalSkuSchema = z
  .union([z.string().trim().max(80), z.literal('')])
  .optional();

export const productIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const productCreateBodySchema = z.object({
  name: z.string().min(1).max(150),
  sku: optionalSkuSchema,
  manufacturingLeadTimeDays: nonNegativeDecimalStringSchema.optional(),
  qtyInStock: nonNegativeDecimalStringSchema.optional(),
  qtySoldTotal: nonNegativeDecimalStringSchema.optional(),
});

export type ProductCreateBody = z.infer<typeof productCreateBodySchema>;

export const productUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    sku: optionalSkuSchema,
    manufacturingLeadTimeDays: nonNegativeDecimalStringSchema.nullable().optional(),
    qtyInStock: nonNegativeDecimalStringSchema.optional(),
    qtySoldTotal: nonNegativeDecimalStringSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field is required');

export type ProductUpdateBody = z.infer<typeof productUpdateBodySchema>;

export const productListQuerySchema = z.object({
  search: z.string().trim().optional(),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productBomReplaceBodySchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().min(1),
      qtyRequired: nonNegativeDecimalStringSchema.refine((value) => !/^0(?:\.0+)?$/.test(value), {
        message: 'qtyRequired must be greater than zero',
      }),
    }),
  ),
});

export type ProductBomReplaceBody = z.infer<typeof productBomReplaceBodySchema>;
