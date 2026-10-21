import { query } from '../config/database';

export type CapaStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'VERIFIED';

export interface Capa {
  id: string;
  capa_no: string;
  record_id: string | null;
  alert_id: string | null;
  incident_id: string | null;
  ccp_id: string | null;
  ccp_code: string | null;
  department_id: number;
  department_code: string;
  description: string;
  immediate_action: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  product_disposition: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  due_date: string | null;
  status: CapaStatus;
  created_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_CAPA = `
  SELECT cp.*, c.code AS ccp_code, d.code AS department_code, u.full_name AS assigned_to_name
    FROM capas cp
    JOIN departments d ON d.id = cp.department_id
    LEFT JOIN ccps c ON c.id = cp.ccp_id
    LEFT JOIN users u ON u.id = cp.assigned_to`;

export async function listCapas(f: { status?: CapaStatus; departmentId?: number | null; overdue?: boolean; limit: number; offset: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.status) where.push(`cp.status = $${params.push(f.status)}`);
  if (f.departmentId) where.push(`cp.department_id = $${params.push(f.departmentId)}`);
  if (f.overdue) where.push(`cp.status IN ('OPEN','IN_PROGRESS') AND cp.due_date < CURRENT_DATE`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query<Capa & { total: number }>(
    `SELECT x.*, COUNT(*) OVER()::int AS total FROM (${SELECT_CAPA} ${whereSql}) x
      ORDER BY x.created_at DESC LIMIT $${params.push(f.limit)} OFFSET $${params.push(f.offset)}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function findCapaById(id: string) {
  const { rows } = await query<Capa>(`${SELECT_CAPA} WHERE cp.id = $1`, [id]);
  return rows[0];
}
