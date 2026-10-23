import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { CHECKLISTS } from '../services/auditChecklists';
import type { FormField } from '../models/haccp.model';
import { provisionCategory, syncCatalogSeed, upgradeBuiltinForms } from '../services/formCatalog.service';
import { provisionTenantDefaults } from '../services/provisioning.service';
import { generateQrToken } from '../services/qr.service';
import { encrypt } from '../utils/crypto';
import * as data from './seedData';

/** The first customer company (pre-SaaS data) and its demo accounts. */
const DEMO_TENANT_ID = 2;

/**
 * Idempotent seed, run as the API runtime role (Row-Level Security applies):
 *  1. reference data + the platform (SaaS operator) administrator,
 *  2. the demo company with its HACCP plan, forms and demo accounts — all scoped to that company.
 * Demo accounts share SEED_ADMIN_PASSWORD — change them!
 */
async function seed() {
  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12);

  await withTransaction({ bypass: true }, async (db) => {
    for (const d of data.departments) {
      await db.query(
        `INSERT INTO departments (code, name_ar, name_en) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [d.code, d.nameAr, d.nameEn],
      );
    }
    await db.query(
      `INSERT INTO tenants (id, code, name, phone, email, address, subscription_date, status, email_verified_at, reviewed_at, review_notes)
       VALUES ($1, 'DarAl0000020102026', 'Dar Al Dhiafa — دار الضيافة', '0500000000', LOWER($2), 'الرياض، المملكة العربية السعودية',
               DATE '2026-10-20', 'ACTIVE', now(), now(), 'حساب تجريبي')
       ON CONFLICT (id) DO NOTHING`,
      [DEMO_TENANT_ID, env.SEED_ADMIN_EMAIL],
    );
    await db.query(`SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT max(id) FROM tenants), 2))`);
    // Platform form library (new forms only — edits made by the platform administrator are kept).
    await syncCatalogSeed(db);
  });

  // SaaS operator: reviews and approves companies (lives in the platform tenant #1).
  // It has its own password — never the shared demo password.
  if (env.PLATFORM_ADMIN_PASSWORD) {
    const platformHash = await bcrypt.hash(env.PLATFORM_ADMIN_PASSWORD, 12);
    await withTransaction({ tenantId: 1 }, (db) =>
      db.query(
        `INSERT INTO users (employee_no, full_name, email, password_hash, role)
         VALUES ('PLT-001', 'مدير منصة DarHaccp', LOWER($1), $2, 'PLATFORM_ADMIN')
         ON CONFLICT (tenant_id, employee_no) DO NOTHING`,
        [env.PLATFORM_ADMIN_EMAIL, platformHash],
      ),
    );
  } else {
    logger.warn('PLATFORM_ADMIN_PASSWORD not set — platform administrator not created');
  }

  await withTransaction({ tenantId: DEMO_TENANT_ID }, async (db) => {
    const deptId = async (code: string | null) =>
      code ? (await db.query<{ id: number }>('SELECT id FROM departments WHERE code = $1', [code])).rows[0]!.id : null;

    await provisionTenantDefaults(db);
    // The demo company also gets the PRD warehouse / GDP forms, with a demo approved-supplier list.
    await provisionCategory(db, 'WMS_GDP');
    const { rows: inbound } = await db.query<{ id: string; fields: FormField[] }>(
      `SELECT id, fields FROM form_templates WHERE code = 'INBOUND_SHIPMENT'`,
    );
    if (inbound[0]?.fields.some((f) => f.companyOptions && !f.options?.length)) {
      const fields = inbound[0].fields.map((f) => (f.companyOptions && !f.options?.length ? { ...f, options: data.demoSuppliers } : f));
      await db.query('UPDATE form_templates SET fields = $2 WHERE id = $1', [inbound[0].id, JSON.stringify(fields)]);
    }
    for (const [code, hazardType] of Object.entries(data.ccpHazardTypes)) {
      await db.query('UPDATE ccps SET hazard_type = $2 WHERE code = $1 AND hazard_type IS DISTINCT FROM $2::hazard_type', [code, hazardType]);
    }

    await db.query(
      `INSERT INTO users (employee_no, full_name, email, password_hash, role, branch_id)
       VALUES ('DD-0001', 'مدير النظام', LOWER($1), $2, 'ADMIN', (SELECT id FROM branches ORDER BY id LIMIT 1))
       ON CONFLICT (tenant_id, employee_no) DO NOTHING`,
      [env.SEED_ADMIN_EMAIL, passwordHash],
    );
    for (const it of data.demoItems) {
      await db.query(
        `INSERT INTO items (code, name_ar, category, storage_condition, unit) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, (UPPER(code))) DO NOTHING`,
        [it.code, it.nameAr, it.category, it.storage, it.unit],
      );
    }

    for (const u of data.users) {
      await db.query(
        `INSERT INTO users (employee_no, full_name, email, password_hash, role, department_id, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM branches ORDER BY id LIMIT 1)) ON CONFLICT (tenant_id, employee_no) DO NOTHING`,
        [u.employeeNo, u.fullName, u.email, passwordHash, u.role, await deptId(u.department)],
      );
    }

    for (const e of data.equipment) {
      await db.query(
        `INSERT INTO equipment (code, name, type, department_id, location, form_template_id, qr_token,
                                maintenance_interval_days, last_maintenance_date, next_maintenance_date)
         VALUES ($1, $2, $3, $4, $5, (SELECT id FROM form_templates WHERE code = $6), $7, $8,
                 CURRENT_DATE - 60, CURRENT_DATE - 60 + $8::int)
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [e.code, e.name, e.type, await deptId(e.department), e.location, e.template, generateQrToken(), e.interval],
      );
    }

    for (const s of data.staff) {
      await db.query(
        `INSERT INTO staff (employee_no, full_name, nationality, id_number_enc, id_number_last4, job_title, department_id, branch_id, user_id)
         VALUES ($1::varchar, $2, $3, $4, $5, $6, $7, (SELECT id FROM branches ORDER BY id LIMIT 1),
                 (SELECT id FROM users WHERE employee_no = $1::varchar))
         ON CONFLICT (tenant_id, employee_no) DO UPDATE SET
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
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, code) DO NOTHING`,
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
         ON CONFLICT (tenant_id, doc_no) DO NOTHING`,
        [d.docNo, d.title, d.category, await deptId(d.department), d.reviewDays],
      );
    }

    const { rows: hasAudits } = await db.query('SELECT 1 FROM internal_audits LIMIT 1');
    if (!hasAudits.length) {
      for (const [standard, dept, days] of [['HACCP_ISO22000', 'COLD', 3], ['ISO45001_HSE', 'SUPPORT', 10]] as const) {
        const checklist = CHECKLISTS[standard];
        await db.query(
          `INSERT INTO internal_audits (title, standard, department_id, branch_id, auditor_id, scheduled_date, items, created_by)
           VALUES ($1, $2, $3, (SELECT id FROM branches ORDER BY id LIMIT 1), (SELECT id FROM users WHERE employee_no = 'DD-1001'),
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
         ON CONFLICT (tenant_id, certificate_no) DO NOTHING`,
        [no, name, await deptId(dept), certNo, days],
      );
    }
  });

  // Built-in library forms changed in code (new revision): upgrade them and the companies that follow them.
  const upgrades = await upgradeBuiltinForms({ userAgent: 'seed' });
  if (upgrades.length) logger.info({ upgrades }, 'Built-in library forms upgraded');

  logger.info(`Seed complete. Admin: ${env.SEED_ADMIN_EMAIL} (password from SEED_ADMIN_PASSWORD)`);
}

seed()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.fatal({ err }, 'Seed failed');
    await pool.end();
    process.exit(1);
  });
