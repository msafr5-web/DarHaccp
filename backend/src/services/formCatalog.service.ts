import type { PoolClient } from 'pg';
import { DbContext, query, Queryable, withTransaction } from '../config/database';
import { prdForms, type CatalogSeed } from '../db/prdForms';
import * as data from '../db/seedData';
import type { FormField } from '../models/haccp.model';
import { AppError } from '../utils/AppError';
import { generateQrToken } from './qr.service';

/**
 * Platform form library. The platform administrator maintains the forms (adds / removes fields)
 * and decides which forms ("features") each company gets. A company receives its own copy with
 * its own QR code; library changes flow to every company copy that was not customised for it.
 */

export interface CatalogForm {
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  description: string | null;
  category: string;
  department_code: string | null;
  ccp_code: string | null;
  fields: FormField[];
  min_daily_entries: number;
  version: number;
  is_default: boolean;
  is_active: boolean;
  companies_count?: number;
}

/** Built-in library: the kitchen HACCP logs (given to every company) and the PRD warehouse / GDP forms. */
export function catalogSeeds(): CatalogSeed[] {
  return [
    ...data.templates.map((t): CatalogSeed => ({
      code: t.code, titleAr: t.titleAr, titleEn: t.titleEn, category: 'HACCP', department: t.department, ccp: t.ccp,
      isDefault: true, fields: t.fields,
    })),
    ...prdForms,
  ];
}

/**
 * Idempotent (run by the seed on every deployment): adds library forms that do not exist yet —
 * edits made by the platform administrator are never overwritten — and links company forms
 * created before the library existed to their library entry.
 */
export async function syncCatalogSeed(db: Queryable) {
  for (const s of catalogSeeds()) {
    await db.query(
      `INSERT INTO form_catalog (code, title_ar, title_en, description, category, department_code, ccp_code, fields,
                                 min_daily_entries, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
      [s.code, s.titleAr, s.titleEn, s.description ?? null, s.category, s.department, s.ccp, JSON.stringify(s.fields),
        s.minDailyEntries ?? 0, s.isDefault],
    );
  }
  await db.query(
    `UPDATE form_templates t
        SET catalog_id = c.id, catalog_version = c.version, min_daily_entries = c.min_daily_entries,
            customized = (t.fields IS DISTINCT FROM c.fields)
       FROM form_catalog c
      WHERE t.catalog_id IS NULL AND t.code = c.code`,
  );
}

/** Keeps the company's own option lists (e.g. approved suppliers) when library fields change. */
export function mergeCompanyOptions(next: FormField[], previous: FormField[]): FormField[] {
  return next.map((f) => {
    if (!f.companyOptions) return f;
    const old = previous.find((p) => p.key === f.key && p.companyOptions);
    return old?.options?.length ? { ...f, options: old.options } : f;
  });
}

// ---------------------------------------------------------------- library (platform administrator)

export async function listCatalog() {
  const { rows } = await query<CatalogForm>(
    `SELECT c.*, (SELECT COUNT(*)::int FROM form_templates t WHERE t.catalog_id = c.id AND t.is_active) AS companies_count
       FROM form_catalog c ORDER BY c.category, c.code`,
  );
  return rows;
}

export async function findCatalog(id: string, db: Queryable = { query }) {
  const { rows } = await db.query<CatalogForm>('SELECT * FROM form_catalog WHERE id = $1', [id]);
  return rows[0];
}

export interface CatalogInput {
  code: string;
  titleAr: string;
  titleEn: string;
  description?: string | null;
  category: string;
  department: string | null;
  ccpCode: string | null;
  fields: FormField[];
  minDailyEntries: number;
  isDefault: boolean;
}

export async function createCatalog(ctx: DbContext, b: CatalogInput) {
  return withTransaction({ ...ctx, bypass: true }, async (db) => {
    const { rows } = await db.query<CatalogForm>(
      `INSERT INTO form_catalog (code, title_ar, title_en, description, category, department_code, ccp_code, fields,
                                 min_daily_entries, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.code, b.titleAr, b.titleEn, b.description ?? null, b.category, b.department, b.ccpCode, JSON.stringify(b.fields),
        b.minDailyEntries, b.isDefault],
    ).catch((err) => {
      if ((err as { code?: string }).code === '23505') throw AppError.conflict(`رمز النموذج ${b.code} مستخدم مسبقاً`);
      throw err;
    });
    return rows[0]!;
  });
}

export type CatalogUpdate = Partial<Omit<CatalogInput, 'code'>> & { isActive?: boolean };

/**
 * Updates a library form. Field changes bump the version and are applied to every company copy
 * that was not customised (records keep the version they were captured with). Each company's
 * change is written under that company's scope so it appears in the company's own audit trail.
 */
