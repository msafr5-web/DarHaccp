import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { findRecordsByBatch } from '../models/record.model';
import { exportItems, importItems } from '../services/itemsExcel.service';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { uuid } from '../utils/schemas';

const TZ = env.APP_TIMEZONE.replace(/[^A-Za-z0-9_/+-]/g, '');
const storage = z.enum(['CHILLED', 'FROZEN', 'AMBIENT', 'SENSITIVE']);

// ---------------------------------------------------------------- item master

export const itemsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  all: z.enum(['true', 'false']).optional(),
});

export const itemSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._/-]{0,39}$/, 'كود الصنف: أحرف إنجليزية وأرقام (حتى 40)'),
  nameAr: z.string().trim().min(2).max(150),
  nameEn: z.string().trim().max(150).optional(),
  category: z.string().trim().max(60).optional(),
  storageCondition: storage.default('AMBIENT'),
  unit: z.string().trim().min(1).max(20).default('وحدة'),
});

export const itemUpdateSchema = z
  .object({
    nameAr: z.string().trim().min(2).max(150),
    nameEn: z.string().trim().max(150).nullable(),
    category: z.string().trim().max(60).nullable(),
    storageCondition: storage,
    unit: z.string().trim().min(1).max(20),
    isActive: z.boolean(),
  })
  .partial();

const ITEM_COLUMNS = `i.id, i.code, i.name_ar, i.name_en, i.category, i.storage_condition, i.unit, i.is_active, i.created_at,
  COALESCE((SELECT SUM(b.quantity) FROM stock_batches b WHERE UPPER(b.item_code) = UPPER(i.code)), 0)::float AS stock_quantity,
  (SELECT COUNT(*)::int FROM stock_batches b WHERE UPPER(b.item_code) = UPPER(i.code) AND b.quantity > 0) AS batches_count`;

export async function listItems(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof itemsQuery>;
  const { rows } = await query(
    `SELECT ${ITEM_COLUMNS} FROM items i
      WHERE ($1::boolean OR i.is_active)
        AND ($2::text IS NULL OR i.code ILIKE $2 OR i.name_ar ILIKE $2 OR i.name_en ILIKE $2 OR i.category ILIKE $2)
      ORDER BY i.code LIMIT 1000`,
    [q.all === 'true', q.search ? `%${q.search}%` : null],
  );
  return ok(res, rows);
}

export async function createItem(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof itemSchema>;
  const id = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO items (code, name_ar, name_en, category, storage_condition, unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.code, b.nameAr, b.nameEn ?? null, b.category ?? null, b.storageCondition, b.unit],
    );
    return rows[0]!.id;
  }).catch((err) => {
    if ((err as { code?: string }).code === '23505') throw AppError.conflict(`كود الصنف ${b.code} مسجّل مسبقاً`);
    throw err;
  });
  const { rows } = await query(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = $1`, [id]);
  return created(res, rows[0]);
}

/** The code is the key used in every record and stock batch, so it never changes; deactivate instead. */
export async function updateItem(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof itemUpdateSchema>;
  const r = await withTransaction(dbContext(req), (db) => db.query(
    `UPDATE items SET name_ar = COALESCE($2, name_ar),
            name_en = CASE WHEN $3::boolean THEN $4 ELSE name_en END,
            category = CASE WHEN $5::boolean THEN $6 ELSE category END,
            storage_condition = COALESCE($7, storage_condition), unit = COALESCE($8, unit), is_active = COALESCE($9, is_active)
      WHERE id = $1`,
    [id, b.nameAr ?? null, b.nameEn !== undefined, b.nameEn ?? null, b.category !== undefined, b.category ?? null,
      b.storageCondition ?? null, b.unit ?? null, b.isActive ?? null],
  ));
  if (!r.rowCount) throw AppError.notFound('Item');
  const { rows } = await query(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = $1`, [id]);
  return ok(res, rows[0]);
}

// ---------------------------------------------------------------- Excel export / import

