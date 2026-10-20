import { z } from 'zod';
import { DEPARTMENTS } from '../config/permissions';

export const uuid = z.uuid('Invalid id');
export const idParams = z.object({ id: uuid });
export const isoDate = z.iso.date();
export const isoDateTime = z.iso.datetime({ offset: true });
export const departmentCode = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(DEPARTMENTS));

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/** Optional trimmed text; empty strings become undefined. */
export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
