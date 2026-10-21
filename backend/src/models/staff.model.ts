import { query } from '../config/database';

export type Fitness = 'FIT' | 'EXPIRING_SOON' | 'UNFIT';

export interface StaffRow {
  id: string;
  employee_no: string;
  full_name: string;
  nationality: string | null;
  id_number_last4: string | null;
  job_title: string | null;
  department_id: number;
  department_code: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  is_food_handler: boolean;
  user_id: string | null;
  hire_date: string | null;
  phone: string | null;
  municipality_cert_no: string | null;
  cert_expiry_date: string | null;
  days_to_expiry: number | null;
  /** FIT = may handle food; UNFIT = suspended, no certificate or expired certificate. */
  fitness: Fitness;
  last_daily_check: string | null;
}

/**
 * Staff with their latest municipality health certificate and the date of their last
 * daily health check (STAFF_DAILY_HEALTH form) — PRD §3 daily_temp_log_reference.
 * $1 = warning days, $2 = timezone.
 */
const STAFF_SELECT = `
  SELECT s.id, s.employee_no, s.full_name, s.nationality, s.id_number_last4, s.job_title, s.department_id,
         d.code AS department_code, s.status, s.is_food_handler, s.user_id, s.hire_date, s.phone,
         c.certificate_no AS municipality_cert_no, c.expiry_date AS cert_expiry_date,
         (c.expiry_date - (now() AT TIME ZONE $2)::date) AS days_to_expiry,
         CASE WHEN s.status <> 'ACTIVE' OR c.id IS NULL OR c.expiry_date < (now() AT TIME ZONE $2)::date THEN 'UNFIT'
              WHEN c.expiry_date <= (now() AT TIME ZONE $2)::date + $1::int THEN 'EXPIRING_SOON'
              ELSE 'FIT' END AS fitness,
         (SELECT max(r.recorded_at) FROM monitoring_records r JOIN form_templates t ON t.id = r.template_id
           WHERE t.code = 'STAFF_DAILY_HEALTH' AND r.data ->> 'employee_no' = s.employee_no) AS last_daily_check
    FROM staff s
    JOIN departments d ON d.id = s.department_id
    LEFT JOIN LATERAL (
      SELECT h.id, h.certificate_no, h.expiry_date FROM health_certificates h
       WHERE h.staff_id = s.id OR h.employee_no = s.employee_no
       ORDER BY h.expiry_date DESC LIMIT 1
    ) c ON TRUE`;

export async function listStaff(f: {
  warningDays: number;
  timezone: string;
  departmentId: number | null;
  fitness?: Fitness;
  search?: string;
  limit: number;
  offset: number;
}) {
  const params: unknown[] = [f.warningDays, f.timezone];
  const where: string[] = [`x.status <> 'TERMINATED'`];
  if (f.departmentId) where.push(`x.department_id = $${params.push(f.departmentId)}`);
  if (f.fitness) where.push(`x.fitness = $${params.push(f.fitness)}`);
  if (f.search) {
    const p = params.push(`%${f.search}%`);
    where.push(`(x.full_name ILIKE $${p} OR x.employee_no ILIKE $${p} OR x.id_number_last4 = $${params.push(f.search.slice(-4))})`);
  }
  const { rows } = await query<StaffRow & { total: number }>(
    `SELECT x.*, COUNT(*) OVER()::int AS total FROM (${STAFF_SELECT}) x
      WHERE ${where.join(' AND ')}
      ORDER BY CASE x.fitness WHEN 'UNFIT' THEN 0 WHEN 'EXPIRING_SOON' THEN 1 ELSE 2 END, x.full_name
      LIMIT $${params.push(f.limit)} OFFSET $${params.push(f.offset)}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function findStaff(id: string, warningDays: number, timezone: string) {
  const { rows } = await query<StaffRow & { id_number_enc: string | null }>(
    `SELECT x.*, (SELECT id_number_enc FROM staff WHERE id = x.id) AS id_number_enc FROM (${STAFF_SELECT}) x WHERE x.id = $3`,
    [warningDays, timezone, id],
  );
  return rows[0];
}
