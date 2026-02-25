import { z } from 'zod';

const emailSchema = z.string().trim().email().max(255);
const nameSchema = z.string().trim().min(1).max(120);

export const userIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const userCreateBodySchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z.string().min(8).max(128),
  role: z.enum(['ADMIN', 'USER']).optional().default('USER'),
});

export type UserCreateBody = z.infer<typeof userCreateBodySchema>;

export const userUpdateBodySchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(['ADMIN', 'USER']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field is required');

export type UserUpdateBody = z.infer<typeof userUpdateBodySchema>;

export const selfProfileUpdateBodySchema = z.object({
  name: nameSchema,
});

export type SelfProfileUpdateBody = z.infer<typeof selfProfileUpdateBodySchema>;
