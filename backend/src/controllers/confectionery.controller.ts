import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, runAsSystem, withTransaction } from '../config/database';
import { env } from '../config/env';
import { findDepartmentByCode } from '../models/department.model';
import { canAccessDepartment } from '../middlewares/auth';
import { buildQrPayload, generateQrToken, renderQrDataUrl } from '../services/qr.service';
import { AppError } from '../utils/AppError';
import { signPath, verifySignedPath } from '../utils/crypto';
import { created, dbContext, ok, paginate, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDateTime, optText, pagination, uuid } from '../utils/schemas';

/** Labels within this many hours of expiry are flagged "use first / expiring". */
const EXPIRING_HOURS = 12;

// ---------------------------------------------------------------- Recipes

const ingredient = z.object({
  name: z.string().trim().min(1).max(100),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().max(20).optional(),
});

export const recipeSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,40}$/),
  nameAr: z.string().trim().min(2).max(150),
  nameEn: z.string().trim().min(2).max(150),
  department: departmentCode,
  ingredients: z.array(ingredient).min(1).max(60),
  allergens: z.array(z.string().trim().min(2).max(40)).max(14).default([]),
  shelfLifeHours: z.number().int().min(1).max(24 * 365),
  storageTempMax: z.number().min(-40).max(40).nullable().default(null),
  storageInstructions: optText(500),
  ccpNotes: optText(1000),
});

export const recipeUpdateSchema = recipeSchema.omit({ code: true, department: true }).partial().extend({ isActive: z.boolean().optional() });

export const listRecipesQuery = z.object({ department: departmentCode.optional() });

export async function listRecipes(req: Request, res: Response) {
  const { department } = req.valid.query as z.infer<typeof listRecipesQuery>;
  const deptId = department ? (await findDepartmentByCode(department))?.id ?? -1 : null;
  const { rows } = await query(
    `SELECT r.*, d.code AS department_code FROM recipes r JOIN departments d ON d.id = r.department_id
      WHERE r.is_active AND ($1::smallint IS NULL OR r.department_id = $1) ORDER BY r.name_ar`,
    [deptId],
  );
  return ok(res, rows);
}

export async function createRecipe(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof recipeSchema>;
  const dept = await findDepartmentByCode(b.department);
  if (!dept) throw AppError.notFound('Department');
  if (!canAccessDepartment(req.user, dept.id)) throw AppError.forbidden();
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `INSERT INTO recipes (code, name_ar, name_en, department_id, ingredients, allergens, shelf_life_hours, storage_temp_max,
                            storage_instructions, ccp_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.code, b.nameAr, b.nameEn, dept.id, JSON.stringify(b.ingredients), b.allergens, b.shelfLifeHours, b.storageTempMax,
        b.storageInstructions ?? null, b.ccpNotes ?? null],
    );
    return rows[0];
  });
  return created(res, row);
}

export async function updateRecipe(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof recipeUpdateSchema>;
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `UPDATE recipes SET name_ar = COALESCE($2, name_ar), name_en = COALESCE($3, name_en),
              ingredients = COALESCE($4::jsonb, ingredients), allergens = COALESCE($5, allergens),
              shelf_life_hours = COALESCE($6, shelf_life_hours),
              storage_temp_max = CASE WHEN $7::boolean THEN $8 ELSE storage_temp_max END,
              storage_instructions = COALESCE($9, storage_instructions), ccp_notes = COALESCE($10, ccp_notes),
              is_active = COALESCE($11, is_active)
        WHERE id = $1 RETURNING *`,
      [id, b.nameAr ?? null, b.nameEn ?? null, b.ingredients ? JSON.stringify(b.ingredients) : null, b.allergens ?? null,
        b.shelfLifeHours ?? null, b.storageTempMax !== undefined, b.storageTempMax ?? null, b.storageInstructions ?? null,
        b.ccpNotes ?? null, b.isActive ?? null],
    );
    return rows[0];
  });
  if (!row) throw AppError.notFound('Recipe');
  return ok(res, row);
}

// ---------------------------------------------------------------- Product data cards (labels)

export const labelSchema = z.object({
  recipeId: uuid,
  batchNo: z.string().trim().min(1).max(60),
  quantity: z.number().int().positive().max(100000),
  unit: optText(20),
  producedAt: isoDateTime.optional(),
});

export const listLabelsQuery = pagination.extend({
  status: z.enum(['ACTIVE', 'CONSUMED', 'DISCARDED']).optional(),
  state: z.enum(['FRESH', 'EXPIRING', 'EXPIRED']).optional(),
  department: departmentCode.optional(),
});

export const labelStatusSchema = z.object({
  status: z.enum(['CONSUMED', 'DISCARDED']),
  reason: optText(500),
});

const LABEL_SELECT = `
  SELECT l.*, d.code AS department_code, u.full_name AS produced_by_name,
         ROUND(EXTRACT(EPOCH FROM (l.expires_at - now())) / 3600.0, 1)::float AS hours_left,
         CASE WHEN l.expires_at <= now() THEN 'EXPIRED'
              WHEN l.expires_at <= now() + make_interval(hours => ${EXPIRING_HOURS}) THEN 'EXPIRING'
              ELSE 'FRESH' END AS state
    FROM product_labels l JOIN departments d ON d.id = l.department_id JOIN users u ON u.id = l.produced_by`;

async function loadLabel(req: Request | null, id: string) {
  const { rows } = await query<{ department_id: number; id: string }>(`${LABEL_SELECT} WHERE l.id = $1`, [id]);
  if (!rows[0] || (req && !canAccessDepartment(req.user, rows[0].department_id))) throw AppError.notFound('Label');
  return rows[0];
}

const printPath = (id: string) => `/api/v1/labels/${id}/print`;

export async function listLabels(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listLabelsQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.status) where.push(`x.status = $${params.push(q.status)}`);
  if (q.state) where.push(`x.state = $${params.push(q.state)}`);
  if (departmentId) where.push(`x.department_id = $${params.push(departmentId)}`);
  const { limit, offset } = paginate(q.page, q.pageSize);
  const { rows } = await query<{ total: number }>(
    `SELECT x.*, COUNT(*) OVER()::int AS total FROM (${LABEL_SELECT}) x
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (x.status = 'ACTIVE') DESC, x.expires_at ASC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  return ok(res, rows.map(({ total: _t, ...r }) => r), { page: q.page, pageSize: q.pageSize, total: rows[0]?.total ?? 0 });
}

