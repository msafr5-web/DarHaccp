import { DbContext, query, runAsSystem, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { emails, sendEmail } from './email.service';
import { unusablePasswordHash } from './provisioning.service';

/** Platform administrators live in the platform company (tenant #1) and sign in like everyone else: e-mail → link + code. */
const PLATFORM_TENANT_ID = 1;

export interface PlatformAdmin {
  id: string;
  employee_no: string;
  full_name: string;
  email: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export const listPlatformAdmins = () =>
  runAsSystem(async () => {
    const { rows } = await query<PlatformAdmin>(
      `SELECT id, employee_no, full_name, email, is_active, last_login_at, created_at
         FROM users WHERE role = 'PLATFORM_ADMIN' AND employee_no <> 'SYS-IOT' ORDER BY employee_no`,
    );
    return rows;
  });

/**
 * Adds a platform administrator (full platform permissions). The e-mail must not be used anywhere on the platform —
 * neither by a user nor by a company — and receives a notice with the console link. No password is created.
 */
export async function addPlatformAdmin(ctx: DbContext, input: { fullName: string; email: string }, addedBy: string, notify = true) {
  const email = input.email.trim().toLowerCase();
  const clash = await runAsSystem(() => query(
    `SELECT 1 FROM users WHERE LOWER(email) = $1 AND employee_no <> 'SYS-IOT'
     UNION ALL SELECT 1 FROM tenants WHERE LOWER(email) = $1 AND status <> 'REJECTED'`,
    [email],
  ));
  if (clash.rowCount) throw AppError.conflict('هذا البريد مستخدم مسبقاً في المنصة — كل بريد لحساب واحد فقط');

  const hash = await unusablePasswordHash();
  const admin = await withTransaction({ ...ctx, tenantId: PLATFORM_TENANT_ID, bypass: true }, async (db) => {
    const { rows } = await db.query<PlatformAdmin>(
      `INSERT INTO users (employee_no, full_name, email, password_hash, role)
       VALUES ('PLT-' || lpad((SELECT COALESCE(MAX(substring(employee_no FROM 5)::int), 0) + 1 FROM users
                                WHERE tenant_id = $4 AND employee_no ~ '^PLT-[0-9]+$')::text, 3, '0'), $1, $2, $3, 'PLATFORM_ADMIN')
       RETURNING id, employee_no, full_name, email, is_active, last_login_at, created_at`,
      [input.fullName.trim(), email, hash, PLATFORM_TENANT_ID],
    );
    return rows[0]!;
  }).catch((err) => {
    if ((err as { code?: string }).code === '23505') throw AppError.conflict('تعذّر الإضافة (بريد أو رقم موظف مكرر) — أعد المحاولة');
    throw err;
  });

  if (!notify) return admin;
  await sendEmail(emails.platformAdminAdded(admin.email, admin.full_name, addedBy, `${env.APP_URL.replace(/\/+$/, '')}/admin`))
    .catch((err) => logger.warn({ err }, 'Platform admin notice not sent'));
  return admin;
}

/**
 * Creates the administrators listed in PLATFORM_ADMIN_EMAILS (a private deployment setting, so the addresses never
 * appear in the public repository). Idempotent: an address that already exists — as an administrator (even suspended)
 * or as any other account — is left untouched and reported, never modified or re-activated.
 */
export async function ensurePlatformAdmins(raw: string | undefined) {
  const report: { email: string; result: 'created' | 'exists' | 'invalid' }[] = [];
  for (const item of (raw ?? '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) { report.push({ email: item, result: 'invalid' }); continue; }
    try {
      await addPlatformAdmin({ userAgent: 'deploy' }, { fullName: `مدير المنصة (${item.split('@')[0]!.replace(/\+.*/, '')})`, email: item }, 'النظام', false);
      report.push({ email: item, result: 'created' });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      report.push({ email: item, result: 'exists' });
    }
  }
  return report;
}

/** Suspends / restores a platform administrator. You cannot suspend yourself, and the last active administrator stays. */
export async function setPlatformAdminActive(ctx: DbContext, id: string, isActive: boolean) {
  if (!isActive && id === ctx.userId) throw AppError.conflict('لا يمكنك إيقاف حسابك أنت');
  return withTransaction({ ...ctx, tenantId: PLATFORM_TENANT_ID, bypass: true }, async (db) => {
    const { rows } = await db.query<PlatformAdmin>(
      `SELECT id, employee_no, full_name, email, is_active, last_login_at, created_at
         FROM users WHERE id = $1 AND role = 'PLATFORM_ADMIN' FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw AppError.notFound('Platform administrator');
    if (!isActive) {
      const { rows: others } = await db.query(
        `SELECT 1 FROM users WHERE role = 'PLATFORM_ADMIN' AND is_active AND id <> $1 AND employee_no <> 'SYS-IOT'`, [id],
      );
      if (!others.length) throw AppError.conflict('يجب أن يبقى مدير منصة واحد نشط على الأقل');
    }
    const upd = await db.query<PlatformAdmin>(
      `UPDATE users SET is_active = $2, push_token = CASE WHEN $2 THEN push_token ELSE NULL END WHERE id = $1
       RETURNING id, employee_no, full_name, email, is_active, last_login_at, created_at`,
      [id, isActive],
    );
    return upd.rows[0]!;
  });
}
