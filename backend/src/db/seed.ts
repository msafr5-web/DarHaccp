import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { generateQrToken } from '../services/qr.service';
import * as data from './seedData';

/** Idempotent seed: reference data + demo accounts (all share the admin password — change them!). */
async function seed() {
  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12);

  await withTransaction(null, async (db) => {
    for (const d of data.departments) {
      await db.query(
        `INSERT INTO departments (code, name_ar, name_en) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [d.code, d.nameAr, d.nameEn],
      );
    }
    const deptId = async (code: string | null) =>
      code ? (await db.query<{ id: number }>('SELECT id FROM departments WHERE code = $1', [code])).rows[0]!.id : null;

    await db.query(
      `INSERT INTO users (employee_no, full_name, email, password_hash, role)
       VALUES ('DD-0001', 'مدير النظام', LOWER($1), $2, 'ADMIN') ON CONFLICT (employee_no) DO NOTHING`,
      [env.SEED_ADMIN_EMAIL, passwordHash],
    );
    for (const u of data.users) {
      await db.query(
        `INSERT INTO users (employee_no, full_name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (employee_no) DO NOTHING`,
        [u.employeeNo, u.fullName, u.email, passwordHash, u.role, await deptId(u.department)],
      );
    }

    for (const c of data.ccps) {
      await db.query(
        `INSERT INTO ccps (code, name_ar, name_en, department_id, hazard, unit, min_value, max_value, monitoring_frequency, corrective_action)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.nameAr, c.nameEn, await deptId(c.department), c.hazard, c.unit, c.min, c.max, c.frequency, c.action],
      );
    }

    for (const t of data.templates) {
      await db.query(
        `INSERT INTO form_templates (code, title_ar, title_en, department_id, ccp_id, fields, qr_token)
         VALUES ($1, $2, $3, $4, (SELECT id FROM ccps WHERE code = $5), $6, $7) ON CONFLICT (code) DO NOTHING`,
        [t.code, t.titleAr, t.titleEn, await deptId(t.department), t.ccp, JSON.stringify(t.fields), generateQrToken()],
      );
    }

    for (const e of data.equipment) {
      await db.query(
        `INSERT INTO equipment (code, name, type, department_id, location, form_template_id, qr_token,
                                maintenance_interval_days, last_maintenance_date, next_maintenance_date)
         VALUES ($1, $2, $3, $4, $5, (SELECT id FROM form_templates WHERE code = $6), $7, $8,
                 CURRENT_DATE - 60, CURRENT_DATE - 60 + $8::int)
         ON CONFLICT (code) DO NOTHING`,
        [e.code, e.name, e.type, await deptId(e.department), e.location, e.template, generateQrToken(), e.interval],
      );
    }

    // Demo health certificates: one valid, one expiring within 30 days, one expired.
    const certs = [
      ['DD-3001', 'شيف المطبخ الساخن', 'HOT', 'HC-2026-0001', 300],
      ['DD-3002', 'شيف المطبخ البارد', 'COLD', 'HC-2026-0002', 12],
      ['DD-4001', 'عامل الخدمات المساندة', 'SUPPORT', 'HC-2025-0003', -5],
    ] as const;
    for (const [no, name, dept, certNo, days] of certs) {
      await db.query(
        `INSERT INTO health_certificates (employee_no, employee_name, department_id, certificate_no, issue_date, expiry_date,
                                          user_id)
         VALUES ($1::varchar, $2, $3, $4, CURRENT_DATE + $5::int - 365, CURRENT_DATE + $5::int,
                 (SELECT id FROM users WHERE employee_no = $1::varchar))
         ON CONFLICT (certificate_no) DO NOTHING`,
        [no, name, await deptId(dept), certNo, days],
      );
    }
  });

  logger.info(`Seed complete. Admin: ${env.SEED_ADMIN_EMAIL} (password from SEED_ADMIN_PASSWORD)`);
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.fatal({ err }, 'Seed failed');
    await pool.end();
    process.exit(1);
  });
