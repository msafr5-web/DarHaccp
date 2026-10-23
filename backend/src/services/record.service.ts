import type { PoolClient } from 'pg';
import { DbContext, query, withTransaction } from '../config/database';
import { CROSS_DEPARTMENT_ROLES } from '../config/permissions';
import { env } from '../config/env';
import { Alert, insertAlert } from '../models/alert.model';
import { Equipment, findEquipment } from '../models/equipment.model';
import { Ccp, findCcpById, findTemplate, FormField, FormTemplate } from '../models/haccp.model';
import { Deviation, findRecordById } from '../models/record.model';
import type { AuthUser } from '../types/express';
import { AppError } from '../utils/AppError';
import { publishAlert } from './alert.service';
import { applyCompliance, buildDataSchema, checkStrictRules, computeFields, evaluate, Evaluation } from './haccpRules';

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
  /** Identifier of the phone / browser the form was filled on. */
  deviceId?: string;
}

const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

async function findByClientRef(clientRef: string) {
  const { rows } = await query<{ id: string }>('SELECT id FROM monitoring_records WHERE client_ref = $1', [clientRef]);
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

/** Calendar date (YYYY-MM-DD) of `at` in the company's timezone — the reference for expiry / days remaining. */
export function localDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '';

// ---------------------------------------------------------------- automatic values (QR location, carry-over)

export interface FillPlace {
  equipment?: Pick<Equipment, 'id' | 'code' | 'name' | 'location'> | null;
  branchName?: string | null;
}

/** Values filled from where the QR code was scanned (data logger code, zone, branch). */
export function placeValues(fields: FormField[], place: FillPlace): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = f.prefill === 'equipment.code' ? place.equipment?.code
      : f.prefill === 'equipment.name' ? place.equipment?.name
      : f.prefill === 'equipment.location' ? place.equipment?.location
      : f.prefill === 'branch.name' ? place.branchName : undefined;
    if (v) out[f.key] = v;
  }
  return out;
}

/**
 * Carry-over (e.g. opening balance = closing balance of the previous month for the same item):
 * the latest record of this form (same equipment) whose `carryMatch` answers are the same.
 */
export async function carriedValues(template: FormTemplate, equipmentId: string | null, data: Record<string, unknown>, excludeRecordId?: string) {
  const out: Record<string, unknown> = {};
  for (const f of template.fields) {
    if (!f.carryFrom) continue;
    const match = f.carryMatch ?? [];
    if (!match.every((k) => present(data[k]))) continue;
    const { rows } = await query<{ value: unknown }>(
      `SELECT data -> $2::text AS value FROM monitoring_records
        WHERE template_id = $1 AND data @> $3::jsonb AND equipment_id IS NOT DISTINCT FROM $4::uuid
          AND ($5::uuid IS NULL OR id <> $5::uuid) AND data ? $2::text
        ORDER BY recorded_at DESC LIMIT 1`,
      [template.id, f.carryFrom, JSON.stringify(Object.fromEntries(match.map((k) => [k, data[k]]))), equipmentId, excludeRecordId ?? null],
    );
    if (rows[0] && present(rows[0].value)) out[f.key] = rows[0].value;
  }
  return out;
}

