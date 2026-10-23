import { db as scopedDb, query, Queryable } from '../config/database';
import type { DepartmentCode } from '../config/permissions';

/** Severity levels shared by CCPs and alerts. */
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Ccp {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  department_id: number | null;
  hazard: string;
  hazard_type: 'BIOLOGICAL' | 'CHEMICAL' | 'PHYSICAL' | 'ALLERGEN';
  parameter: string;
  unit: string;
  min_value: number | null;
  max_value: number | null;
  monitoring_frequency: string;
  corrective_action: string;
  severity: Severity;
  is_active: boolean;
}

export interface Limits {
  min?: number;
  max?: number;
}

/** Values the server calculates itself (PRD "virtual" fields) — never accepted from the client. */
export type FieldCompute =
  /** e.g. closing_balance = opening + inbound − consumption − waste */
  | { kind: 'sum'; terms: { field: string; sign: 1 | -1 }[] }
  /** whole days from today until a date field (negative once passed) */
  | { kind: 'daysUntil'; field: string }
  /** FEFO status from a date field: Safe / Expiring Soon (≤ warnDays) / Expired */
  | { kind: 'expiryStatus'; field: string; warnDays: number }
  /** Compliant / Non-Compliant from the deviations of the listed fields */
  | { kind: 'compliance'; fields: string[] };

/** Auto-filled from where the QR code was scanned. */
export type FieldPrefill = 'equipment.code' | 'equipment.name' | 'equipment.location' | 'branch.name' | 'item.name';

/** FEFO stock engine: `count` sets the batch balance (stock take / receipt), `issue` dispenses from it. */
export interface FieldStock {
  mode: 'count' | 'issue';
  item: string;
  batch: string;
  /** count: the expiry date field of the batch */
  expiry?: string;
}

/** One input on a digital form. Limits make the field self-validating against HACCP rules. */
export interface FormField {
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'number' | 'text' | 'boolean' | 'date' | 'select' | 'time' | 'month';
  hint?: string;
  /** Display labels for stored option values (e.g. Accepted → مقبولة). */
  optionLabels?: Record<string, string>;
  /** Critical limits that depend on another (select) field, e.g. chilled 2–8 °C, frozen ≤ −18 °C. */
  limitsBy?: { field: string; cases: Record<string, Limits> };
  /** Hard input range: values outside are refused (e.g. quantity ≥ 0) — unlike min/max, which raise a deviation. */
  validMin?: number;
  validMax?: number;
  /** Date that must be strictly after another date field (e.g. expiry_date > mfg_date), otherwise refused. */
  after?: string;
  /** Regular expression the text must match (e.g. ERP purchase-order number). */
  pattern?: string;
  patternMessage?: string;
  /** Value may appear only once per form (optionally together with other fields, e.g. month + item). */
  unique?: boolean;
  uniqueWith?: string[];
  /** Carried over from this field of the previous record (optionally matched on other fields). */
  carryFrom?: string;
  carryMatch?: string[];
  compute?: FieldCompute;
  prefill?: FieldPrefill;
  /** Select: the value forced when a critical deviation exists (e.g. acceptance = Rejected). */
  onCriticalDeviation?: string;
  /** Select: the company maintains the option list itself (e.g. approved suppliers). */
  companyOptions?: boolean;
  /** Text: must be an active code of the company's item master (foreign key); fills `item.name` fields. */
  itemRef?: boolean;
  /** Opens a non-conformity report (NCR) with its CAPA when the answer equals this value (e.g. Rejected, false). */
  ncrWhen?: string | boolean;
  /** Number: quantity moved in the FEFO stock engine. */
  stock?: FieldStock;
  /** Text: batch of the item in this field, offered in FEFO order (earliest expiry first). */
  stockBatchOf?: string;
  unit?: string;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  /** For boolean checks: the compliant answer (e.g. "packaging intact" must be true). */
  expected?: boolean;
  /** Primary CCP reading. Its critical limits come from the linked CCP (single source of truth). */
  ccpMeasurement?: boolean;
  /** Time limit (e.g. blast chilling 60→4°C in ≤ 360 min): this 'time' field ends the interval started by `durationFrom`. */
  durationFrom?: string;
  maxMinutes?: number;
  /** Treat a deviation on this field as critical (part of the CCP), even if it is not the main measurement. */
  critical?: boolean;
}

export interface FormTemplate {
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  description: string | null;
  department_id: number | null;
  department_code: DepartmentCode | null;
  ccp_id: string | null;
  fields: FormField[];
  qr_token: string;
  version: number;
  is_active: boolean;
  catalog_id: string | null;
  customized: boolean;
  min_daily_entries: number;
  /** Periodic monitoring: alert when no reading for this many minutes (0 = off). */
  max_gap_minutes: number;
}

const TEMPLATE_COLUMNS = `t.id, t.code, t.title_ar, t.title_en, t.description, t.department_id, d.code AS department_code,
  t.ccp_id, t.fields, t.qr_token, t.version, t.is_active, t.catalog_id, t.customized, t.min_daily_entries, t.max_gap_minutes`;

export async function listCcps(departmentId?: number) {
  const { rows } = await query<Ccp>(
    `SELECT * FROM ccps WHERE is_active AND ($1::smallint IS NULL OR department_id IS NULL OR department_id = $1) ORDER BY code`,
    [departmentId ?? null],
  );
  return rows;
}

export async function findCcpById(id: string, db: Queryable = scopedDb) {
  const { rows } = await db.query<Ccp>('SELECT * FROM ccps WHERE id = $1', [id]);
  return rows[0];
}

export async function listTemplates(departmentId?: number) {
  const { rows } = await query<FormTemplate>(
    `SELECT ${TEMPLATE_COLUMNS} FROM form_templates t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.is_active AND ($1::smallint IS NULL OR t.department_id IS NULL OR t.department_id = $1)
      ORDER BY t.code`,
    [departmentId ?? null],
  );
  return rows;
}

export async function findTemplate(by: { id?: string; qrToken?: string }, db: Queryable = scopedDb) {
  const [column, value] = by.id ? ['t.id', by.id] : ['t.qr_token', by.qrToken];
  const { rows } = await db.query<FormTemplate>(
    `SELECT ${TEMPLATE_COLUMNS} FROM form_templates t LEFT JOIN departments d ON d.id = t.department_id WHERE ${column} = $1`,
    [value],
  );
  return rows[0];
}
