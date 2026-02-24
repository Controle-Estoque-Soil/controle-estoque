import { z } from 'zod';

const positiveDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Invalid positive decimal value')
  .refine((value) => !/^0(?:\.0+)?$/.test(value), {
    message: 'Value must be greater than zero',
  });

export const operationExecuteBodySchema = z.object({
  productId: z.string().min(1),
  qty: positiveDecimalStringSchema,
  note: z.string().max(500).optional(),
  allowNegativeOverride: z.boolean().optional().default(false),
});

export type OperationExecuteBody = z.infer<typeof operationExecuteBodySchema>;

export const operationIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const operationListQuerySchema = z.object({
  type: z.enum(['INBOUND_PRODUCT', 'OUTBOUND_PRODUCT']).optional(),
  productId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type OperationListQuery = z.infer<typeof operationListQuerySchema>;

export const movementListQuerySchema = z.object({
  itemId: z.string().optional(),
  reason: z.enum(['MANUAL_ADJUSTMENT', 'PRODUCT_INBOUND', 'PRODUCT_OUTBOUND']).optional(),
  reference: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