export async function updateCatalog(ctx: DbContext, id: string, b: CatalogUpdate) {
  return withTransaction({ ...ctx, bypass: true }, async (db) => {
    const existing = await findCatalog(id, db);
    if (!existing) throw AppError.notFound('Library form');
    const fieldsChanged = b.fields !== undefined && JSON.stringify(b.fields) !== JSON.stringify(existing.fields);

    const { rows } = await db.query<CatalogForm>(
      `UPDATE form_catalog SET title_ar = COALESCE($2, title_ar), title_en = COALESCE($3, title_en),
              description = CASE WHEN $4::boolean THEN $5 ELSE description END,
              category = COALESCE($6, category),
              department_code = CASE WHEN $7::boolean THEN $8::department_code ELSE department_code END,
              ccp_code = CASE WHEN $9::boolean THEN $10 ELSE ccp_code END,
              fields = CASE WHEN $11::boolean THEN $12::jsonb ELSE fields END,
              version = version + CASE WHEN $11::boolean THEN 1 ELSE 0 END,
              min_daily_entries = COALESCE($13, min_daily_entries),
              is_default = COALESCE($14, is_default), is_active = COALESCE($15, is_active)
        WHERE id = $1 RETURNING *`,
      [id, b.titleAr ?? null, b.titleEn ?? null, b.description !== undefined, b.description ?? null, b.category ?? null,
        b.department !== undefined, b.department ?? null, b.ccpCode !== undefined, b.ccpCode ?? null,
        fieldsChanged, fieldsChanged ? JSON.stringify(b.fields) : null, b.minDailyEntries ?? null, b.isDefault ?? null, b.isActive ?? null],
    );
    const updated = rows[0]!;

    const copies = await db.query<{ id: string; tenant_id: number; fields: FormField[]; customized: boolean }>(
      'SELECT id, tenant_id, fields, customized FROM form_templates WHERE catalog_id = $1 ORDER BY tenant_id',
      [id],
    );
    let propagated = 0;
    for (const copy of copies.rows) {
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(copy.tenant_id)]);
      const syncFields = fieldsChanged && !copy.customized;
      await db.query(
        `UPDATE form_templates SET title_ar = $2, title_en = $3, description = $4, min_daily_entries = $5,
                fields = CASE WHEN $6::boolean THEN $7::jsonb ELSE fields END,
                version = version + CASE WHEN $6::boolean THEN 1 ELSE 0 END,
                catalog_version = CASE WHEN $6::boolean THEN $8 ELSE catalog_version END,
                -- A library form withdrawn from the platform is withdrawn from every company.
                is_active = CASE WHEN $9::boolean THEN FALSE ELSE is_active END
          WHERE id = $1`,
        [copy.id, updated.title_ar, updated.title_en, updated.description, updated.min_daily_entries, syncFields,
          syncFields ? JSON.stringify(mergeCompanyOptions(updated.fields, copy.fields)) : null, updated.version, !updated.is_active],
      );
      if (syncFields) propagated++;
    }
    return { ...updated, propagated_to: propagated };
  });
}

// ---------------------------------------------------------------- features of one company

export interface TenantForm {
  catalog_id: string;
  code: string;
  title_ar: string;
  title_en: string;
  category: string;
  catalog_version: number;
  catalog_active: boolean;
  is_default: boolean;
  template_id: string | null;
  enabled: boolean;
  customized: boolean;
  version: number | null;
  synced_version: number | null;
  records_count: number;
}

/** The whole library with, for this company, whether each form is enabled / customised. */
export async function listTenantForms(tenantId: number) {
  const { rows } = await query<TenantForm>(
    `SELECT c.id AS catalog_id, c.code, c.title_ar, c.title_en, c.category, c.version AS catalog_version,
            c.is_active AS catalog_active, c.is_default,
            t.id AS template_id, COALESCE(t.is_active, FALSE) AS enabled, COALESCE(t.customized, FALSE) AS customized,
            t.version, t.catalog_version AS synced_version,
            (SELECT COUNT(*)::int FROM monitoring_records r WHERE r.template_id = t.id) AS records_count
       FROM form_catalog c
       LEFT JOIN form_templates t ON t.catalog_id = c.id AND t.tenant_id = $1
      ORDER BY c.category, c.code`,
    [tenantId],
  );
  return rows;
}

async function insertCompanyCopy(db: Queryable, c: CatalogForm) {
  await db.query(
    `INSERT INTO form_templates (code, title_ar, title_en, description, department_id, ccp_id, fields, qr_token,
                                 catalog_id, catalog_version, min_daily_entries)
     VALUES ($1, $2, $3, $4, (SELECT id FROM departments WHERE code = $5::department_code), (SELECT id FROM ccps WHERE code = $6),
             $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, code) DO UPDATE SET catalog_id = EXCLUDED.catalog_id, is_active = TRUE`,
    [c.code, c.title_ar, c.title_en, c.description, c.department_code, c.ccp_code, JSON.stringify(c.fields), generateQrToken(),
      c.id, c.version, c.min_daily_entries],
  );
}

