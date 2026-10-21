import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { canAccessDepartment } from '../middlewares/auth';
import { AUDIT_STANDARDS, CHECKLISTS } from '../services/auditChecklists';
import { completeAudit, planAudit, reportIncident } from '../services/quality.service';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, paginate, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDate, isoDateTime, optText, pagination, uuid } from '../utils/schemas';

const incidentType = z.enum([
  'NON_CONFORMITY', 'FOOD_SAFETY_INCIDENT', 'OHS_INCIDENT', 'CUSTOMER_COMPLAINT', 'NEAR_MISS', 'AUDIT_FINDING', 'REGULATORY_INSPECTION',
]);

// ---------------------------------------------------------------- Incidents & non-conformities

export const listIncidentsQuery = pagination.extend({
  status: z.enum(['OPEN', 'UNDER_INVESTIGATION', 'CLOSED']).optional(),
  type: incidentType.optional(),
  department: departmentCode.optional(),
});

export const incidentSchema = z.object({
  type: incidentType.exclude(['AUDIT_FINDING']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  department: departmentCode,
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(4000),
  location: optText(150),
  occurredAt: isoDateTime.optional(),
  assignedTo: uuid.optional(),
});

export const incidentUpdateSchema = z
  .object({ status: z.enum(['OPEN', 'UNDER_INVESTIGATION']), assignedTo: uuid.nullable() })
  .partial();

const INCIDENT_SELECT = `
  SELECT i.*, d.code AS department_code, r.full_name AS reported_by_name, a.full_name AS assigned_to_name,
         cp.id AS capa_id, cp.capa_no, cp.status AS capa_status, ia.audit_no
    FROM incidents i
    JOIN departments d ON d.id = i.department_id
    JOIN users r ON r.id = i.reported_by
    LEFT JOIN users a ON a.id = i.assigned_to
    LEFT JOIN capas cp ON cp.incident_id = i.id
    LEFT JOIN internal_audits ia ON ia.id = i.audit_id`;

export async function listIncidents(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listIncidentsQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.status) where.push(`x.status = $${params.push(q.status)}`);
  if (q.type) where.push(`x.type = $${params.push(q.type)}`);
  if (departmentId) where.push(`x.department_id = $${params.push(departmentId)}`);
  const { limit, offset } = paginate(q.page, q.pageSize);
  const { rows } = await query<{ total: number }>(
    `SELECT x.*, COUNT(*) OVER()::int AS total FROM (${INCIDENT_SELECT}) x
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (x.status <> 'CLOSED') DESC, x.occurred_at DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  return ok(res, rows.map(({ total: _t, ...r }) => r), { page: q.page, pageSize: q.pageSize, total: rows[0]?.total ?? 0 });
}

async function loadIncident(req: Request, id: string) {
  const { rows } = await query<{ department_id: number }>(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
  if (!rows[0] || !canAccessDepartment(req.user, rows[0].department_id)) throw AppError.notFound('Incident');
  return rows[0];
}

export async function getIncident(req: Request, res: Response) {
  return ok(res, await loadIncident(req, (req.valid.params as { id: string }).id));
}

export async function createIncident(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof incidentSchema>;
  const id = await reportIncident(dbContext(req), requireUser(req), b);
  return created(res, await loadIncident(req, id));
}

/** Investigation status / assignee. Closing happens through the linked CAPA (single workflow). */
export async function updateIncident(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof incidentUpdateSchema>;
  const incident = (await loadIncident(req, id)) as unknown as { status: string };
  if (incident.status === 'CLOSED') throw AppError.conflict('Incident is closed');
  await withTransaction(dbContext(req), (db) =>
    db.query(
      `UPDATE incidents SET status = COALESCE($2::incident_status, status),
              assigned_to = CASE WHEN $3::boolean THEN $4::uuid ELSE assigned_to END WHERE id = $1`,
      [id, b.status ?? null, b.assignedTo !== undefined, b.assignedTo ?? null],
    ),
  );
  return ok(res, await loadIncident(req, id));
}

// ---------------------------------------------------------------- Internal audits

export const listAuditsQuery = pagination.extend({
  status: z.enum(['PLANNED', 'COMPLETED']).optional(),
  department: departmentCode.optional(),
});

export const planAuditSchema = z.object({
  standard: z.enum(AUDIT_STANDARDS),
  department: departmentCode,
  scheduledDate: isoDate,
  title: optText(200),
  auditorId: uuid.optional(),
});

export const completeAuditSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(20), compliant: z.boolean(), note: optText(1000) })).min(1).max(100),
  summary: optText(4000),
});

const AUDIT_SELECT = `
  SELECT ia.*, d.code AS department_code, u.full_name AS auditor_name,
         (SELECT COUNT(*)::int FROM incidents i WHERE i.audit_id = ia.id) AS findings,
         (SELECT COUNT(*)::int FROM incidents i WHERE i.audit_id = ia.id AND i.status <> 'CLOSED') AS open_findings
    FROM internal_audits ia JOIN departments d ON d.id = ia.department_id JOIN users u ON u.id = ia.auditor_id`;

export function checklists(_req: Request, res: Response) {
  return ok(res, CHECKLISTS);
}

export async function listAudits(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listAuditsQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.status) where.push(`x.status = $${params.push(q.status)}`);
  if (departmentId) where.push(`x.department_id = $${params.push(departmentId)}`);
  const { limit, offset } = paginate(q.page, q.pageSize);
  const { rows } = await query<{ total: number }>(
    `SELECT x.id, x.audit_no, x.title, x.standard, x.department_code, x.auditor_name, x.scheduled_date, x.conducted_at,
            x.status, x.score, x.findings, x.open_findings, COUNT(*) OVER()::int AS total
       FROM (${AUDIT_SELECT}) x ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (x.status = 'PLANNED') DESC, x.scheduled_date DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  return ok(res, rows.map(({ total: _t, ...r }) => r), { page: q.page, pageSize: q.pageSize, total: rows[0]?.total ?? 0 });
}

async function loadAudit(req: Request, id: string) {
  const { rows } = await query<{ department_id: number }>(`${AUDIT_SELECT} WHERE ia.id = $1`, [id]);
  if (!rows[0] || !canAccessDepartment(req.user, rows[0].department_id)) throw AppError.notFound('Internal audit');
  return rows[0];
}

export async function getAudit(req: Request, res: Response) {
  return ok(res, await loadAudit(req, (req.valid.params as { id: string }).id));
}

export async function createAudit(req: Request, res: Response) {
  const id = await planAudit(dbContext(req), requireUser(req), req.valid.body);
  return created(res, await loadAudit(req, id));
}

export async function finishAudit(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof completeAuditSchema>;
  await loadAudit(req, id);
  const result = await completeAudit(dbContext(req), requireUser(req), id, b.items, b.summary);
  return ok(res, { ...(await loadAudit(req, id)), ...result });
}