export const exportQuery = z.object({ template: z.enum(['true', 'false']).optional() });
export const importQuery = z.object({ apply: z.enum(['true', 'false']).default('false') });

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function exportItemsXlsx(req: Request, res: Response) {
  const { template } = req.valid.query as z.infer<typeof exportQuery>;
  const user = requireUser(req);
  const file = await exportItems(user.tenantName, template === 'true');
  const name = template === 'true' ? 'items-template.xlsx' : `items-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(file);
}

/** Body: the raw .xlsx file. `apply=false` → preview (changes + row errors); `apply=true` → all-or-nothing. */
export async function importItemsXlsx(req: Request, res: Response) {
  const { apply } = req.valid.query as z.infer<typeof importQuery>;
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw AppError.badRequest('أرسل ملف Excel (.xlsx)');
  return ok(res, await importItems(dbContext(req), req.body, apply === 'true'));
}

// ---------------------------------------------------------------- FEFO stock

export const batchesQuery = z.object({
  item: z.string().trim().max(40).optional(),
  status: z.enum(['available', 'expiring', 'expired', 'all']).default('available'),
});

/**
 * Batches in FEFO order (earliest expiry first) with days remaining and status. `fefo_next` marks the
 * batch that must be issued first for its item (non-expired, with stock).
 */
export async function listBatches(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof batchesQuery>;
  const { rows } = await query(
    `WITH b AS (
       SELECT b.id, b.item_code, COALESCE(i.name_ar, b.item_code) AS item_name, i.unit, i.storage_condition, b.batch_number,
              to_char(b.expiry_date, 'YYYY-MM-DD') AS expiry_date, b.quantity::float AS quantity, b.updated_at,
              (b.expiry_date - (now() AT TIME ZONE '${TZ}')::date) AS days_remaining
         FROM stock_batches b
         LEFT JOIN items i ON i.tenant_id = b.tenant_id AND UPPER(i.code) = UPPER(b.item_code)
        WHERE ($1::text IS NULL OR UPPER(b.item_code) = UPPER($1))
     )
     SELECT b.*, CASE WHEN days_remaining < 0 THEN 'Expired' WHEN days_remaining <= 7 THEN 'Expiring Soon' ELSE 'Safe' END AS expiry_alert_status,
            (quantity > 0 AND days_remaining >= 0 AND id = (
               SELECT x.id FROM b x WHERE UPPER(x.item_code) = UPPER(b.item_code) AND x.quantity > 0 AND x.days_remaining >= 0
                ORDER BY x.expiry_date, x.batch_number LIMIT 1)) AS fefo_next
       FROM b
      WHERE CASE $2::text
              WHEN 'available' THEN quantity > 0
              WHEN 'expiring' THEN quantity > 0 AND days_remaining BETWEEN 0 AND 7
              WHEN 'expired' THEN quantity > 0 AND days_remaining < 0
              ELSE TRUE END
      ORDER BY item_code, expiry_date, batch_number
      LIMIT 2000`,
    [q.item ?? null, q.status],
  );
  return ok(res, rows);
}

export async function batchMovements(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const { rows } = await query(
    `SELECT m.id, m.movement, m.quantity_before::float AS quantity_before, m.quantity_after::float AS quantity_after,
            m.created_at, u.full_name AS created_by_name, m.record_id, d.code AS department_code
       FROM stock_movements m JOIN users u ON u.id = m.created_by
       JOIN monitoring_records r ON r.id = m.record_id JOIN departments d ON d.id = r.department_id
      WHERE m.stock_batch_id = $1 ORDER BY m.created_at DESC LIMIT 500`,
    [id],
  );
  return ok(res, rows);
}

// ---------------------------------------------------------------- traceability (recall)

export const traceQuery = z.object({ batch: z.string().trim().min(1).max(80) });

/**
 * Reverse traceability of a batch / lot: every form record that mentions it (receipt, inspection, counts,
 * issues…), its stock balance and movements, and the non-conformity reports opened for it.
 */
export async function traceability(req: Request, res: Response) {
  const { batch } = req.valid.query as z.infer<typeof traceQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), undefined);
  const [records, batches] = await Promise.all([
    findRecordsByBatch(batch, departmentId),
    query(
      `SELECT b.id, b.item_code, COALESCE(i.name_ar, b.item_code) AS item_name, b.batch_number,
              to_char(b.expiry_date, 'YYYY-MM-DD') AS expiry_date, b.quantity::float AS quantity,
              (SELECT COALESCE(SUM(m.quantity_before - m.quantity_after), 0)::float FROM stock_movements m
                WHERE m.stock_batch_id = b.id AND m.movement = 'ISSUE') AS issued_total
         FROM stock_batches b LEFT JOIN items i ON i.tenant_id = b.tenant_id AND UPPER(i.code) = UPPER(b.item_code)
        WHERE UPPER(b.batch_number) = UPPER($1)`,
      [batch],
    ),
  ]);
  const ids = records.map((r) => r.id);
  const ncrs = ids.length
    ? (await query(
        `SELECT i.id, i.incident_no, i.title, i.status, i.severity, i.record_id, i.occurred_at FROM incidents i
          WHERE i.record_id = ANY($1::uuid[]) ORDER BY i.occurred_at`,
        [ids],
      )).rows
    : [];
  return ok(res, { batch, records, stock: batches.rows, ncrs });
}

export const idParam = z.object({ id: uuid });
