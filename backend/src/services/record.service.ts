import { DbContext, pool, withTransaction } from '../config/database';
import { env } from '../config/env';
import { Alert, insertAlert } from '../models/alert.model';
import { Equipment, findEquipment } from '../models/equipment.model';
import { Ccp, findCcpById, findTemplate, FormTemplate } from '../models/haccp.model';
import { findRecordById } from '../models/record.model';
import type { AuthUser } from '../types/express';
import { AppError } from '../utils/AppError';
import { publishAlert } from './alert.service';
import { buildDataSchema, evaluate } from './haccpRules';

export interface SubmitRecordInput {
  templateId: string;
  equipmentId?: string;
  data: Record<string, unknown>;
  productName?: string;
  batchNo?: string;
  notes?: string;
  /** Immediate action the operator already took on the spot (PRD: corrective_action_taken). */
  correctiveActionTaken?: string;
  source: 'QR' | 'MANUAL' | 'IOT';
  /** Device time for records captured offline; must be within the last 24h. */
  recordedAt?: string;
  /** Client-generated UUID: makes offline retries idempotent. */
  clientRef?: string;
}

const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

async function findByClientRef(clientRef: string) {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM monitoring_records WHERE client_ref = $1', [clientRef]);
  return rows[0] ? findRecordById(rows[0].id) : undefined;
}

function resolveRecordedAt(recordedAt?: string): Date {
  if (!recordedAt) return new Date();
  const t = new Date(recordedAt);
  const now = Date.now();
  if (t.getTime() > now + MAX_CLOCK_SKEW_MS || t.getTime() < now - MAX_BACKDATE_MS) {
    throw AppError.unprocessable('recordedAt must be within the last 24 hours and not in the future');
  }
  return t;
}

/**
 * Stores a monitoring record and, when a critical limit is breached, atomically raises
 * an alert and opens a CAPA. The alert is pushed to dashboards/mobiles after commit.
 */
export async function submitRecord(ctx: DbContext, user: AuthUser, department: { id: number; code: string }, input: SubmitRecordInput) {
  // Offline replay: the same submission arriving twice returns the original record.
  if (input.clientRef) {
    const existing = await findByClientRef(input.clientRef);
    if (existing) return existing;
  }

  const template = await findTemplate({ id: input.templateId });
  if (!template || !template.is_active) throw AppError.notFound('Form template');
  if (template.department_id !== null && template.department_id !== department.id) {
    throw AppError.badRequest(`Form ${template.code} does not belong to the ${department.code} department`);
  }

  const ccp = template.ccp_id ? await findCcpById(template.ccp_id) : null;

  let equipment: Equipment | undefined;
  if (input.equipmentId) {
    equipment = await findEquipment({ id: input.equipmentId });
    if (!equipment || !equipment.is_active) throw AppError.notFound('Equipment');
    if (equipment.department_id !== department.id) throw AppError.badRequest('Equipment belongs to another department');
  }

  const data = buildDataSchema(template.fields).parse(input.data) as Record<string, unknown>;
  return persistRecord(ctx, user, department.id, template, ccp, equipment?.id ?? null, data, input);
}

/**
 * IoT probe reading (SWOT opportunity: smart probes). Only the CCP measurement is captured;
 * the same critical-limit evaluation, alerting and CAPA flow applies as for manual entries.
 */
