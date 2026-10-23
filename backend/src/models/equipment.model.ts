import { db as scopedDb, query, Queryable } from '../config/database';

export type EquipmentStatus = 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'OUT_OF_SERVICE';

export interface Equipment {
  id: string;
  code: string;
  name: string;
  type: string;
  department_id: number;
  department_code: string;
  location: string | null;
  status: EquipmentStatus;
  form_template_id: string | null;
  qr_token: string;
  maintenance_interval_days: number;
  last_maintenance_date: string | null;
  next_maintenance_date: string | null;
  is_active: boolean;
  tenant_id: number;
}

const SELECT_EQUIPMENT = `SELECT e.*, d.code AS department_code FROM equipment e JOIN departments d ON d.id = e.department_id`;

export async function listEquipment(f: { departmentId?: number | null; status?: EquipmentStatus; type?: string }) {
  const params: unknown[] = [];
  const where = ['e.is_active'];
  if (f.departmentId) where.push(`e.department_id = $${params.push(f.departmentId)}`);
  if (f.status) where.push(`e.status = $${params.push(f.status)}`);
  if (f.type) where.push(`e.type = $${params.push(f.type)}`);
  const { rows } = await query<Equipment>(`${SELECT_EQUIPMENT} WHERE ${where.join(' AND ')} ORDER BY e.code`, params);
  return rows;
}

export async function findEquipment(by: { id?: string; qrToken?: string }, db: Queryable = scopedDb) {
  const [column, value] = by.id ? ['e.id', by.id] : ['e.qr_token', by.qrToken];
  const { rows } = await db.query<Equipment>(`${SELECT_EQUIPMENT} WHERE ${column} = $1`, [value]);
  return rows[0];
}
