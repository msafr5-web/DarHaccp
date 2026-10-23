import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, runAsSystem } from '../config/database';
import { DEPARTMENTS } from '../config/permissions';
import * as catalog from '../services/formCatalog.service';
import { formFieldsSchema } from '../services/haccpRules';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok } from '../utils/http';
import { optText, uuid } from '../utils/schemas';

/** Platform administrator: the form library and the forms ("features") enabled for each company. */

export const catalogIdParams = z.object({ id: uuid });
export const tenantFormParams = z.object({ id: z.coerce.number().int().positive(), catalogId: uuid });

const base = {
  titleAr: z.string().trim().min(2).max(200),
  titleEn: z.string().trim().min(2).max(200),
  category: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Category like HACCP or WMS_GDP'),
  department: z.enum(DEPARTMENTS).nullable(),
  ccpCode: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/).nullable(),
  fields: formFieldsSchema,
  minDailyEntries: z.number().int().min(0).max(24),
  isDefault: z.boolean(),
};

export const catalogCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{3,50}$/, 'Code like COLD_ROOM_CHECK'),
  description: optText(2000),
  ...base,
  department: base.department.default(null),
  ccpCode: base.ccpCode.default(null),
  category: base.category.default('HACCP'),
  minDailyEntries: base.minDailyEntries.default(0),
  isDefault: base.isDefault.default(false),
});

export const catalogUpdateSchema = z
  .object({ ...base, description: z.string().trim().max(2000).nullable(), isActive: z.boolean() })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'لا توجد تغييرات' });

export const tenantFieldsSchema = z.object({ fields: formFieldsSchema });

export async function list(_req: Request, res: Response) {
  return ok(res, await runAsSystem(() => catalog.listCatalog()));
}

export async function get(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof catalogIdParams>;
  const form = await runAsSystem(() => catalog.findCatalog(id));
  if (!form) throw AppError.notFound('Library form');
  return ok(res, form);
}

export async function create(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof catalogCreateSchema>;
  return created(res, await catalog.createCatalog(dbContext(req), b));
}

/** Field changes reach every company copy that was not customised (new form version). */
export async function update(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof catalogIdParams>;
  return ok(res, await catalog.updateCatalog(dbContext(req), id, req.valid.body as catalog.CatalogUpdate));
}

async function activeCompany(id: number) {
  const { rows } = await runAsSystem(() => query<{ status: string; is_platform: boolean }>('SELECT status, is_platform FROM tenants WHERE id = $1', [id]));
  if (!rows[0] || rows[0].is_platform) throw AppError.notFound('Company');
  if (rows[0].status !== 'ACTIVE') throw AppError.conflict('النماذج تُفعَّل للشركات المعتمدة (النشطة) فقط');
  return id;
}

export async function tenantForms(req: Request, res: Response) {
  const { id } = req.valid.params as { id: number };
  return ok(res, await runAsSystem(() => catalog.listTenantForms(id)));
}

export async function tenantForm(req: Request, res: Response) {
  const { id, catalogId } = req.valid.params as z.infer<typeof tenantFormParams>;
  return ok(res, await catalog.getTenantFormFields(id, catalogId));
}

export async function enable(req: Request, res: Response) {
  const { id, catalogId } = req.valid.params as z.infer<typeof tenantFormParams>;
  return ok(res, await catalog.enableTenantForm(dbContext(req), await activeCompany(id), catalogId));
}

export async function disable(req: Request, res: Response) {
  const { id, catalogId } = req.valid.params as z.infer<typeof tenantFormParams>;
  return ok(res, await catalog.disableTenantForm(dbContext(req), id, catalogId));
}

export async function customize(req: Request, res: Response) {
  const { id, catalogId } = req.valid.params as z.infer<typeof tenantFormParams>;
  const { fields } = req.valid.body as z.infer<typeof tenantFieldsSchema>;
  return ok(res, await catalog.customizeTenantForm(dbContext(req), await activeCompany(id), catalogId, fields));
}

export async function reset(req: Request, res: Response) {
  const { id, catalogId } = req.valid.params as z.infer<typeof tenantFormParams>;
  return ok(res, await catalog.resetTenantForm(dbContext(req), await activeCompany(id), catalogId));
}
