import { z } from 'zod';

const nonNegativeDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Invalid non-negative decimal value');

const optionalProductLeadTimeSchema = z.string().trim().min(1).max(120);

const optionalSkuSchema = z
  .union([z.string().trim().max(80), z.literal('')])
  .optional();

export const productIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const productDeleteQuerySchema = z.object({
  forceCascadeUsageDelete: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
});

export const productCreateBodySchema = z.object({
  name: z.string().min(1).max(150),
  sku: optionalSkuSchema,
  manufacturingLeadTimeDays: optionalProductLeadTimeSchema.optional(),
  qtyInStock: nonNegativeDecimalStringSchema.optional(),
  qtySoldTotal: nonNegativeDecimalStringSchema.optional(),
});

export type ProductCreateBody = z.infer<typeof productCreateBodySchema>;

export const productUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    sku: optionalSkuSchema,
    manufacturingLeadTimeDays: optionalProductLeadTimeSchema.nullable().optional(),
    qtyInStock: nonNegativeDecimalStringSchema.optional(),
    qtySoldTotal: nonNegativeDecimalStringSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field is required');

export type ProductUpdateBody = z.infer<typeof productUpdateBodySchema>;

export const productListQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: z.enum(['FINAL', 'INTERMEDIATE']).optional(),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productBomReplaceBodySchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyRequired: nonNegativeDecimalStringSchema.refine((value) => !/^0(?:\.0+)?$/.test(value), {
          message: 'qtyRequired must be greater than zero',
        }),
      }),
    )
    .default([]),
  intermediateProducts: z
    .array(
      z.object({
        intermediateProductId: z.string().min(1),
        qtyRequired: nonNegativeDecimalStringSchema.refine((value) => !/^0(?:\.0+)?$/.test(value), {
          message: 'qtyRequired must be greater than zero',
        }),
      }),
    )
    .optional(),
});

export type ProductBomReplaceBody = z.infer<typeof productBomReplaceBodySchema>;
export type ProductDeleteQuery = z.infer<typeof productDeleteQuerySchema>;