export async function getLabel(req: Request, res: Response) {
  const label = await loadLabel(req, (req.valid.params as { id: string }).id);
  return ok(res, { ...label, printUrl: signPath(printPath(label.id)) });
}

/** Creates a data card: production time + recipe shelf life → expiry; recipe snapshot for traceability. */
export async function createLabel(req: Request, res: Response) {
  const user = requireUser(req);
  const b = req.valid.body as z.infer<typeof labelSchema>;
  const { rows: recipes } = await query<{ id: string; name_ar: string; department_id: number; ingredients: unknown; allergens: string[];
    storage_temp_max: number | null; shelf_life_hours: number; is_active: boolean }>('SELECT * FROM recipes WHERE id = $1', [b.recipeId]);
  const recipe = recipes[0];
  if (!recipe || !recipe.is_active) throw AppError.notFound('Recipe');
  if (!canAccessDepartment(user, recipe.department_id)) throw AppError.forbidden('This recipe belongs to another department');

  const producedAt = b.producedAt ? new Date(b.producedAt) : new Date();
  if (producedAt.getTime() > Date.now() + 5 * 60_000) throw AppError.unprocessable('producedAt cannot be in the future');
  const expiresAt = new Date(producedAt.getTime() + recipe.shelf_life_hours * 3600_000);

  const id = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO product_labels (recipe_id, product_name, ingredients, allergens, storage_temp_max, batch_no, quantity, unit,
                                   produced_at, expires_at, department_id, branch_id, produced_by, qr_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'قطعة'),$9,$10,$11,
               COALESCE($12::smallint, (SELECT id FROM branches ORDER BY id LIMIT 1)),$13,$14)
       RETURNING id`,
      [recipe.id, recipe.name_ar, JSON.stringify(recipe.ingredients), recipe.allergens, recipe.storage_temp_max, b.batchNo,
        b.quantity, b.unit ?? null, producedAt, expiresAt, recipe.department_id, user.branchId, user.id, generateQrToken()],
    );
    return rows[0]!.id;
  });
  const label = await loadLabel(req, id);
  return created(res, { ...label, printUrl: signPath(printPath(id)) });
}

/** An expired product can never be used: it can only be discarded (with a reason). */
export async function updateLabelStatus(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof labelStatusSchema>;
  const label = (await loadLabel(req, id)) as unknown as { status: string; state: string };
  if (label.status !== 'ACTIVE') throw AppError.conflict(`Label is already ${label.status}`);
  if (b.status === 'CONSUMED' && label.state === 'EXPIRED') {
    throw new AppError(409, 'PRODUCT_EXPIRED', 'المنتج منتهي الصلاحية — لا يجوز استخدامه ويجب إتلافه');
  }
  if (b.status === 'DISCARDED' && !b.reason) throw AppError.unprocessable('A reason is required to discard a product');
  await withTransaction(dbContext(req), (db) =>
    db.query(`UPDATE product_labels SET status = $2, status_reason = $3 WHERE id = $1`, [id, b.status, b.reason ?? null]),
  );
  return ok(res, await loadLabel(req, id));
}

export async function printLink(req: Request, res: Response) {
  const label = await loadLabel(req, (req.valid.params as { id: string }).id);
  return ok(res, { url: signPath(printPath(label.id)) });
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmt = (d: string | Date) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { timeZone: env.APP_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));

/** Printable product data card (opened from a short-lived signed link — no session needed). */
export async function printLabel(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  if (!verifySignedPath(printPath(id), req.query.exp as string | undefined, req.query.sig as string | undefined)) {
    throw new AppError(403, 'LINK_EXPIRED', 'This print link is invalid or has expired');
  }
  const l = (await runAsSystem(() => loadLabel(null, id))) as unknown as {
    label_no: string; product_name: string; batch_no: string; quantity: number; unit: string; produced_at: string; expires_at: string;
    ingredients: { name: string; quantity?: number; unit?: string }[]; allergens: string[]; storage_temp_max: number | null;
    produced_by_name: string; qr_token: string; status: string; state: string;
  };
  const qr = await renderQrDataUrl(buildQrPayload(l.qr_token));
  const ingredients = l.ingredients.map((i) => esc(i.name)).join('، ');
  res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(l.label_no)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;margin:0;padding:12px;background:#f3f4f6}
.card{width:90mm;margin:auto;background:#fff;border:2px solid #0b5d3b;border-radius:10px;padding:10px 12px}
h1{font-size:18px;margin:0 0 4px;color:#0b5d3b}.row{display:flex;justify-content:space-between;gap:8px;font-size:12px;margin:3px 0}
.exp{background:#fdecea;border:1px solid #b42318;border-radius:6px;padding:6px;font-weight:bold;color:#b42318;font-size:14px;text-align:center;margin:6px 0}
.small{font-size:11px;color:#344054}.top{display:flex;gap:10px;align-items:center}.top img{width:84px;height:84px}
.allergen{color:#b54708;font-weight:bold}.brand{font-size:10px;color:#667085;text-align:center;margin-top:6px}
@media print{body{background:#fff;padding:0}.noprint{display:none}}</style></head><body>
<div class="card"><div class="top"><img src="${qr}" alt=""><div><h1>${esc(l.product_name)}</h1>
<div class="small">رقم البطاقة: ${esc(l.label_no)}<br>رقم الدفعة: ${esc(l.batch_no)}<br>الكمية: ${esc(l.quantity)} ${esc(l.unit)}</div></div></div>
<div class="row"><span>تاريخ الإنتاج:</span><b>${esc(fmt(l.produced_at))}</b></div>
<div class="exp">ينتهي: ${esc(fmt(l.expires_at))}</div>
${l.storage_temp_max !== null ? `<div class="row"><span>الحفظ:</span><b>عند ${esc(l.storage_temp_max)}°م أو أقل</b></div>` : ''}
<div class="small"><b>المكونات:</b> ${ingredients}</div>
${l.allergens.length ? `<div class="small allergen">مسببات الحساسية: ${l.allergens.map(esc).join('، ')}</div>` : ''}
<div class="small">أعدّه: ${esc(l.produced_by_name)}</div>
<div class="brand">دار الضيافة — المطبخ المركزي · امسح الرمز للتحقق من الصلاحية</div></div>
<p class="noprint small" style="text-align:center">🖨️ للطباعة: Ctrl+P على الكمبيوتر، أو مشاركة ← طباعة على الجوال</p></body></html>`);
}
