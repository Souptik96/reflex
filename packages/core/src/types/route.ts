import { z } from 'zod';

export const ReflexRouteSchema = z.enum([
  'FAST_PATH',
  'CODE_MODE',
  'ASK_USER',
  'BLOCK',
  'FALLBACK',
]);

export type ReflexRoute = z.infer<typeof ReflexRouteSchema>;
