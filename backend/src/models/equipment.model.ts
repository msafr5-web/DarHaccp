import { db as scopedDb, query, Queryable } from '../config/database';
import { env } from '../config/env';

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
  created_at: string;
  // Linked monitoring form and today's activity (management screens).
  form_code: string | null;
  form_title_ar: string | null;
  min_daily_entries: number;
  readings_today: number;
  last_reading_at: string | null;
  days_to_maintenance: number | null;
  /** A smart probe key was issued (the key itself is never returned). */
  has_device_key: boolean;
}

// Timezone name inlined in SQL: restricted to the IANA character set.
const TZ = env.APP_TIMEZONE.replace(/[^A-Za-z0-9_/+-]/g, "");

// Explicit columns: the device key hash never leaves the database.
const SELECT_EQUIPMENT = `
  SELECT e.id, e.code, e.name, e.type, e.department_id, d.code AS department_code, e.location, e.status,
         e.form_template_id, e.qr_token, e.maintenance_interval_days, e.last_maintenance_date, e.next_maintenance_date,
         e.is_active, e.tenant_id, e.created_at,
         t.code AS form_code, t.title_ar AS form_title_ar, COALESCE(t.min_daily_entries, 0) AS min_daily_entries,
         (SELECT COUNT(*)::int FROM monitoring_records r
           WHERE r.equipment_id = e.id AND (r.recorded_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date) AS readings_today,
         (SELECT max(r.recorded_at) FROM monitoring_records r WHERE r.equipment_id = e.id) AS last_reading_at,
         (e.next_maintenance_date - (now() AT TIME ZONE '${TZ}')::date) AS days_to_maintenance,
         (e.device_key_hash IS NOT NULL) AS has_device_key
    FROM equipment e
    JOIN departments d ON d.id = e.department_id
    LEFT JOIN form_templates t ON t.id = e.form_template_id`;

export async function listEquipment(f: { departmentId?: number | null; status?: EquipmentStatus; type?: string; search?: string }) {
  const params: unknown[] = [];
  const where = ['e.is_active'];
  if (f.departmentId) where.push(`e.department_id = $${params.push(f.departmentId)}`);
  if (f.status) where.push(`e.status = $${params.push(f.status)}`);
  if (f.type) where.push(`e.type = $${params.push(f.type)}`);
  if (f.search) {
    const p = params.push(`%${f.search}%`);
    where.push(`(e.code ILIKE $${p} OR e.name ILIKE $${p} OR e.location ILIKE $${p})`);
  }
  const { rows } = await query<Equipment>(`${SELECT_EQUIPMENT} WHERE ${where.join(' AND ')} ORDER BY e.code`, params);
  return rows;
}

export async function findEquipment(by: { id?: string; qrToken?: string }, db: Queryable = scopedDb) {
  const [column, value] = by.id ? ['e.id', by.id] : ['e.qr_token', by.qrToken];
  const { rows } = await db.query<Equipment>(`${SELECT_EQUIPMENT} WHERE ${column} = $1`, [value]);
  return rows[0];
}

export async function listMaintenance(equipmentId: string) {
  const { rows } = await query(
    `SELECT m.id, m.type, m.description, m.vendor, m.performed_at, m.next_due_date, m.created_at, u.full_name AS performed_by_name
       FROM maintenance_logs m JOIN users u ON u.id = m.performed_by
      WHERE m.equipment_id = $1 ORDER BY m.performed_at DESC, m.created_at DESC LIMIT 100`,
    [equipmentId],
  );
  return rows;
}
