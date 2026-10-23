import type { PoolClient } from 'pg';
import { DbContext, query, withTransaction } from '../config/database';
import { Alert, insertAlert } from '../models/alert.model';
import { findDepartmentByCode } from '../models/department.model';
import type { Severity } from '../models/haccp.model';
import { canAccessDepartment } from '../middlewares/auth';
import type { AuthUser } from '../types/express';
import { AppError } from '../utils/AppError';
import { publishAlert } from './alert.service';
import { CHECKLISTS, AuditStandard } from './auditChecklists';

export type IncidentType =
  | 'NON_CONFORMITY' | 'FOOD_SAFETY_INCIDENT' | 'OHS_INCIDENT' | 'CUSTOMER_COMPLAINT'
  | 'NEAR_MISS' | 'AUDIT_FINDING' | 'REGULATORY_INSPECTION';

export interface NewIncident {
  type: IncidentType;
  severity: Severity;
  departmentId: number;
  title: string;
  description: string;
  location?: string;
  occurredAt?: string;
  assignedTo?: string;
  auditId?: string;
}

/** CAPA due dates by severity (days). */
const DUE_DAYS: Record<Severity, number> = { CRITICAL: 1, HIGH: 3, MEDIUM: 7, LOW: 14 };

/**
 * Registers an incident / non-conformity and opens its CAPA in the same transaction
 * (PRD §3 CAPA Management). High-severity incidents also raise an alert.
 */
export async function insertIncidentWithCapa(db: PoolClient, user: AuthUser, i: NewIncident) {
  const { rows } = await db.query<{ id: string; incident_no: string }>(
    `INSERT INTO incidents (type, severity, department_id, branch_id, title, description, location, occurred_at,
                            reported_by, assigned_to, audit_id)
     VALUES ($1, $2, $3, COALESCE($4::smallint, (SELECT id FROM branches ORDER BY id LIMIT 1)), $5, $6, $7,
             COALESCE($8::timestamptz, now()), $9,
             COALESCE($10::uuid, (SELECT id FROM users WHERE is_active AND role = 'KITCHEN_SUPERVISOR' AND department_id = $3
                                    ORDER BY created_at LIMIT 1)),
             $11)
     RETURNING id, incident_no`,
    [i.type, i.severity, i.departmentId, user.branchId, i.title, i.description, i.location ?? null, i.occurredAt ?? null,
      user.id, i.assignedTo ?? null, i.auditId ?? null],
  );
  const incident = rows[0]!;

  await db.query(
    `INSERT INTO capas (incident_id, department_id, description, assigned_to, due_date, created_by)
     VALUES ($1, $2, $3, (SELECT assigned_to FROM incidents WHERE id = $1), CURRENT_DATE + $4::int, $5)`,
    [incident.id, i.departmentId, `${incident.incident_no} — ${i.title}: ${i.description}`, DUE_DAYS[i.severity], user.id],
  );

  let alert: Alert | undefined;
  if (i.severity === 'HIGH' || i.severity === 'CRITICAL') {
    alert = await insertAlert(db, {
      sourceType: 'INCIDENT',
      sourceId: incident.id,
      departmentId: i.departmentId,
      severity: i.severity,
      title: `بلاغ ${i.type === 'FOOD_SAFETY_INCIDENT' ? 'حادث سلامة غذاء' : 'عدم مطابقة'} — ${incident.incident_no}`,
      message: i.title,
    });
  }
  return { incident, alert };
}

export async function reportIncident(ctx: DbContext, user: AuthUser, input: Omit<NewIncident, 'departmentId'> & { department: string }) {
  const dept = await findDepartmentByCode(input.department as never);
  if (!dept) throw AppError.notFound('Department');
  if (!canAccessDepartment(user, dept.id)) throw AppError.forbidden('You can only report incidents for your own department');
  const { incident, alert } = await withTransaction(ctx, (db) => insertIncidentWithCapa(db, user, { ...input, departmentId: dept.id }));
  if (alert) publishAlert(alert);
  return incident.id;
}

export async function planAudit(
  ctx: DbContext,
  user: AuthUser,
  input: { standard: AuditStandard; department: string; scheduledDate: string; title?: string; auditorId?: string },
) {
  const dept = await findDepartmentByCode(input.department as never);
  if (!dept) throw AppError.notFound('Department');
  const checklist = CHECKLISTS[input.standard];
  const items = checklist.items.map((it) => ({ ...it, compliant: null, note: null }));
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO internal_audits (title, standard, department_id, branch_id, auditor_id, scheduled_date, items, created_by)
       VALUES ($1, $2, $3, COALESCE($4::smallint, (SELECT id FROM branches ORDER BY id LIMIT 1)), $5, $6, $7, $8)
       RETURNING id`,
      [input.title ?? `${checklist.titleAr} — ${dept.name_ar}`, input.standard, dept.id, user.branchId,
        input.auditorId ?? user.id, input.scheduledDate, JSON.stringify(items), user.id],
    );
    return rows[0]!.id;
  });
}

/**
 * Records the audit answers. Score = compliant / answered items; every non-compliant item
 * becomes an AUDIT_FINDING incident with its own CAPA (closed-loop continuous improvement).
 */
export async function completeAudit(
  ctx: DbContext,
  user: AuthUser,
  id: string,
  answers: { id: string; compliant: boolean; note?: string }[],
  summary?: string,
) {
  const { rows } = await query<{ status: string; department_id: number; audit_no: string; items: { id: string; clause: string; question: string }[] }>(
    'SELECT status, department_id, audit_no, items FROM internal_audits WHERE id = $1',
    [id],
  );
  const audit = rows[0];
  if (!audit) throw AppError.notFound('Internal audit');
  if (audit.status === 'COMPLETED') throw AppError.conflict('This audit is already completed');

  const byId = new Map(answers.map((a) => [a.id, a]));
  const missing = audit.items.filter((it) => !byId.has(it.id));
  if (missing.length) throw AppError.unprocessable(`Answer every checklist item (${missing.length} missing)`, missing.map((m) => m.id));
  const nonCompliant = audit.items.filter((it) => !byId.get(it.id)!.compliant);
  for (const it of nonCompliant) {
    if (!byId.get(it.id)!.note?.trim()) throw AppError.unprocessable(`Add an observation for non-compliant item ${it.id}`);
  }

  const items = audit.items.map((it) => ({ ...it, compliant: byId.get(it.id)!.compliant, note: byId.get(it.id)!.note ?? null }));
  const score = Math.round(((items.length - nonCompliant.length) / items.length) * 10000) / 100;

  const alerts: Alert[] = [];
  await withTransaction(ctx, async (db) => {
    await db.query(
      `UPDATE internal_audits SET items = $2, score = $3, summary = $4, status = 'COMPLETED', conducted_at = now() WHERE id = $1`,
      [id, JSON.stringify(items), score, summary ?? null],
    );
    for (const it of nonCompliant) {
      const { alert } = await insertIncidentWithCapa(db, user, {
        type: 'AUDIT_FINDING',
        severity: 'MEDIUM',
        departmentId: audit.department_id,
        title: `ملاحظة تدقيق ${audit.audit_no} — ${it.id} (${it.clause})`,
        description: `${it.question}\nالملاحظة: ${byId.get(it.id)!.note}`,
        auditId: id,
      });
      if (alert) alerts.push(alert);
    }
  });
  alerts.forEach(publishAlert);
  return { score, findings: nonCompliant.length };
}
