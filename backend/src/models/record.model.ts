import { query } from '../config/database';

export interface Deviation {
  field: string;
  label: string;
  value: unknown;
  limit: string;
  message: string;
  critical: boolean;
}

export interface MonitoringRecord {
  id: string;
  template_id: string;
  template_code: string;
  template_title_ar: string;
  ccp_id: string | null;
  ccp_code: string | null;
  department_id: number;
  department_code: string;
  equipment_id: string | null;
  equipment_code: string | null;
  recorded_by: string;
  recorded_by_name: string;
  measured_value: number | null;
  unit: string | null;
  data: Record<string, unknown>;
  status: 'PASS' | 'FAIL';
  deviations: Deviation[];
  product_name: string | null;
  batch_no: string | null;
  notes: string | null;
  corrective_action_taken: string | null;
  source: 'QR' | 'MANUAL' | 'IOT';
  recorded_at: string;
  capa_id: string | null;
  // Fill context shown on the record: company, site, device, employee, revision trail.
  company_name: string;
  branch_name: string | null;
  equipment_name: string | null;
  equipment_location: string | null;
  recorded_by_employee_no: string;
  recorded_by_role: string;
  device_info: string | null;
  template_version: number;
  revision: number;
  amended_at: string | null;
  amended_by_name: string | null;
  amendment_reason: string | null;
  /** Detail only: field definitions (labels / option labels) and whether the form changed since. */
  template_fields?: unknown[];
  template_current_version?: number;
}

const SELECT_RECORD = `
  SELECT r.id, r.template_id, t.code AS template_code, t.title_ar AS template_title_ar,
         r.ccp_id, c.code AS ccp_code, r.department_id, d.code AS department_code,
         r.equipment_id, e.code AS equipment_code, r.recorded_by, u.full_name AS recorded_by_name,
         r.measured_value, r.unit, r.data, r.status, r.deviations, r.product_name, r.batch_no,
         r.notes, r.corrective_action_taken, r.source, r.recorded_at, r.client_ref,
         (SELECT cp.id FROM capas cp WHERE cp.record_id = r.id LIMIT 1) AS capa_id,
         tn.name AS company_name, b.name_ar AS branch_name, e.name AS equipment_name, e.location AS equipment_location,
         u.employee_no AS recorded_by_employee_no, u.role AS recorded_by_role, r.device_info, r.template_version,
         r.revision, r.amended_at, am.full_name AS amended_by_name, r.amendment_reason
    FROM monitoring_records r
    JOIN form_templates t ON t.id = r.template_id
    JOIN departments d ON d.id = r.department_id
    JOIN users u ON u.id = r.recorded_by
    JOIN tenants tn ON tn.id = r.tenant_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN users am ON am.id = r.amended_by
    LEFT JOIN ccps c ON c.id = r.ccp_id
    LEFT JOIN equipment e ON e.id = r.equipment_id`;

export interface RecordFilters {
  departmentId: number;
  status?: 'PASS' | 'FAIL';
  ccpId?: string;
  templateId?: string;
  equipmentId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export async function listRecords(f: RecordFilters) {
  const params: unknown[] = [f.departmentId];
  const where = ['r.department_id = $1'];
  if (f.status) where.push(`r.status = $${params.push(f.status)}`);
  if (f.ccpId) where.push(`r.ccp_id = $${params.push(f.ccpId)}`);
  if (f.templateId) where.push(`r.template_id = $${params.push(f.templateId)}`);
  if (f.equipmentId) where.push(`r.equipment_id = $${params.push(f.equipmentId)}`);
  if (f.from) where.push(`r.recorded_at >= $${params.push(f.from)}`);
  if (f.to) where.push(`r.recorded_at < $${params.push(f.to)}`);

  const [{ rows }, count] = await Promise.all([
    query<MonitoringRecord>(
      `${SELECT_RECORD} WHERE ${where.join(' AND ')} ORDER BY r.recorded_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, f.offset],
    ),
    query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM monitoring_records r WHERE ${where.join(' AND ')}`, params),
  ]);
  return { rows, total: count.rows[0]?.total ?? 0 };
}

export async function findRecordById(id: string) {
  const { rows } = await query<MonitoringRecord>(
    SELECT_RECORD.replace('SELECT r.id,', 'SELECT t.fields AS template_fields, t.version AS template_current_version, r.id,') + ' WHERE r.id = $1',
    [id],
  );
  return rows[0];
}
