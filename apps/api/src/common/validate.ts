import type { z } from 'zod';

/** Validasi input dengan skema Zod bersama; ZodError diubah jadi 400 oleh AllExceptionsFilter. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  return schema.parse(input);
}