async function assertUnique(template: FormTemplate, data: Record<string, unknown>, excludeRecordId?: string) {
  for (const f of template.fields) {
    if (!f.unique || !present(data[f.key])) continue;
    const keys = [f.key, ...(f.uniqueWith ?? [])].filter((k) => present(data[k]));
    const { rowCount } = await query(
      `SELECT 1 FROM monitoring_records WHERE template_id = $1 AND data @> $2::jsonb AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [template.id, JSON.stringify(Object.fromEntries(keys.map((k) => [k, data[k]]))), excludeRecordId ?? null],
    );
    if (rowCount) {
      const what = keys.map((k) => `${template.fields.find((x) => x.key === k)?.labelAr ?? k} "${data[k]}"`).join(' + ');
      throw AppError.conflict(`${what} مسجّل مسبقاً في هذا النموذج — لا يُسمح بالتكرار`);
    }
  }
}

/**
 * Item master as a foreign key: `itemRef` codes must exist (active) in the company's items list;
 * the stored code takes the master's spelling and `item.name` fields get the master's name.
 */
async function resolveItems(fields: FormField[], data: Record<string, unknown>) {
  const ref = fields.find((f) => f.itemRef && typeof data[f.key] === 'string' && data[f.key] !== '');
  if (!ref) return;
  const { rows } = await query<{ code: string; name_ar: string }>(
    'SELECT code, name_ar FROM items WHERE UPPER(code) = UPPER($1) AND is_active', [String(data[ref.key]).trim()],
  );
  if (!rows[0]) {
    throw new AppError(422, 'UNKNOWN_ITEM', `${ref.labelAr} "${data[ref.key]}" غير موجود في جدول الأصناف الرئيسي — أضفه أولاً من شاشة الأصناف`);
  }
  data[ref.key] = rows[0].code;
  for (const f of fields) if (f.prefill === 'item.name') data[f.key] = rows[0].name_ar;
}

interface Prepared {
  data: Record<string, unknown>;
  result: Evaluation;
}

/**
 * The single validation pipeline of every form (mobile, web, offline replay, amendment):
 * automatic values → types & required → strict refusals → computed fields → uniqueness →
 * critical-limit evaluation → computed compliance & forced answers.
 */
async function prepareRecord(
  template: FormTemplate,
  ccp: Ccp | null | undefined,
  place: FillPlace,
  input: Record<string, unknown>,
  opts: { recordedAt: Date; excludeRecordId?: string; carried?: Record<string, unknown> },
): Promise<Prepared> {
  const fields = template.fields;
  const raw: Record<string, unknown> = {};
  for (const f of fields) if (!f.compute && input[f.key] !== undefined) raw[f.key] = input[f.key];
  for (const [k, v] of Object.entries(input)) if (!fields.some((f) => f.key === k)) raw[k] = v; // rejected by the strict schema

  for (const [k, v] of Object.entries(placeValues(fields, place))) if (!present(raw[k])) raw[k] = v;

  // Carried values are the server's: the operator cannot overwrite them.
  const carried = opts.carried ?? (await carriedValues(template, place.equipment?.id ?? null, raw, opts.excludeRecordId));
  Object.assign(raw, carried);

  const data = buildDataSchema(fields, { carried: new Set(Object.keys(carried)) }).parse(raw) as Record<string, unknown>;
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];

  await resolveItems(fields, data);

  const refused = [...checkStrictRules(fields, data), ...computeFields(fields, data, localDate(opts.recordedAt))];
  if (refused.length) throw new AppError(422, 'RULE_VIOLATION', refused.join(' · '));

  await assertUnique(template, data, opts.excludeRecordId);

  const result = evaluate(fields, data, ccp);
  const forced = applyCompliance(fields, data, result.deviations);
  if (forced.length) throw new AppError(422, 'RULE_VIOLATION', forced.join(' · '));
  return { data, result };
}

async function branchName(branchId: number | null) {
  const { rows } = await query<{ name_ar: string }>(
    'SELECT name_ar FROM branches WHERE ($1::smallint IS NULL OR id = $1) ORDER BY id LIMIT 1',
    [branchId],
  );
  return rows[0]?.name_ar ?? null;
}

// ---------------------------------------------------------------- submit

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

  const recordedAt = resolveRecordedAt(input.recordedAt);
  const prepared = await prepareRecord(template, ccp, { equipment, branchName: await branchName(user.branchId) }, input.data, { recordedAt });
  return persistRecord(ctx, user, department.id, template, ccp, equipment?.id ?? null, prepared, input, recordedAt);
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

  const { rows } = await query<{ id: string }>(`SELECT id FROM users WHERE employee_no = 'SYS-IOT'`);
  if (!rows[0]) throw new AppError(500, 'IOT_USER_MISSING', 'IoT system account is not provisioned (run the seed)');
  const device: AuthUser = {
    id: rows[0].id, role: 'HACCP_OFFICER', departmentId: null, departmentCode: null, branchId: null, fullName: equipment.code,
    employeeNo: 'SYS-IOT', recordAccess: 'FILL', tenantId: equipment.tenant_id, tenantCode: '', tenantName: '',
  };

  const data = { [field.key]: value };
  const sensorTemplate = { ...template, fields: [field] };
  const at = resolveRecordedAt(recordedAt);
  return persistRecord(
    { userId: device.id, userAgent: `iot:${equipment.code}` },
    device,
    equipment.department_id,
    sensorTemplate,
    ccp,
    equipment.id,
    { data, result: evaluate(sensorTemplate.fields, data, ccp) },
    { templateId: template.id, data, source: 'IOT', notes: `IoT reading from ${equipment.code}`, deviceId: `iot:${equipment.code}` },
    at,
  );
}

/** Alert + CAPA for a failed record (inside the record's transaction). */
async function raiseDeviation(
  db: PoolClient, user: AuthUser, recordId: string, departmentId: number, template: FormTemplate, ccp: Ccp | null | undefined,
  deviations: Deviation[], subject: { productName?: string | null; batchNo?: string | null; correctiveActionTaken?: string | null },
) {
  const { rows: deptRows } = await db.query<{ code: string }>('SELECT code FROM departments WHERE id = $1', [departmentId]);
  const departmentCode = deptRows[0]?.code ?? '';
  const critical = deviations.some((d) => d.critical);
  const severity = critical ? ccp?.severity ?? 'CRITICAL' : 'MEDIUM';
  const summary = deviations.map((d) => d.message).join('; ');
  const what = [subject.productName, subject.batchNo && `#${subject.batchNo}`].filter(Boolean).join(' ');

  const alert = await insertAlert(db, {
    sourceType: 'CCP_DEVIATION',
    sourceId: recordId,
    departmentId,
    severity,
    title: `${ccp ? `${ccp.code} ` : ''}انحراف — ${template.title_ar}`,
    message: `${departmentCode}${what ? ` | ${what}` : ''}: ${summary}`,
  });

  // Auto-assign to the department supervisor; critical deviations are due within 24h.
  await db.query(
    `INSERT INTO capas (record_id, alert_id, ccp_id, department_id, description, immediate_action, assigned_to, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6,
             (SELECT id FROM users WHERE is_active AND role = 'KITCHEN_SUPERVISOR' AND department_id = $4
               ORDER BY created_at LIMIT 1),
             (now() AT TIME ZONE $8)::date + $9::int, $7)`,
    [
      recordId, alert?.id ?? null, ccp?.id ?? null, departmentId,
      `${template.title_en}: ${summary}`,
      [subject.correctiveActionTaken && `(اتُّخذ في الموقع) ${subject.correctiveActionTaken}`, ccp?.corrective_action]
        .filter(Boolean).join('\n') || null,
      user.id, env.APP_TIMEZONE, critical ? 1 : 3,
    ],
  );
  return alert;
}

async function persistRecord(
  ctx: DbContext,
  user: AuthUser,
  departmentId: number,
  template: FormTemplate,
  ccp: Ccp | null | undefined,
  equipmentId: string | null,
  { data, result }: Prepared,
  input: SubmitRecordInput,
  recordedAt: Date,
) {
  let newAlert: Alert | undefined;
  let ncrAlert: Alert | undefined;
  let recordId: string;
  try {
    recordId = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO monitoring_records (template_id, template_version, ccp_id, department_id, equipment_id, recorded_by,
                measured_value, unit, data, status, deviations, product_name, batch_no, notes, source, recorded_at,
                branch_id, corrective_action_taken, client_ref, device_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 COALESCE($17::smallint, (SELECT id FROM branches ORDER BY id LIMIT 1)), $18, $19, $20)
         RETURNING id`,
        [
          template.id, template.version, ccp?.id ?? null, departmentId, equipmentId, user.id,
          result.measuredValue, result.unit, JSON.stringify(data), result.status, JSON.stringify(result.deviations),
          input.productName ?? null, input.batchNo ?? null, input.notes ?? null, input.source, recordedAt,
          user.branchId, input.correctiveActionTaken ?? null, input.clientRef ?? null, input.deviceId ?? null,
        ],
      );
      const id = rows[0]!.id;
      if (result.status === 'FAIL') {
        newAlert = await raiseDeviation(db, user, id, departmentId, template, ccp, result.deviations, input);
      }
      await applyStock(db, template.fields, data, id, user, localDate(recordedAt));
      ncrAlert = await raiseNcr(db, user, id, departmentId, template, data, result);
      // A reading arrived: the "no reading for 2 h 30" alert of this data logger / form is resolved.
      if (template.max_gap_minutes > 0) {
        await db.query(
          `UPDATE alerts SET status = 'RESOLVED', resolved_at = now()
            WHERE source_type = 'MONITORING_OVERDUE' AND status <> 'RESOLVED' AND source_id = $1`,
          [equipmentId ?? template.id],
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
  if (ncrAlert) publishAlert(ncrAlert);
  return findRecordById(recordId);
}

// ---------------------------------------------------------------- FEFO stock engine

const num = (v: unknown) => Number(v);

/**
 * Stock movement of a record, in the record's transaction (refusal rolls the record back):
 *  - count: the batch balance becomes the counted quantity (stock take / receipt), expiry updated;
 *  - issue: only an existing, non-expired batch, within its balance, and only the earliest-expiring
 *    available batch of the item (FEFO). Every movement is kept in the append-only ledger.
 */
async function applyStock(db: PoolClient, fields: FormField[], data: Record<string, unknown>, recordId: string, user: AuthUser, today: string) {
  const f = fields.find((x) => x.stock);
  if (!f?.stock) return;
  const item = String(data[f.stock.item] ?? '').trim();
  const batch = String(data[f.stock.batch] ?? '').trim();
  const qty = data[f.key];
  if (!item || !batch || typeof qty !== 'number') return;

  const { rows } = await db.query<{ id: string; quantity: string; expiry_date: string; batch_number: string }>(
    `SELECT id, quantity, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date, batch_number FROM stock_batches
      WHERE UPPER(item_code) = UPPER($1) AND UPPER(batch_number) = UPPER($2) FOR UPDATE`,
    [item, batch],
  );
  const row = rows[0];

  if (f.stock.mode === 'count') {
    const expiry = String(data[f.stock.expiry ?? ''] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return;
    let batchId = row?.id;
    if (row) {
      await db.query('UPDATE stock_batches SET quantity = $2, expiry_date = $3, last_record_id = $4 WHERE id = $1', [row.id, qty, expiry, recordId]);
    } else {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO stock_batches (item_code, batch_number, expiry_date, quantity, last_record_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [item, batch, expiry, qty, recordId],
      );
      batchId = ins.rows[0]!.id;
    }
    await db.query(
      `INSERT INTO stock_movements (stock_batch_id, record_id, movement, quantity_before, quantity_after, created_by)
       VALUES ($1, $2, 'COUNT', $3, $4, $5)`,
      [batchId, recordId, row ? num(row.quantity) : 0, qty, user.id],
    );
    return;
  }

  if (!row) throw new AppError(422, 'FEFO_UNKNOWN_BATCH', `التشغيلة ${batch} غير موجودة في مخزون الصنف ${item} — سجّل الجرد أو الاستلام أولاً`);
  if (row.expiry_date < today) {
    throw new AppError(422, 'FEFO_EXPIRED', `التشغيلة ${row.batch_number} منتهية الصلاحية (${row.expiry_date}) — يُمنع صرفها وتوجَّه للهالك`);
  }
  const available = num(row.quantity);
  if (qty > available) throw new AppError(422, 'FEFO_INSUFFICIENT', `الكمية المطلوبة (${qty}) أكبر من رصيد التشغيلة ${row.batch_number} (${available})`);
  const earlier = await db.query<{ batch_number: string; expiry_date: string; quantity: string }>(
    `SELECT batch_number, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date, quantity FROM stock_batches
      WHERE UPPER(item_code) = UPPER($1) AND quantity > 0 AND expiry_date >= $2::date AND expiry_date < $3::date AND id <> $4
      ORDER BY expiry_date, created_at LIMIT 1`,
    [item, today, row.expiry_date, row.id],
  );
  if (earlier.rows[0]) {
    const e = earlier.rows[0];
    throw new AppError(409, 'FEFO_ORDER', `سياسة FEFO: يجب صرف التشغيلة ${e.batch_number} أولاً (تنتهي ${e.expiry_date}، الرصيد ${num(e.quantity)})`);
  }
  await db.query('UPDATE stock_batches SET quantity = quantity - $2, last_record_id = $3 WHERE id = $1', [row.id, qty, recordId]);
  await db.query(
    `INSERT INTO stock_movements (stock_batch_id, record_id, movement, quantity_before, quantity_after, created_by)
     VALUES ($1, $2, 'ISSUE', $3, $4, $5)`,
    [row.id, recordId, available, Math.round((available - qty) * 1000) / 1000, user.id],
  );
}

// ---------------------------------------------------------------- NCR (non-conformity report)

const NCR_DUE_DAYS = { HIGH: 3, MEDIUM: 7 } as const;

/**
 * PRD: a rejected shipment (or a missing CoA) opens a non-conformity report. The NCR is linked to the
 * record and to its CAPA — the deviation CAPA when there is one, otherwise a new CAPA for the NCR.
 */
async function raiseNcr(
  db: PoolClient, user: AuthUser, recordId: string, departmentId: number, template: FormTemplate,
  data: Record<string, unknown>, result: Evaluation,
): Promise<Alert | undefined> {
  const triggers = template.fields.filter((f) => f.ncrWhen !== undefined && data[f.key] === f.ncrWhen);
  if (!triggers.length) return undefined;
  const critical = result.deviations.some((d) => d.critical);
  const severity = critical ? 'HIGH' : 'MEDIUM';
  const label = (f: FormField) => {
    const v = data[f.key];
    return typeof v === 'boolean' ? (v ? 'نعم' : 'لا') : f.optionLabels?.[String(v)] ?? String(v);
  };
  const reference = template.fields.filter((f) => f.unique || f.key === 'batch_number' || f.key === 'item_code' || f.key === 'supplier_name')
    .filter((f) => data[f.key] !== undefined).map((f) => `${f.labelAr}: ${data[f.key]}`).join(' · ');
  const description = [
    `${triggers.map((f) => `${f.labelAr} = ${label(f)}`).join('، ')}${reference ? ` — ${reference}` : ''}`,
    ...result.deviations.map((d) => `• ${d.label}: ${String(d.value)} (الحد ${d.limit})`),
    `السجل ${recordId.slice(0, 8).toUpperCase()}`,
  ].join('\n');

  const { rows } = await db.query<{ id: string; incident_no: string }>(
    `INSERT INTO incidents (type, severity, department_id, branch_id, title, description, reported_by, assigned_to, record_id)
     VALUES ('NON_CONFORMITY', $1, $2, COALESCE($3::smallint, (SELECT id FROM branches ORDER BY id LIMIT 1)), $4, $5, $6,
             (SELECT id FROM users WHERE is_active AND role = 'KITCHEN_SUPERVISOR' AND department_id = $2 ORDER BY created_at LIMIT 1), $7)
     RETURNING id, incident_no`,
    [severity, departmentId, user.branchId, `تقرير عدم مطابقة (NCR) — ${template.title_ar}`, description, user.id, recordId],
  );
  const ncr = rows[0]!;
  const linked = await db.query('UPDATE capas SET incident_id = $1 WHERE record_id = $2 AND incident_id IS NULL', [ncr.id, recordId]);
  if (!linked.rowCount) {
    await db.query(
      `INSERT INTO capas (incident_id, record_id, department_id, description, assigned_to, due_date, created_by)
       VALUES ($1, $2, $3, $4, (SELECT assigned_to FROM incidents WHERE id = $1), (now() AT TIME ZONE $5)::date + $6::int, $7)`,
      [ncr.id, recordId, departmentId, `${ncr.incident_no} — ${template.title_ar}: ${description}`, env.APP_TIMEZONE, NCR_DUE_DAYS[severity], user.id],
    );
  }
  // Critical cases already raised the deviation alert; a plain rejection is announced as an NCR.
  if (result.status === 'FAIL') return undefined;
  return insertAlert(db, {
    sourceType: 'INCIDENT', sourceId: ncr.id, departmentId, severity,
    title: `تقرير عدم مطابقة ${ncr.incident_no}`, message: `${template.title_ar}: ${triggers.map((f) => `${f.labelAr} = ${label(f)}`).join('، ')}`,
  });
}

// ---------------------------------------------------------------- amendment (FILL_EDIT employees)

export interface AmendRecordInput {
  data: Record<string, unknown>;
  reason: string;
  notes?: string | null;
  correctiveActionTaken?: string | null;
}

interface StoredRecord {
  id: string;
  template_id: string;
  template_version: number;
  department_id: number;
  equipment_id: string | null;
  recorded_by: string;
  source: string;
  data: Record<string, unknown>;
  status: 'PASS' | 'FAIL';
  deviations: Deviation[];
  notes: string | null;
  corrective_action_taken: string | null;
  product_name: string | null;
  batch_no: string | null;
  revision: number;
  recorded_at: string;
  amended_at: string | null;
  amended_by: string | null;
}

/** Who may amend a record: FILL_EDIT employees (company admins always); kitchen staff only their own records. */
export function canAmend(user: AuthUser, record: { recorded_by: string; source: string }) {
  if (record.source === 'IOT') return false;
  if (user.role !== 'ADMIN' && user.recordAccess !== 'FILL_EDIT') return false;
  return CROSS_DEPARTMENT_ROLES.includes(user.role) || record.recorded_by === user.id;
}

/**
 * Controlled correction of a record. The previous version (values, author, time) is kept in the
 * append-only revision history with the reason; the record is re-validated with the same rules,
 * and a deviation that appears through the correction raises its alert + CAPA like a new entry.
 */
export async function amendRecord(ctx: DbContext, user: AuthUser, department: { id: number }, id: string, input: AmendRecordInput) {
  const { rows } = await query<StoredRecord>('SELECT * FROM monitoring_records WHERE id = $1', [id]);
  const record = rows[0];
  if (!record || record.department_id !== department.id) throw AppError.notFound('Record');
  if (record.source === 'IOT') throw AppError.conflict('قراءات المجسات الآلية لا تُعدَّل');
  if (!canAmend(user, record)) {
    throw new AppError(403, 'FILL_ONLY', user.recordAccess === 'FILL' && user.role !== 'ADMIN'
      ? 'صلاحيتك تعبئة فقط — تعديل السجلات يتطلب صلاحية "تعبئة وتعديل"'
      : 'يمكنك تعديل السجلات التي عبأتها أنت فقط');
  }

  const template = await findTemplate({ id: record.template_id });
  if (!template) throw AppError.notFound('Form template');
  if (template.fields.some((f) => f.stock)) {
    throw new AppError(409, 'STOCK_RECORD', 'سجلات حركة المخزون لا تُعدَّل حفاظاً على دفتر FEFO — سجّل جرداً أو حركة تصحيحية جديدة');
  }
  if (template.version !== record.template_version) {
    throw AppError.conflict(`تغيّرت حقول النموذج منذ تعبئة هذا السجل (الإصدار ${record.template_version} → ${template.version}) — لا يمكن تعديله، سجّل قراءة جديدة`);
  }
  const ccp = template.ccp_id ? await findCcpById(template.ccp_id) : null;
  const equipment = record.equipment_id ? await findEquipment({ id: record.equipment_id }) : null;

  // Carried values (e.g. opening balance) stay as they were when the record was captured.
  const carried = Object.fromEntries(template.fields.filter((f) => f.carryFrom && present(record.data[f.key])).map((f) => [f.key, record.data[f.key]]));
  const { data, result } = await prepareRecord(template, ccp, { equipment, branchName: await branchName(user.branchId) }, input.data, {
    recordedAt: new Date(record.recorded_at), excludeRecordId: id, carried,
  });
  const ncrBefore = template.fields.some((f) => f.ncrWhen !== undefined && record.data[f.key] === f.ncrWhen);

  let newAlert: Alert | undefined;
  let ncrAlert: Alert | undefined;
  await withTransaction(ctx, async (db) => {
    await db.query(`SELECT set_config('app.record_amend', 'on', true)`);
    await db.query(
      `INSERT INTO record_revisions (record_id, revision, data, status, deviations, notes, corrective_action_taken,
                                     authored_by, authored_at, superseded_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, record.revision, JSON.stringify(record.data), record.status, JSON.stringify(record.deviations), record.notes,
        record.corrective_action_taken, record.amended_by ?? record.recorded_by, record.amended_at ?? record.recorded_at, user.id, input.reason],
    );
    await db.query(
      `UPDATE monitoring_records SET data = $2, status = $3, deviations = $4, measured_value = $5, unit = $6,
              notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
              corrective_action_taken = CASE WHEN $9::boolean THEN $10 ELSE corrective_action_taken END,
              revision = revision + 1, amended_at = clock_timestamp(), amended_by = $11, amendment_reason = $12
        WHERE id = $1`,
      [id, JSON.stringify(data), result.status, JSON.stringify(result.deviations), result.measuredValue, result.unit,
        input.notes !== undefined, input.notes ?? null, input.correctiveActionTaken !== undefined, input.correctiveActionTaken ?? null,
        user.id, input.reason],
    );
    // A correction that turns into a rejection opens its NCR (once).
    if (!ncrBefore) ncrAlert = await raiseNcr(db, user, id, record.department_id, template, data, result);
    if (result.status === 'FAIL') {
      const { rowCount } = await db.query(`SELECT 1 FROM alerts WHERE source_type = 'CCP_DEVIATION' AND source_id = $1`, [id]);
      if (!rowCount) {
        newAlert = await raiseDeviation(db, user, id, record.department_id, template, ccp, result.deviations, {
          productName: record.product_name, batchNo: record.batch_no, correctiveActionTaken: input.correctiveActionTaken,
        });
      }
    }
  });

  if (newAlert) publishAlert(newAlert);
  if (ncrAlert) publishAlert(ncrAlert);
  return findRecordById(id);
}

export async function listRevisions(recordId: string) {
  const { rows } = await query(
    `SELECT v.revision, v.data, v.status, v.deviations, v.notes, v.corrective_action_taken, v.authored_at,
            a.full_name AS authored_by_name, v.superseded_at, s.full_name AS superseded_by_name, v.reason
       FROM record_revisions v JOIN users a ON a.id = v.authored_by JOIN users s ON s.id = v.superseded_by
      WHERE v.record_id = $1 ORDER BY v.revision DESC`,
    [recordId],
  );
  return rows;
}

/** Automatic values for a form being filled (shown read-only; the server applies them again on submit). */
export async function formPrefill(user: AuthUser, template: FormTemplate, equipment: FillPlace['equipment'], data: Record<string, unknown> = {}) {
  const place = placeValues(template.fields, { equipment, branchName: await branchName(user.branchId) });
  const carried = await carriedValues(template, equipment?.id ?? null, { ...place, ...data });
  return { ...place, ...carried };
}
