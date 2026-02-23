import { z } from 'zod';

export const roleSchema = z.enum(['ADMIN', 'USER']);
export type Role = z.infer<typeof roleSchema>;

export const idSchema = z.string().min(1);

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal string');