/** Demo / onboarding helper: enables the given library category for the current company (copies missing forms only). */
export async function provisionCategory(db: PoolClient, category: string) {
  const { rows } = await db.query<CatalogForm>('SELECT * FROM form_catalog WHERE category = $1 AND is_active ORDER BY code', [category]);
  for (const c of rows) {
    const exists = await db.query('SELECT 1 FROM form_templates WHERE catalog_id = $1 OR code = $2', [c.id, c.code]);
    if (!exists.rowCount) await insertCompanyCopy(db, c);
  }
}

/** Copies every default library form into a new company (runs inside the company's provisioning transaction). */
export async function provisionDefaultForms(db: PoolClient) {
  const { rows } = await db.query<CatalogForm>('SELECT * FROM form_catalog WHERE is_default AND is_active ORDER BY code');
  for (const c of rows) {
    const exists = await db.query('SELECT 1 FROM form_templates WHERE catalog_id = $1 OR code = $2', [c.id, c.code]);
    if (!exists.rowCount) await insertCompanyCopy(db, c);
  }
}

async function loadCompanyCopy(db: Queryable, catalogId: string) {
  const { rows } = await db.query<{ id: string; is_active: boolean; fields: FormField[]; customized: boolean }>(
    'SELECT id, is_active, fields, customized FROM form_templates WHERE catalog_id = $1',
    [catalogId],
  );
  return rows[0];
}

/** Enables a library form for a company: creates its copy with a fresh QR code, or re-activates it. */
export async function enableTenantForm(ctx: DbContext, tenantId: number, catalogId: string) {
  return withTransaction({ ...ctx, tenantId, bypass: false }, async (db) => {
    const c = await findCatalog(catalogId, db);
    if (!c) throw AppError.notFound('Library form');
    if (!c.is_active) throw AppError.conflict('هذا النموذج موقوف في مكتبة المنصة');
    const copy = await loadCompanyCopy(db, catalogId);
    if (copy) await db.query('UPDATE form_templates SET is_active = TRUE WHERE id = $1', [copy.id]);
    else await insertCompanyCopy(db, c);
    return loadCompanyCopy(db, catalogId);
  });
}

/** Disables a form for a company. Its records stay (legal evidence); the QR code stops working. */
export async function disableTenantForm(ctx: DbContext, tenantId: number, catalogId: string) {
  return withTransaction({ ...ctx, tenantId, bypass: false }, async (db) => {
    const copy = await loadCompanyCopy(db, catalogId);
    if (!copy) throw AppError.notFound('Company form');
    await db.query('UPDATE form_templates SET is_active = FALSE WHERE id = $1', [copy.id]);
    return { ...copy, is_active: false };
  });
}

export async function getTenantFormFields(tenantId: number, catalogId: string) {
  return withTransaction({ tenantId, bypass: false }, async (db) => {
    const c = await findCatalog(catalogId, db);
    if (!c) throw AppError.notFound('Library form');
    const copy = await loadCompanyCopy(db, catalogId);
    return { catalog: c, copy: copy ?? null };
  });
}

/** Company-specific fields (the copy stops following library field changes until it is reset). */
export async function customizeTenantForm(ctx: DbContext, tenantId: number, catalogId: string, fields: FormField[]) {
  return withTransaction({ ...ctx, tenantId, bypass: false }, async (db) => {
    const copy = await loadCompanyCopy(db, catalogId);
    if (!copy) throw AppError.unprocessable('فعّل النموذج لهذه الشركة أولاً');
    await db.query(
      `UPDATE form_templates SET fields = $2, customized = TRUE, version = version + 1 WHERE id = $1`,
      [copy.id, JSON.stringify(fields)],
    );
    return loadCompanyCopy(db, catalogId);
  });
}

/** Back to the library fields (company option lists are kept). */
export async function resetTenantForm(ctx: DbContext, tenantId: number, catalogId: string) {
  return withTransaction({ ...ctx, tenantId, bypass: false }, async (db) => {
    const c = await findCatalog(catalogId, db);
    const copy = await loadCompanyCopy(db, catalogId);
    if (!c || !copy) throw AppError.notFound('Company form');
    await db.query(
      `UPDATE form_templates SET fields = $2, customized = FALSE, catalog_version = $3, version = version + 1 WHERE id = $1`,
      [copy.id, JSON.stringify(mergeCompanyOptions(c.fields, copy.fields)), c.version],
    );
    return loadCompanyCopy(db, catalogId);
  });
}
