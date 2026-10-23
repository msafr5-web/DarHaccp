import { runAsSystem, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Alert, insertAlert } from '../models/alert.model';
import { publishAlert } from './alert.service';

/**
 * Periodic monitoring (PRD: environmental readings every 2 hours, administrative alert when a
 * reading is more than 2 h 30 late). Forms carry `max_gap_minutes`; the gap is checked per data
 * logger / equipment linked to the form, or per form when none is linked. A reading resolves the
 * alert immediately (record service); this check raises new ones and resolves stale ones.
 */
export async function checkMonitoringGaps(tenantId: number | null = null): Promise<{ created: number }> {
  const created = await runAsSystem(() => withTransaction(null, async (db) => {
    const { rows } = await db.query<{ id: string; tenant_id: number; title_ar: string; department_id: number | null;
      equipment_code: string | null; gap: number; last: string | null; minutes: number }>(
      `WITH targets AS (
         SELECT t.tenant_id, t.id AS template_id, t.title_ar, t.max_gap_minutes AS gap,
                e.id AS equipment_id, e.code AS equipment_code, COALESCE(e.department_id, t.department_id) AS department_id,
                GREATEST(t.created_at, COALESCE(e.created_at, t.created_at)) AS since
           FROM form_templates t
           JOIN tenants tn ON tn.id = t.tenant_id AND tn.status = 'ACTIVE'
           LEFT JOIN equipment e ON e.form_template_id = t.id AND e.is_active AND e.status <> 'OUT_OF_SERVICE'
          WHERE t.is_active AND t.max_gap_minutes > 0 AND ($1::int IS NULL OR t.tenant_id = $1)
       ), last_reading AS (
         SELECT targets.*, COALESCE(equipment_id, template_id) AS id,
                (SELECT max(r.recorded_at) FROM monitoring_records r
                  WHERE r.template_id = targets.template_id
                    AND (targets.equipment_id IS NULL OR r.equipment_id = targets.equipment_id)) AS last
           FROM targets
       )
       SELECT id, tenant_id, title_ar, department_id, equipment_code, gap, last,
              floor(extract(epoch FROM now() - COALESCE(last, since)) / 60)::int AS minutes
         FROM last_reading
        WHERE COALESCE(last, since) < now() - make_interval(mins => gap)`,
      [tenantId],
    );

    const out: Alert[] = [];
    for (const r of rows) {
      const h = Math.floor(r.minutes / 60);
      const m = r.minutes % 60;
      const alert = await insertAlert(db, {
        tenantId: r.tenant_id,
        sourceType: 'MONITORING_OVERDUE',
        sourceId: r.id,
        departmentId: r.department_id,
        severity: 'HIGH',
        title: 'تأخر تسجيل المراقبة الدورية',
        message: `${r.title_ar}${r.equipment_code ? ` (${r.equipment_code})` : ''}: لا توجد قراءة منذ ${h} س ${m} د`
          + ` — الحد المسموح ${r.gap} دقيقة${r.last ? '' : ' (لم تُسجَّل أي قراءة بعد)'}`,
      });
      if (alert) out.push(alert);
    }
    // Cause gone (reading recorded, device archived, form disabled): resolve.
    await db.query(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
        WHERE source_type = 'MONITORING_OVERDUE' AND status <> 'RESOLVED'
          AND ($1::int IS NULL OR tenant_id = $1) AND NOT (source_id = ANY($2::uuid[]))`,
      [tenantId, rows.map((r) => r.id)],
    );
    return out;
  }));
  created.forEach(publishAlert);
  return { created: created.length };
}

const lastCheck = new Map<number, number>();
const THROTTLE_MS = 5 * 60_000;

/**
 * Without a frequent scheduler (serverless), the gap check also runs when the company's users look
 * at alerts / the dashboard / equipment — at most every 5 minutes per company. Never fails the request.
 */
export async function maybeCheckMonitoringGaps(tenantId: number) {
  const now = Date.now();
  if (now - (lastCheck.get(tenantId) ?? 0) < THROTTLE_MS) return;
  lastCheck.set(tenantId, now);
  try {
    await checkMonitoringGaps(tenantId);
  } catch (err) {
    logger.warn({ err, tenantId }, 'Monitoring gap check failed');
  }
}

/** Stock batches with a balance that expire within 7 days or are already expired (FEFO alerts). */
export const STOCK_EXPIRY_SQL = `
  SELECT b.id, b.tenant_id, b.item_code, b.batch_number, to_char(b.expiry_date, 'YYYY-MM-DD') AS expiry_date, b.quantity,
         (b.expiry_date - (now() AT TIME ZONE '${env.APP_TIMEZONE.replace(/[^A-Za-z0-9_/+-]/g, '')}')::date) AS days,
         COALESCE(i.name_ar, b.item_code) AS item_name
    FROM stock_batches b
    LEFT JOIN items i ON i.tenant_id = b.tenant_id AND UPPER(i.code) = UPPER(b.item_code)
   WHERE b.quantity > 0
     AND b.expiry_date <= (now() AT TIME ZONE '${env.APP_TIMEZONE.replace(/[^A-Za-z0-9_/+-]/g, '')}')::date + 7`;
