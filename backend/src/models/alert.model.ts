import { query, Queryable } from '../config/database';
import type { Severity } from './haccp.model';

export type AlertSource =
  | 'CCP_DEVIATION' | 'HEALTH_CERT_EXPIRY' | 'EQUIPMENT_MAINTENANCE'
  | 'INCIDENT' | 'LABEL_EXPIRY' | 'CONTRACTOR_EXPIRY' | 'DOCUMENT_REVIEW' | 'MISSED_MONITORING';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Alert {
  id: string;
  tenant_id: number;
  source_type: AlertSource;
  source_id: string;
  department_id: number | null;
  department_code?: string | null;
  severity: Severity;
  title: string;
  message: string;
  status: AlertStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface NewAlert {
  /** Required when raised from a system (cross-company) scope, e.g. the scheduler. */
  tenantId?: number;
  sourceType: AlertSource;
  sourceId: string;
  departmentId: number | null;
  severity: Severity;
  title: string;
  message: string;
}

/** Inserts an alert unless an unresolved one already exists for the same source (idempotent). */
export async function insertAlert(db: Queryable, a: NewAlert): Promise<Alert | undefined> {
  const { rows } = await db.query<Alert>(
    `INSERT INTO alerts (source_type, source_id, department_id, severity, title, message, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::int, app_tenant()))
     ON CONFLICT (source_type, source_id) WHERE status <> 'RESOLVED' DO NOTHING
     RETURNING *`,
    [a.sourceType, a.sourceId, a.departmentId, a.severity, a.title, a.message, a.tenantId ?? null],
  );
  return rows[0];
}

export async function listAlerts(f: { status?: AlertStatus; departmentId?: number | null; limit: number; offset: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.status) where.push(`a.status = $${params.push(f.status)}`);
  // Department-scoped users also see company-wide alerts (department_id IS NULL).
  if (f.departmentId) where.push(`(a.department_id = $${params.push(f.departmentId)} OR a.department_id IS NULL)`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query<Alert & { total: number }>(
    `SELECT a.*, d.code AS department_code, COUNT(*) OVER()::int AS total
       FROM alerts a LEFT JOIN departments d ON d.id = a.department_id
       ${whereSql}
      ORDER BY (a.status = 'OPEN') DESC, a.created_at DESC
      LIMIT $${params.push(f.limit)} OFFSET $${params.push(f.offset)}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function findAlertById(id: string) {
  const { rows } = await query<Alert>('SELECT * FROM alerts WHERE id = $1', [id]);
  return rows[0];
}
