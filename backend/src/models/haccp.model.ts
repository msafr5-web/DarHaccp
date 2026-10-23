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

/** One input on a digital form. Limits make the field self-validating against HACCP rules. */
export interface FormField {
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'number' | 'text' | 'boolean' | 'date' | 'select' | 'time';
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
}

const TEMPLATE_COLUMNS = `t.id, t.code, t.title_ar, t.title_en, t.description, t.department_id, d.code AS department_code,
  t.ccp_id, t.fields, t.qr_token, t.version, t.is_active`;

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
