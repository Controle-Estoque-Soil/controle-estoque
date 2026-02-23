import { z } from 'zod';

export const healthcheckSchema = z.object({
  status: z.literal('ok'),
});

export type Healthcheck = z.infer<typeof healthcheckSchema>;
