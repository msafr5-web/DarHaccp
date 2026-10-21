import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { insertAuditEvent } from '../models/audit.model';
import { findEquipment } from '../models/equipment.model';
import { findTemplate } from '../models/haccp.model';
import { buildQrPayload, generateQrToken, renderQrDataUrl, renderQrPng, renderQrSvg, resolveQr } from '../services/qr.service';
import { AppError } from '../utils/AppError';
import { dbContext, ok, requireUser } from '../utils/http';

export const resolveSchema = z.object({ payload: z.string().trim().min(16).max(500) });
export const imageQuery = z.object({ format: z.enum(['png', 'svg']).default('png') });
export const qrTargetParams = z.object({ target: z.enum(['templates', 'equipment']), id: z.uuid() });
export const labelsQuery = z.object({ target: z.enum(['templates', 'equipment']).default('templates') });

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function loadTarget(target: 'templates' | 'equipment', id: string) {
  if (target === 'templates') {
    const t = await findTemplate({ id });
    if (!t) throw AppError.notFound('Form template');
    return { token: t.qr_token, label: `${t.code} — ${t.title_ar}` };
  }
  const e = await findEquipment({ id });
  if (!e) throw AppError.notFound('Equipment');
  return { token: e.qr_token, label: `${e.code} — ${e.name}` };
}

/** Mobile app: scanned payload -> digital form definition to open (instead of the paper log). */
export async function resolve(req: Request, res: Response) {
  const user = requireUser(req);
  const { payload } = req.valid.body as z.infer<typeof resolveSchema>;
  const result = await resolveQr(user, payload);
  await insertAuditEvent({
    userId: user.id,
    action: 'QR_SCAN',
    entity: result.kind === 'LABEL' ? 'product_labels' : result.kind === 'EQUIPMENT' ? 'equipment' : 'form_templates',
    entityId: result.kind === 'LABEL' ? result.label.id : result.equipment?.id ?? result.template.id,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
  });
  return ok(res, result);
}

export async function image(req: Request, res: Response) {
  const { target, id } = req.valid.params as z.infer<typeof qrTargetParams>;
  const { format } = req.valid.query as z.infer<typeof imageQuery>;
  const { token } = await loadTarget(target, id);
  const payload = buildQrPayload(token);
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (format === 'svg') return res.type('image/svg+xml').send(await renderQrSvg(payload));
  return res.type('image/png').send(await renderQrPng(payload));
}

/** Invalidates a lost / damaged label: old code stops working immediately. */
export async function rotate(req: Request, res: Response) {
  const { target, id } = req.valid.params as z.infer<typeof qrTargetParams>;
  const table = target === 'templates' ? 'form_templates' : 'equipment';
  const token = generateQrToken();
  const updated = await withTransaction(dbContext(req), async (db) => {
    const r = await db.query(`UPDATE ${table} SET qr_token = $2 WHERE id = $1`, [id, token]);
    return r.rowCount;
  });
  if (!updated) throw AppError.notFound(target === 'templates' ? 'Form template' : 'Equipment');
  return ok(res, { id, payload: buildQrPayload(token) });
}

/** Printable A4 sheet of QR labels to stick at each workstation / equipment. */
export async function labels(req: Request, res: Response) {
  const { target } = req.valid.query as z.infer<typeof labelsQuery>;
  const { rows } = await query<{ title: string; subtitle: string; token: string }>(
    target === 'templates'
      ? `SELECT t.title_ar AS title, t.code || COALESCE(' · ' || d.name_ar, '') AS subtitle, t.qr_token AS token
           FROM form_templates t LEFT JOIN departments d ON d.id = t.department_id WHERE t.is_active ORDER BY t.code`
      : `SELECT e.name AS title, e.code || ' · ' || d.name_ar AS subtitle, e.qr_token AS token
           FROM equipment e JOIN departments d ON d.id = e.department_id WHERE e.is_active ORDER BY e.code`,
  );
  const cards = await Promise.all(
    rows.map(async (r) => {
      const img = await renderQrDataUrl(buildQrPayload(r.token));
      return `<div class="card"><img src="${img}" alt=""><h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.subtitle)}</p><small>امسح الرمز لفتح النموذج الرقمي</small></div>`;
    }),
  );
  res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>QR Labels</title>
<style>body{font-family:Tahoma,Arial,sans-serif;margin:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{border:2px solid #0b5d3b;border-radius:10px;padding:10px;text-align:center;break-inside:avoid}
.card img{width:100%;max-width:200px}h3{margin:6px 0 2px;font-size:15px;color:#0b5d3b}p{margin:0;font-size:12px}small{color:#555}
@media print{body{margin:0}}</style></head><body><h2>دار الضيافة — ملصقات QR لسلامة الغذاء</h2><div class="grid">${cards.join('')}</div></body></html>`);
}
