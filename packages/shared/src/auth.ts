import { z } from 'zod';

import { roleSchema } from './common';

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: roleSchema.optional(),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: roleSchema,
  createdAt: z.string().datetime(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const authTokenResponseSchema = z.object({
  accessToken: z.string(),
  user: authUserSchema,
});

export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>;
