import { query } from '../config/database';

export type CertificateState = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

export interface HealthCertificate {
  id: string;
  user_id: string | null;
  employee_no: string;
  employee_name: string;
  department_id: number;
  department_code: string;
  certificate_no: string;
  issuing_authority: string;
  issue_date: string;
  expiry_date: string;
  notes: string | null;
  days_to_expiry: number;
  state: CertificateState;
}

/** $1 = warning window in days. Dates are evaluated in the company timezone ($2). */
export const CERT_STATE_SQL = `
  (h.expiry_date - (now() AT TIME ZONE $2)::date) AS days_to_expiry,
  CASE WHEN h.expiry_date < (now() AT TIME ZONE $2)::date THEN 'EXPIRED'
       WHEN h.expiry_date <= (now() AT TIME ZONE $2)::date + $1::int THEN 'EXPIRING_SOON'
       ELSE 'VALID' END AS state`;

export async function listHealthCertificates(f: {
  warningDays: number;
  timezone: string;
  departmentId?: number | null;
  state?: CertificateState;
  search?: string;
  limit: number;
  offset: number;
}) {
  const params: unknown[] = [f.warningDays, f.timezone];
  const where: string[] = [];
  if (f.departmentId) where.push(`x.department_id = $${params.push(f.departmentId)}`);
  if (f.state) where.push(`x.state = $${params.push(f.state)}`);
  if (f.search) {
    const p = params.push(`%${f.search}%`);
    where.push(`(x.employee_name ILIKE $${p} OR x.employee_no ILIKE $${p} OR x.certificate_no ILIKE $${p})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query<HealthCertificate & { total: number }>(
    `SELECT x.*, COUNT(*) OVER()::int AS total FROM (
        SELECT h.*, d.code AS department_code, ${CERT_STATE_SQL}
          FROM health_certificates h JOIN departments d ON d.id = h.department_id
     ) x ${whereSql}
     ORDER BY x.expiry_date ASC
     LIMIT $${params.push(f.limit)} OFFSET $${params.push(f.offset)}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}
