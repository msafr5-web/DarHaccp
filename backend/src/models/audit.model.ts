import { query } from '../config/database';

export interface AuditLog {
  id: number;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  occurred_at: string;
}

/** Application-level audit events that are not table writes (logins, QR scans, exports…). */
export async function insertAuditEvent(e: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  await query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data, ip_address, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.userId ?? null, e.action, e.entity, e.entityId ?? null, e.data ?? null, e.ip ?? null, e.userAgent?.slice(0, 300) ?? null, e.requestId ?? null],
  );
}

export async function listAuditLogs(f: {
  userId?: string;
  entity?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.userId) where.push(`a.user_id = $${params.push(f.userId)}`);
  if (f.entity) where.push(`a.entity = $${params.push(f.entity)}`);
  if (f.entityId) where.push(`a.entity_id = $${params.push(f.entityId)}`);
  if (f.action) where.push(`a.action = $${params.push(f.action)}`);
  if (f.from) where.push(`a.occurred_at >= $${params.push(f.from)}`);
  if (f.to) where.push(`a.occurred_at < $${params.push(f.to)}`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [{ rows }, count] = await Promise.all([
    query<AuditLog>(
      `SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        ${whereSql} ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, f.offset],
    ),
    query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM audit_logs a ${whereSql}`, params),
  ]);
  return { rows, total: count.rows[0]?.total ?? 0 };
}
