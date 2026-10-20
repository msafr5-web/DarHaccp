import { DbContext, withTransaction } from '../config/database';
import { env } from '../config/env';
import { Alert, insertAlert } from '../models/alert.model';
import { findEquipment } from '../models/equipment.model';
import { findCcpById, findTemplate } from '../models/haccp.model';
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
  source: 'QR' | 'MANUAL';
  /** Device time for records captured offline; must be within the last 24h. */
  recordedAt?: string;
}

const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Stores a monitoring record and, when a critical limit is breached, atomically raises
 * an alert and opens a CAPA. The alert is pushed to dashboards/mobiles after commit.
 */
export async function submitRecord(ctx: DbContext, user: AuthUser, department: { id: number; code: string }, input: SubmitRecordInput) {
  const template = await findTemplate({ id: input.templateId });
  if (!template || !template.is_active) throw AppError.notFound('Form template');
  if (template.department_id !== null && template.department_id !== department.id) {
    throw AppError.badRequest(`Form ${template.code} does not belong to the ${department.code} department`);
  }

  const ccp = template.ccp_id ? await findCcpById(template.ccp_id) : null;

  let equipmentId: string | null = null;
  if (input.equipmentId) {
    const equipment = await findEquipment({ id: input.equipmentId });
    if (!equipment || !equipment.is_active) throw AppError.notFound('Equipment');
    if (equipment.department_id !== department.id) throw AppError.badRequest('Equipment belongs to another department');
    equipmentId = equipment.id;
  }

  let recordedAt = new Date();
  if (input.recordedAt) {
    const t = new Date(input.recordedAt);
    const now = Date.now();
    if (t.getTime() > now + MAX_CLOCK_SKEW_MS || t.getTime() < now - MAX_BACKDATE_MS) {
      throw AppError.unprocessable('recordedAt must be within the last 24 hours and not in the future');
    }
    recordedAt = t;
  }

  const data = buildDataSchema(template.fields).parse(input.data) as Record<string, unknown>;
  const result = evaluate(template.fields, data, ccp);

  let newAlert: Alert | undefined;

  const recordId = await withTransaction(ctx, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO monitoring_records (template_id, template_version, ccp_id, department_id, equipment_id, recorded_by,
              measured_value, unit, data, status, deviations, product_name, batch_no, notes, source, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [
        template.id, template.version, ccp?.id ?? null, department.id, equipmentId, user.id,
        result.measuredValue, result.unit, JSON.stringify(data), result.status, JSON.stringify(result.deviations),
        input.productName ?? null, input.batchNo ?? null, input.notes ?? null, input.source, recordedAt,
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
        departmentId: department.id,
        severity,
        title: `${ccp ? `${ccp.code} ` : ''}انحراف — ${template.title_ar}`,
        message: `${department.code}${subject ? ` | ${subject}` : ''}: ${summary}`,
      });

      // Auto-assign to the department supervisor; critical deviations are due within 24h.
      await db.query(
        `INSERT INTO capas (record_id, alert_id, ccp_id, department_id, description, immediate_action, assigned_to, due_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6,
                 (SELECT id FROM users WHERE is_active AND role = 'KITCHEN_SUPERVISOR' AND department_id = $4
                   ORDER BY created_at LIMIT 1),
                 (now() AT TIME ZONE $8)::date + $9::int, $7)`,
        [
          id, newAlert?.id ?? null, ccp?.id ?? null, department.id,
          `${template.title_en}: ${summary}`, ccp?.corrective_action ?? null, user.id,
          env.APP_TIMEZONE, critical ? 1 : 3,
        ],
      );
    }
    return id;
  });

  if (newAlert) publishAlert(newAlert);
  return findRecordById(recordId);
}
