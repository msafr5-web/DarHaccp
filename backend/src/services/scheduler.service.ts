import { runAsSystem, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Alert, AlertSource, insertAlert, NewAlert } from '../models/alert.model';
import { publishAlert } from './alert.service';
import { checkMonitoringGaps, STOCK_EXPIRY_SQL } from './monitoring.service';

// Arbitrary constant: only one API instance runs the checks at a time (pg advisory lock).
const SCHEDULER_LOCK_ID = 774_201;

/**
 * Periodic compliance checks:
 *  - health certificates expiring within HEALTH_CERT_WARNING_DAYS (or already expired)
 *  - equipment whose preventive maintenance is due within 7 days (or overdue)
 *  - forms filled fewer times than their minimum daily frequency the previous day
 *  - stock batches expired / expiring within 7 days (FEFO)
 *  - periodic monitoring gaps (e.g. no environmental reading for 2 h 30)
 * Idempotent: an unresolved alert per source is never duplicated, and alerts whose
 * cause disappeared (certificate renewed, maintenance done) are auto-resolved.
 */
export async function runComplianceChecks(): Promise<{ created: number }> {
  // Cross-company job: runs in the system scope; every alert carries its company explicitly.
  return runAsSystem(runChecks);
}

async function runChecks(): Promise<{ created: number }> {
  let skipped = false; // another instance holds the lock
  const created: Alert[] = await withTransaction(null, async (db) => {
    // Transaction-scoped lock: safe behind a transaction-pooling proxy (PgBouncer).
    const { rows: lock } = await db.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [SCHEDULER_LOCK_ID]);
    if (!lock[0]?.locked) {
      skipped = true;
      return [];
    }
    const out: Alert[] = [];

    // Only the latest certificate of each employee matters (older ones were renewed).
    const certs = await db.query<{ id: string; tenant_id: number; employee_name: string; employee_no: string; department_id: number; expiry_date: string; days: number }>(
      `SELECT * FROM (
          SELECT DISTINCT ON (tenant_id, employee_no) id, tenant_id, employee_name, employee_no, department_id, expiry_date,
                 (expiry_date - (now() AT TIME ZONE $2)::date) AS days
            FROM health_certificates ORDER BY tenant_id, employee_no, expiry_date DESC
       ) latest WHERE days <= $1`,
      [env.HEALTH_CERT_WARNING_DAYS, env.APP_TIMEZONE],
    );
    for (const c of certs.rows) {
      const expired = c.days < 0;
      const alert = await insertAlert(db, {
        tenantId: c.tenant_id,
        sourceType: 'HEALTH_CERT_EXPIRY',
        sourceId: c.id,
        departmentId: c.department_id,
        severity: expired ? 'HIGH' : c.days <= 7 ? 'MEDIUM' : 'LOW',
        title: expired ? 'شهادة صحية منتهية' : 'شهادة صحية قاربت على الانتهاء',
        message: expired
          ? `${c.employee_name} (${c.employee_no}): health certificate expired on ${c.expiry_date} — remove from food handling`
          : `${c.employee_name} (${c.employee_no}): health certificate expires in ${c.days} day(s) on ${c.expiry_date}`,
      });
      if (alert) out.push(alert);
    }
    await db.query(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
        WHERE source_type = 'HEALTH_CERT_EXPIRY' AND status <> 'RESOLVED' AND NOT (source_id = ANY($1::uuid[]))`,
      [certs.rows.map((c) => c.id)],
    );

    const equipment = await db.query<{ id: string; tenant_id: number; code: string; name: string; department_id: number; next_maintenance_date: string; days: number }>(
      `SELECT id, tenant_id, code, name, department_id, next_maintenance_date,
              (next_maintenance_date - (now() AT TIME ZONE $1)::date) AS days
         FROM equipment
        WHERE is_active AND next_maintenance_date IS NOT NULL
          AND next_maintenance_date <= (now() AT TIME ZONE $1)::date + 7`,
      [env.APP_TIMEZONE],
    );
    for (const e of equipment.rows) {
      const overdue = e.days < 0;
      const alert = await insertAlert(db, {
        tenantId: e.tenant_id,
        sourceType: 'EQUIPMENT_MAINTENANCE',
        sourceId: e.id,
        departmentId: e.department_id,
        severity: overdue ? 'HIGH' : 'LOW',
        title: overdue ? 'صيانة متأخرة' : 'صيانة وقائية مستحقة',
        message: `${e.code} ${e.name}: preventive maintenance ${overdue ? `overdue since ${e.next_maintenance_date}` : `due on ${e.next_maintenance_date}`}`,
      });
      if (alert) out.push(alert);
    }
    await db.query(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
        WHERE source_type = 'EQUIPMENT_MAINTENANCE' AND status <> 'RESOLVED' AND NOT (source_id = ANY($1::uuid[]))`,
      [equipment.rows.map((e) => e.id)],
    );

    // Raise one alert per source and auto-resolve alerts whose cause has disappeared.
    const sync = async (sourceType: AlertSource, items: (NewAlert & { sourceId: string })[]) => {
      for (const item of items) {
        const alert = await insertAlert(db, item);
        if (alert) out.push(alert);
      }
      await db.query(
        `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
          WHERE source_type = $1 AND status <> 'RESOLVED' AND NOT (source_id = ANY($2::uuid[]))`,
        [sourceType, items.map((i) => i.sourceId)],
      );
    };

    // Expired products still marked ACTIVE must be discarded (PRD §4.4 data cards).
    const labels = await db.query<{ id: string; tenant_id: number; label_no: string; product_name: string; batch_no: string; department_id: number }>(
      `SELECT id, tenant_id, label_no, product_name, batch_no, department_id FROM product_labels WHERE status = 'ACTIVE' AND expires_at <= now()`,
    );
    await sync('LABEL_EXPIRY', labels.rows.map((l) => ({
      tenantId: l.tenant_id, sourceType: 'LABEL_EXPIRY' as const, sourceId: l.id, departmentId: l.department_id, severity: 'HIGH' as const,
      title: 'منتج منتهي الصلاحية — يجب إتلافه',
      message: `${l.product_name} (دفعة ${l.batch_no}، بطاقة ${l.label_no}) انتهت صلاحيته ولم يُسجَّل إتلافه`,
    })));

    // Contractors whose licence or contract expires within 30 days.
    const contractors = await db.query<{ id: string; tenant_id: number; name: string; expiry: string; expired: boolean }>(
      `SELECT id, tenant_id, name, LEAST(COALESCE(license_expiry, contract_end), COALESCE(contract_end, license_expiry)) AS expiry,
              LEAST(COALESCE(license_expiry, contract_end), COALESCE(contract_end, license_expiry)) < (now() AT TIME ZONE $1)::date AS expired
         FROM contractors
        WHERE is_approved
          AND LEAST(COALESCE(license_expiry, contract_end), COALESCE(contract_end, license_expiry)) <= (now() AT TIME ZONE $1)::date + 30`,
      [env.APP_TIMEZONE],
    );
    const supportDept = await db.query<{ id: number }>(`SELECT id FROM departments WHERE code = 'SUPPORT'`);
    await sync('CONTRACTOR_EXPIRY', contractors.rows.map((c) => ({
      tenantId: c.tenant_id, sourceType: 'CONTRACTOR_EXPIRY' as const, sourceId: c.id, departmentId: supportDept.rows[0]?.id ?? null,
      severity: c.expired ? ('HIGH' as const) : ('MEDIUM' as const),
      title: c.expired ? 'ترخيص/عقد مقاول منتهٍ' : 'ترخيص/عقد مقاول قارب على الانتهاء',
      message: `${c.name}: ${c.expired ? 'انتهى في' : 'ينتهي في'} ${c.expiry}`,
    })));

    // Controlled documents (IMS policies, evacuation plans…) past their review date.
    const docs = await db.query<{ id: string; tenant_id: number; doc_no: string; title: string; department_id: number | null; review_date: string }>(
      `SELECT id, tenant_id, doc_no, title, department_id, review_date FROM documents
        WHERE is_active AND review_date IS NOT NULL AND review_date <= (now() AT TIME ZONE $1)::date`,
      [env.APP_TIMEZONE],
    );
    await sync('DOCUMENT_REVIEW', docs.rows.map((d) => ({
      tenantId: d.tenant_id, sourceType: 'DOCUMENT_REVIEW' as const, sourceId: d.id, departmentId: d.department_id, severity: 'LOW' as const,
      title: 'وثيقة تحتاج مراجعة', message: `${d.doc_no} — ${d.title}: موعد المراجعة ${d.review_date}`,
    })));

    // Minimum monitoring frequency (PRD: environmental readings at least twice a day), checked on the
    // previous day per data logger / equipment linked to the form, or per form when none is linked.
    const missed = await db.query<{ id: string; tenant_id: number; title_ar: string; department_id: number | null;
      equipment_code: string | null; required: number; done: number }>(
      `WITH targets AS (
         SELECT t.tenant_id, t.id AS template_id, t.title_ar, t.min_daily_entries AS required,
                e.id AS equipment_id, e.code AS equipment_code, COALESCE(e.department_id, t.department_id) AS department_id
           FROM form_templates t
           LEFT JOIN equipment e ON e.form_template_id = t.id AND e.is_active
                                AND (e.created_at AT TIME ZONE $1)::date < (now() AT TIME ZONE $1)::date - 1
          WHERE t.is_active AND t.min_daily_entries > 0
            AND (t.created_at AT TIME ZONE $1)::date < (now() AT TIME ZONE $1)::date - 1
       )
       SELECT * FROM (
         SELECT COALESCE(equipment_id, template_id) AS id, tenant_id, title_ar, department_id, equipment_code, required,
                (SELECT COUNT(*)::int FROM monitoring_records r
                  WHERE r.template_id = targets.template_id
                    AND (targets.equipment_id IS NULL OR r.equipment_id = targets.equipment_id)
                    AND (r.recorded_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date - 1) AS done
           FROM targets
       ) counted WHERE done < required`,
      [env.APP_TIMEZONE],
    );
    // FEFO: batches with stock that are expired (block & discard) or expire within 7 days (dispatch first).
    const stock = await db.query<{ id: string; tenant_id: number; item_code: string; item_name: string; batch_number: string;
      expiry_date: string; quantity: string; days: number }>(STOCK_EXPIRY_SQL);
    const supportId = (await db.query<{ id: number }>(`SELECT id FROM departments WHERE code = 'SUPPORT'`)).rows[0]?.id ?? null;
    await sync('STOCK_EXPIRY', stock.rows.map((b) => ({
      tenantId: b.tenant_id, sourceType: 'STOCK_EXPIRY' as const, sourceId: b.id, departmentId: supportId,
      severity: b.days < 0 ? ('HIGH' as const) : ('MEDIUM' as const),
      title: b.days < 0 ? 'مخزون منتهي الصلاحية — يُمنع صرفه' : 'مخزون قارب على الانتهاء — اصرفه أولاً (FEFO)',
      message: `${b.item_name} (${b.item_code}) — تشغيلة ${b.batch_number}: الرصيد ${Number(b.quantity)}، `
        + (b.days < 0 ? `انتهت في ${b.expiry_date}` : `تنتهي في ${b.expiry_date} (${b.days} يوم)`),
    })));

    await sync('MISSED_MONITORING', missed.rows.map((m) => ({
      tenantId: m.tenant_id, sourceType: 'MISSED_MONITORING' as const, sourceId: m.id, departmentId: m.department_id,
      severity: m.done === 0 ? ('HIGH' as const) : ('MEDIUM' as const),
      title: 'مراقبة ناقصة — لم يُستوفَ الحد الأدنى من القراءات',
      message: `${m.title_ar}${m.equipment_code ? ` (${m.equipment_code})` : ''}: ${m.done} من ${m.required} قراءات مطلوبة أمس`,
    })));
    return out;
  });

  if (skipped) return { created: 0 };
  created.forEach(publishAlert);
  const gaps = await checkMonitoringGaps();
  if (created.length) logger.info({ created: created.length }, 'Compliance checks raised new alerts');
  return { created: created.length + gaps.created };
}

export function startScheduler(): () => void {
  const run = () => runComplianceChecks().catch((err) => logger.error({ err }, 'Compliance checks failed'));
  const first = setTimeout(run, 10_000);
  const interval = setInterval(run, env.SCHEDULER_INTERVAL_MINUTES * 60_000);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
