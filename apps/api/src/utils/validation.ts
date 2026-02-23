import type { ZodTypeAny, infer as ZodInfer } from 'zod';

export function parseWithSchema<TSchema extends ZodTypeAny>(
  schema: TSchema,
  data: unknown,
): ZodInfer<TSchema> {
  return schema.parse(data);
}
