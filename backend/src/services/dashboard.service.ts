import { query } from '../config/database';
import { env } from '../config/env';

/**
 * Dashboard analytics. Every query accepts an optional department filter so that
 * kitchen supervisors only see their own kitchen, while management sees everything.
 * "Day" boundaries follow the company timezone (Asia/Riyadh).
 */

const pct = (passed: number, total: number) => (total ? Math.round((passed / total) * 10000) / 100 : null);

export async function getOverview(date: string | undefined, departmentId: number | null) {
  const tz = env.APP_TIMEZONE;
  const day = date ?? null;

  const [compliance, alerts, capas, certs, equipment, modules] = await Promise.all([
    query<{ code: string; name_ar: string; total: number; passed: number; failed: number }>(
      `SELECT d.code, d.name_ar,
              COUNT(r.id)::int AS total,
              COUNT(r.id) FILTER (WHERE r.status = 'PASS')::int AS passed,
              COUNT(r.id) FILTER (WHERE r.status = 'FAIL')::int AS failed
         FROM departments d
         LEFT JOIN monitoring_records r ON r.department_id = d.id
              AND (r.recorded_at AT TIME ZONE $1)::date = COALESCE($2::date, (now() AT TIME ZONE $1)::date)
        WHERE ($3::smallint IS NULL OR d.id = $3)
        GROUP BY d.id ORDER BY d.id`,
      [tz, day, departmentId],
    ),
    query<{ severity: string; count: number }>(
      `SELECT severity, COUNT(*)::int AS count FROM alerts
        WHERE status <> 'RESOLVED' AND ($1::smallint IS NULL OR department_id = $1 OR department_id IS NULL)
        GROUP BY severity`,
      [departmentId],
    ),
    query<{ open: number; in_progress: number; overdue: number; closed_awaiting_verification: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
              COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
              COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS') AND due_date < (now() AT TIME ZONE $1)::date)::int AS overdue,
              COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_awaiting_verification
         FROM capas WHERE ($2::smallint IS NULL OR department_id = $2)`,
      [tz, departmentId],
    ),
    getHealthCertificateSummary(departmentId),
    getEquipmentSummary(departmentId),
    getModulesSummary(departmentId),
  ]);

  const totals = compliance.rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, passed: acc.passed + r.passed, failed: acc.failed + r.failed }),
    { total: 0, passed: 0, failed: 0 },
  );

  return {
    date: day ?? 'today',
    compliance: {
      ...totals,
      complianceRate: pct(totals.passed, totals.total),
      byDepartment: compliance.rows.map((r) => ({ ...r, complianceRate: pct(r.passed, r.total) })),
    },
    deviationsToday: totals.failed,
    openAlerts: {
      total: alerts.rows.reduce((s, r) => s + r.count, 0),
      bySeverity: Object.fromEntries(alerts.rows.map((r) => [r.severity, r.count])),
    },
    capas: capas.rows[0],
    healthCertificates: certs.summary,
    equipment: equipment.summary,
    ...modules,
  };
}

/** Quality, confectionery data cards, staff fitness and HSE indicators (PRD modules 1, 4 and 5). */
export async function getModulesSummary(departmentId: number | null) {
  const tz = env.APP_TIMEZONE;
  const [quality, labels, staff, hse] = await Promise.all([
    query<{ open_incidents: number; open_food_safety: number; audits_30d: number; avg_audit_score: number | null; planned_audits: number }>(
      `SELECT (SELECT COUNT(*)::int FROM incidents WHERE status <> 'CLOSED' AND ($1::smallint IS NULL OR department_id = $1)) AS open_incidents,
              (SELECT COUNT(*)::int FROM incidents WHERE status <> 'CLOSED' AND type = 'FOOD_SAFETY_INCIDENT'
                 AND ($1::smallint IS NULL OR department_id = $1)) AS open_food_safety,
              (SELECT COUNT(*)::int FROM internal_audits WHERE status = 'COMPLETED' AND conducted_at >= now() - interval '30 days'
                 AND ($1::smallint IS NULL OR department_id = $1)) AS audits_30d,
              (SELECT ROUND(AVG(score), 1)::float FROM internal_audits WHERE status = 'COMPLETED' AND conducted_at >= now() - interval '90 days'
                 AND ($1::smallint IS NULL OR department_id = $1)) AS avg_audit_score,
              (SELECT COUNT(*)::int FROM internal_audits WHERE status = 'PLANNED' AND ($1::smallint IS NULL OR department_id = $1)) AS planned_audits`,
      [departmentId],
    ),
    query<{ active: number; expiring_12h: number; expired_not_discarded: number }>(
      `SELECT COUNT(*) FILTER (WHERE expires_at > now())::int AS active,
              COUNT(*) FILTER (WHERE expires_at > now() AND expires_at <= now() + interval '12 hours')::int AS expiring_12h,
              COUNT(*) FILTER (WHERE expires_at <= now())::int AS expired_not_discarded
         FROM product_labels WHERE status = 'ACTIVE' AND ($1::smallint IS NULL OR department_id = $1)`,
      [departmentId],
    ),
    query<{ food_handlers: number; fit: number; expiring_soon: number; unfit: number }>(
      `WITH s AS (
         SELECT st.id, st.status, c.expiry_date FROM staff st
           LEFT JOIN LATERAL (SELECT expiry_date FROM health_certificates h WHERE h.staff_id = st.id OR h.employee_no = st.employee_no
                               ORDER BY expiry_date DESC LIMIT 1) c ON TRUE
          WHERE st.is_food_handler AND st.status <> 'TERMINATED' AND ($1::smallint IS NULL OR st.department_id = $1))
       SELECT COUNT(*)::int AS food_handlers,
              COUNT(*) FILTER (WHERE status = 'ACTIVE' AND expiry_date > (now() AT TIME ZONE $2)::date + $3::int)::int AS fit,
              COUNT(*) FILTER (WHERE status = 'ACTIVE' AND expiry_date BETWEEN (now() AT TIME ZONE $2)::date
                                                       AND (now() AT TIME ZONE $2)::date + $3::int)::int AS expiring_soon,
              COUNT(*) FILTER (WHERE status <> 'ACTIVE' OR expiry_date IS NULL OR expiry_date < (now() AT TIME ZONE $2)::date)::int AS unfit
         FROM s`,
      [departmentId, tz, env.HEALTH_CERT_WARNING_DAYS],
    ),
    query<{ contractors_expiring: number; documents_due_review: number }>(
      `SELECT (SELECT COUNT(*)::int FROM contractors WHERE is_approved
                 AND LEAST(COALESCE(license_expiry, contract_end), COALESCE(contract_end, license_expiry)) <= CURRENT_DATE + 30) AS contractors_expiring,
              (SELECT COUNT(*)::int FROM documents WHERE is_active AND review_date <= CURRENT_DATE + 30) AS documents_due_review`,
    ),
  ]);
  return { quality: quality.rows[0], labels: labels.rows[0], staff: staff.rows[0], hse: hse.rows[0] };
}

export async function getComplianceTrend(days: number, departmentId: number | null) {
  const { rows } = await query<{ day: string; department: string; total: number; passed: number; failed: number }>(
    `WITH days AS (
        SELECT generate_series((now() AT TIME ZONE $1)::date - ($2::int - 1), (now() AT TIME ZONE $1)::date, interval '1 day')::date AS day
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day, d.code AS department,
            COUNT(r.id)::int AS total,
            COUNT(r.id) FILTER (WHERE r.status = 'PASS')::int AS passed,
            COUNT(r.id) FILTER (WHERE r.status = 'FAIL')::int AS failed
       FROM days CROSS JOIN departments d
       LEFT JOIN monitoring_records r ON r.department_id = d.id AND (r.recorded_at AT TIME ZONE $1)::date = days.day
      WHERE ($3::smallint IS NULL OR d.id = $3)
      GROUP BY days.day, d.id, d.code
      ORDER BY days.day, d.id`,
    [env.APP_TIMEZONE, days, departmentId],
  );
  return rows.map((r) => ({ ...r, complianceRate: pct(r.passed, r.total) }));
}

export async function getDeviationAnalysis(from: string, to: string, departmentId: number | null) {
  const params = [from, to, departmentId];
  const scope = `r.status = 'FAIL' AND r.recorded_at >= $1 AND r.recorded_at < $2 AND ($3::smallint IS NULL OR r.department_id = $3)`;

  const [byCcp, byForm, recent] = await Promise.all([
    query(
      `SELECT COALESCE(c.code, 'PRP') AS ccp_code, COALESCE(c.name_ar, 'برامج المتطلبات الأساسية') AS ccp_name,
              COUNT(*)::int AS deviations
         FROM monitoring_records r LEFT JOIN ccps c ON c.id = r.ccp_id
        WHERE ${scope} GROUP BY c.code, c.name_ar ORDER BY deviations DESC`,
      params,
    ),
    query(
      `SELECT t.code, t.title_ar, d.code AS department, COUNT(*)::int AS deviations
         FROM monitoring_records r JOIN form_templates t ON t.id = r.template_id JOIN departments d ON d.id = r.department_id
        WHERE ${scope} GROUP BY t.code, t.title_ar, d.code ORDER BY deviations DESC LIMIT 20`,
      params,
    ),
    query(
      `SELECT r.id, r.recorded_at, d.code AS department, t.title_ar AS form, c.code AS ccp_code,
              r.measured_value, r.unit, r.deviations, u.full_name AS recorded_by,
              cp.capa_no, cp.status AS capa_status
         FROM monitoring_records r
         JOIN departments d ON d.id = r.department_id
         JOIN form_templates t ON t.id = r.template_id
         JOIN users u ON u.id = r.recorded_by
         LEFT JOIN ccps c ON c.id = r.ccp_id
         LEFT JOIN capas cp ON cp.record_id = r.id
        WHERE ${scope} ORDER BY r.recorded_at DESC LIMIT 50`,
      params,
    ),
  ]);
  return { from, to, byCcp: byCcp.rows, byForm: byForm.rows, recent: recent.rows };
}

export async function getHealthCertificateSummary(departmentId: number | null) {
  const params = [env.HEALTH_CERT_WARNING_DAYS, env.APP_TIMEZONE, departmentId];
  // Latest certificate per employee; status relative to "today" in Riyadh.
  const latest = `
    SELECT DISTINCT ON (h.employee_no) h.id, h.employee_no, h.employee_name, h.certificate_no, h.expiry_date,
           d.code AS department, (h.expiry_date - (now() AT TIME ZONE $2)::date) AS days_to_expiry
      FROM health_certificates h JOIN departments d ON d.id = h.department_id
     WHERE ($3::smallint IS NULL OR h.department_id = $3)
     ORDER BY h.employee_no, h.expiry_date DESC`;

  const [summary, attention] = await Promise.all([
    query<{ total: number; valid: number; expiring_soon: number; expired: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE days_to_expiry > $1)::int AS valid,
              COUNT(*) FILTER (WHERE days_to_expiry BETWEEN 0 AND $1)::int AS expiring_soon,
              COUNT(*) FILTER (WHERE days_to_expiry < 0)::int AS expired
         FROM (${latest}) x`,
      params,
    ),
    query(`SELECT * FROM (${latest}) x WHERE days_to_expiry <= $1 ORDER BY days_to_expiry ASC LIMIT 100`, params),
  ]);
  const s = summary.rows[0] ?? { total: 0, valid: 0, expiring_soon: 0, expired: 0 };
  return {
    summary: { ...s, warningDays: env.HEALTH_CERT_WARNING_DAYS, validRate: pct(s.valid + s.expiring_soon, s.total) },
    attention: attention.rows,
  };
}

export async function getEquipmentSummary(departmentId: number | null) {
  const tz = env.APP_TIMEZONE;
  const [summary, due, recent] = await Promise.all([
    query<{ total: number; operational: number; under_maintenance: number; out_of_service: number; maintenance_overdue: number; maintenance_due_7d: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'OPERATIONAL')::int AS operational,
              COUNT(*) FILTER (WHERE status = 'UNDER_MAINTENANCE')::int AS under_maintenance,
              COUNT(*) FILTER (WHERE status = 'OUT_OF_SERVICE')::int AS out_of_service,
              COUNT(*) FILTER (WHERE next_maintenance_date < (now() AT TIME ZONE $1)::date)::int AS maintenance_overdue,
              COUNT(*) FILTER (WHERE next_maintenance_date BETWEEN (now() AT TIME ZONE $1)::date
                                                         AND (now() AT TIME ZONE $1)::date + 7)::int AS maintenance_due_7d
         FROM equipment WHERE is_active AND ($2::smallint IS NULL OR department_id = $2)`,
      [tz, departmentId],
    ),
    query(
      `SELECT e.id, e.code, e.name, e.type, e.status, d.code AS department, e.next_maintenance_date,
              (e.next_maintenance_date - (now() AT TIME ZONE $1)::date) AS days_to_due
         FROM equipment e JOIN departments d ON d.id = e.department_id
        WHERE e.is_active AND ($2::smallint IS NULL OR e.department_id = $2)
          AND (e.status <> 'OPERATIONAL' OR e.next_maintenance_date <= (now() AT TIME ZONE $1)::date + 7)
        ORDER BY e.next_maintenance_date NULLS LAST`,
      [tz, departmentId],
    ),
    query(
      `SELECT m.id, e.code, e.name, m.type, m.description, m.performed_at, u.full_name AS performed_by
         FROM maintenance_logs m JOIN equipment e ON e.id = m.equipment_id JOIN users u ON u.id = m.performed_by
        WHERE ($1::smallint IS NULL OR e.department_id = $1)
        ORDER BY m.performed_at DESC, m.created_at DESC LIMIT 10`,
      [departmentId],
    ),
  ]);
  return { summary: summary.rows[0], attention: due.rows, recentMaintenance: recent.rows };
}
