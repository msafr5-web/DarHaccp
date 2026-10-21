import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { CHECKLISTS } from '../services/auditChecklists';
import { generateQrToken } from '../services/qr.service';
import { encrypt } from '../utils/crypto';
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

    for (const [code, hazardType] of Object.entries(data.ccpHazardTypes)) {
      await db.query('UPDATE ccps SET hazard_type = $2 WHERE code = $1 AND hazard_type IS DISTINCT FROM $2::hazard_type', [code, hazardType]);
    }

    // Service account that IoT probe readings are recorded under. Inactive: it can never sign in.
    await db.query(
      `INSERT INTO users (employee_no, full_name, email, password_hash, role, is_active)
       VALUES ('SYS-IOT', 'مجسات إنترنت الأشياء (نظام)', 'iot-system@daraldhiafa.sa', $1, 'HACCP_OFFICER', FALSE)
       ON CONFLICT (employee_no) DO NOTHING`,
      [await bcrypt.hash(randomBytes(32).toString('hex'), 12)],
    );

    for (const s of data.staff) {
      await db.query(
        `INSERT INTO staff (employee_no, full_name, nationality, id_number_enc, id_number_last4, job_title, department_id, branch_id, user_id)
         VALUES ($1::varchar, $2, $3, $4, $5, $6, $7, (SELECT id FROM branches WHERE code = 'RUH-CK'),
                 (SELECT id FROM users WHERE employee_no = $1::varchar))
         ON CONFLICT (employee_no) DO UPDATE SET
           nationality = COALESCE(staff.nationality, EXCLUDED.nationality),
           id_number_enc = COALESCE(staff.id_number_enc, EXCLUDED.id_number_enc),
           id_number_last4 = COALESCE(staff.id_number_last4, EXCLUDED.id_number_last4),
           job_title = COALESCE(staff.job_title, EXCLUDED.job_title)`,
        [s.employeeNo, s.fullName, s.nationality, encrypt(s.idNumber), s.idNumber.slice(-4), s.jobTitle, await deptId(s.department)],
      );
    }

    for (const r of data.recipes) {
      await db.query(
        `INSERT INTO recipes (code, name_ar, name_en, department_id, ingredients, allergens, shelf_life_hours, storage_temp_max,
                              storage_instructions, ccp_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
        [r.code, r.nameAr, r.nameEn, await deptId(r.department), JSON.stringify(r.ingredients), r.allergens, r.shelfLifeHours,
          r.storageTempMax, r.storage, r.ccp],
      );
    }

    const { rows: hasContractors } = await db.query('SELECT 1 FROM contractors LIMIT 1');
    if (!hasContractors.length) {
      for (const c of data.contractors) {
        await db.query(
          `INSERT INTO contractors (name, service_type, cr_number, license_no, license_expiry, contract_start, contract_end)
           VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, CURRENT_DATE - 60, CURRENT_DATE + $6::int)`,
          [c.name, c.service, c.cr, c.license, c.licenseDays, c.contractDays],
        );
      }
      await db.query(
        `INSERT INTO contractor_evaluations (contractor_id, evaluated_by, period, scores, total_score, recommendation, notes)
         SELECT c.id, (SELECT id FROM users WHERE employee_no = 'DD-1002'), to_char(now(), 'YYYY') || '-Q3',
                '{"quality":5,"compliance":4,"timeliness":4,"safety":5,"documentation":4}', 88, 'CONTINUE',
                'التزام جيد بجدول الزيارات وتقارير مكتملة'
           FROM contractors c WHERE c.service_type = 'PEST_CONTROL'`,
      );
    }

    for (const d of data.documents) {
      await db.query(
        `INSERT INTO documents (doc_no, title, category, department_id, effective_date, review_date, owner_id)
         VALUES ($1, $2, $3, $4, CURRENT_DATE - 30, CURRENT_DATE + $5::int, (SELECT id FROM users WHERE employee_no = 'DD-1001'))
         ON CONFLICT (doc_no) DO NOTHING`,
        [d.docNo, d.title, d.category, await deptId(d.department), d.reviewDays],
      );
    }

    const { rows: hasAudits } = await db.query('SELECT 1 FROM internal_audits LIMIT 1');
    if (!hasAudits.length) {
      for (const [standard, dept, days] of [['HACCP_ISO22000', 'COLD', 3], ['ISO45001_HSE', 'SUPPORT', 10]] as const) {
        const checklist = CHECKLISTS[standard];
        await db.query(
          `INSERT INTO internal_audits (title, standard, department_id, branch_id, auditor_id, scheduled_date, items, created_by)
           VALUES ($1, $2, $3, (SELECT id FROM branches WHERE code = 'RUH-CK'), (SELECT id FROM users WHERE employee_no = 'DD-1001'),
                   CURRENT_DATE + $4::int, $5, (SELECT id FROM users WHERE employee_no = 'DD-1001'))`,
          [checklist.titleAr, standard, await deptId(dept), days,
            JSON.stringify(checklist.items.map((it) => ({ ...it, compliant: null, note: null })))],
        );
      }
    }

    // Demo health certificates: valid, expiring within 30 days, and expired.
    const certs = [
      ['DD-3001', 'شيف المطبخ الساخن', 'HOT', 'HC-2026-0001', 300],
      ['DD-3002', 'شيف المطبخ البارد', 'COLD', 'HC-2026-0002', 12],
      ['DD-4001', 'عامل الخدمات المساندة', 'SUPPORT', 'HC-2025-0003', -5],
      ['DD-3003', 'شيف الحلويات', 'SWEETS', 'HC-2026-0004', 210],
      ['DD-4002', 'سائق نقل الأغذية', 'SUPPORT', 'HC-2026-0005', 95],
    ] as const;
    for (const [no, name, dept, certNo, days] of certs) {
      await db.query(
        `INSERT INTO health_certificates (employee_no, employee_name, department_id, certificate_no, issue_date, expiry_date,
                                          user_id, staff_id)
         VALUES ($1::varchar, $2, $3, $4, CURRENT_DATE + $5::int - 365, CURRENT_DATE + $5::int,
                 (SELECT id FROM users WHERE employee_no = $1::varchar), (SELECT id FROM staff WHERE employee_no = $1::varchar))
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
