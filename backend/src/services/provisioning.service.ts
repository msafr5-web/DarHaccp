import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import * as data from '../db/seedData';
import { provisionDefaultForms } from './formCatalog.service';

/**
 * Default content every company starts with: main branch, the reference HACCP plan (CCPs with
 * hazard types and critical limits), the default library forms with fresh QR codes, and the IoT service
 * account. Must run inside a transaction scoped to the new tenant; idempotent.
 */
export async function provisionTenantDefaults(db: PoolClient) {
  const deptId = async (code: string | null) =>
    code ? (await db.query<{ id: number }>('SELECT id FROM departments WHERE code = $1', [code])).rows[0]!.id : null;

  await db.query(
    `INSERT INTO branches (code, name_ar, name_en, city)
     SELECT 'MAIN', 'الفرع الرئيسي', 'Main branch', 'Riyadh' WHERE NOT EXISTS (SELECT 1 FROM branches)`,
  );

  for (const c of data.ccps) {
    await db.query(
      `INSERT INTO ccps (code, name_ar, name_en, department_id, hazard, hazard_type, unit, min_value, max_value,
                         monitoring_frequency, corrective_action)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [c.code, c.nameAr, c.nameEn, await deptId(c.department), c.hazard, data.ccpHazardTypes[c.code] ?? 'BIOLOGICAL',
        c.unit, c.min, c.max, c.frequency, c.action],
    );
  }

  // Digital forms: every default form of the platform library, each with its own QR code.
  await provisionDefaultForms(db);

  // Inactive service account that IoT probe readings are recorded under: it can never sign in.
  await db.query(
    `INSERT INTO users (employee_no, full_name, email, password_hash, role, is_active, branch_id)
     VALUES ('SYS-IOT', 'مجسات إنترنت الأشياء (نظام)', 'iot-system@darhaccp.sa', $1, 'HACCP_OFFICER', FALSE,
             (SELECT id FROM branches ORDER BY id LIMIT 1))
     ON CONFLICT (tenant_id, employee_no) DO NOTHING`,
    [await bcrypt.hash(randomBytes(32).toString('hex'), 10)],
  );
}

/** A bcrypt hash of a random secret: the account cannot sign in until a password is set. */
export async function unusablePasswordHash() {
  return bcrypt.hash(randomBytes(32).toString('hex'), 10);
}