export async function submitDeviceReading(equipment: Equipment, value: number, recordedAt?: string) {
  if (!equipment.form_template_id) throw AppError.unprocessable(`No monitoring form is linked to ${equipment.code}`);
  const template = await findTemplate({ id: equipment.form_template_id });
  if (!template || !template.is_active) throw AppError.notFound('Form template');
  const field = template.fields.find((f) => f.ccpMeasurement);
  if (!field) throw AppError.unprocessable(`Form ${template.code} has no CCP measurement for sensor readings`);
  const ccp = template.ccp_id ? await findCcpById(template.ccp_id) : null;

  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE employee_no = 'SYS-IOT'`);
  if (!rows[0]) throw new AppError(500, 'IOT_USER_MISSING', 'IoT system account is not provisioned (run the seed)');
  const device: AuthUser = {
    id: rows[0].id, role: 'HACCP_OFFICER', departmentId: null, departmentCode: null, branchId: null, fullName: equipment.code,
  };

  const data = { [field.key]: value };
  return persistRecord(
    { userId: device.id, userAgent: `iot:${equipment.code}` },
    device,
    equipment.department_id,
    { ...template, fields: [field] },
    ccp,
    equipment.id,
    data,
    { templateId: template.id, data, source: 'IOT', recordedAt, notes: `IoT reading from ${equipment.code}` },
  );
}

async function persistRecord(
  ctx: DbContext,
  user: AuthUser,
  departmentId: number,
  template: FormTemplate,
  ccp: Ccp | null | undefined,
  equipmentId: string | null,
  data: Record<string, unknown>,
  input: SubmitRecordInput,
) {
  const recordedAt = resolveRecordedAt(input.recordedAt);
  const result = evaluate(template.fields, data, ccp);
  const { rows: deptRows } = await pool.query<{ code: string }>('SELECT code FROM departments WHERE id = $1', [departmentId]);
  const departmentCode = deptRows[0]?.code ?? '';

  let newAlert: Alert | undefined;
  let recordId: string;
  try {
    recordId = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO monitoring_records (template_id, template_version, ccp_id, department_id, equipment_id, recorded_by,
                measured_value, unit, data, status, deviations, product_name, batch_no, notes, source, recorded_at,
                branch_id, corrective_action_taken, client_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 COALESCE($17::smallint, (SELECT id FROM branches WHERE code = 'RUH-CK')), $18, $19)
         RETURNING id`,
        [
          template.id, template.version, ccp?.id ?? null, departmentId, equipmentId, user.id,
          result.measuredValue, result.unit, JSON.stringify(data), result.status, JSON.stringify(result.deviations),
          input.productName ?? null, input.batchNo ?? null, input.notes ?? null, input.source, recordedAt,
          user.branchId, input.correctiveActionTaken ?? null, input.clientRef ?? null,
        ],
      );
      const id = rows[0]!.id;

      if (result.status === 'FAIL') {
        const critical = result.deviations.some((d) => d.critical);
        const severity = critical ? ccp?.severity ?? 'CRITICAL' : 'MEDIUM';
        const summary = result.deviations.map((d) => d.message).join('; ');
        const subject = [input.productName, input.batchNo && `#${input.batchNo}`].filter(Boolean).join(' ');

        newAlert = await insertAlert(db, {
          sourceType: 'CCP_DEVIATION',
          sourceId: id,
          departmentId,
          severity,
          title: `${ccp ? `${ccp.code} ` : ''}انحراف — ${template.title_ar}`,
          message: `${departmentCode}${subject ? ` | ${subject}` : ''}: ${summary}`,
        });

        // Auto-assign to the department supervisor; critical deviations are due within 24h.
        await db.query(
          `INSERT INTO capas (record_id, alert_id, ccp_id, department_id, description, immediate_action, assigned_to, due_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6,
                   (SELECT id FROM users WHERE is_active AND role = 'KITCHEN_SUPERVISOR' AND department_id = $4
                     ORDER BY created_at LIMIT 1),
                   (now() AT TIME ZONE $8)::date + $9::int, $7)`,
          [
            id, newAlert?.id ?? null, ccp?.id ?? null, departmentId,
            `${template.title_en}: ${summary}`,
            [input.correctiveActionTaken && `(اتُّخذ في الموقع) ${input.correctiveActionTaken}`, ccp?.corrective_action]
              .filter(Boolean).join('\n') || null,
            user.id, env.APP_TIMEZONE, critical ? 1 : 3,
          ],
        );
      }
      return id;
    });
  } catch (err) {
    // Two replays of the same offline submission raced: return the one that won.
    if (input.clientRef && (err as { code?: string }).code === '23505') {
      const existing = await findByClientRef(input.clientRef);
      if (existing) return existing;
    }
    throw err;
  }

  if (newAlert) publishAlert(newAlert);
  return findRecordById(recordId);
}
