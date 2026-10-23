import { createHash, randomBytes } from 'node:crypto';
import { DbContext, query, runAsSystem, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { emails, sendEmail } from './email.service';
import { createChallenge, OTP_TTL_MINUTES, verifyChallenge } from './otp.service';
import { provisionTenantDefaults, unusablePasswordHash } from './provisioning.service';

export type TenantStatus = 'PENDING_VERIFICATION' | 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export interface Tenant {
  id: number;
  account_no: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  subscription_date: string;
  status: TenantStatus;
  is_platform: boolean;
  email_verified_at: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- company code

/** Digits only, in Saudi local form (05XXXXXXXX) when the number is a Saudi mobile. */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('966') && digits.length === 12) digits = `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('5')) digits = `0${digits}`;
  return digits;
}

/** Subscription date in the company's timezone (Asia/Riyadh) as DDMMYYYY and YYYY-MM-DD. */
export function subscriptionDate(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: env.APP_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { ddmmyyyy: `${parts.day}${parts.month}${parts.year}`, iso: `${parts.year}-${parts.month}-${parts.day}` };
}

/**
 * Company code = first 5 letters of the company name + last 5 digits of the mobile number
 * + subscription date (DDMMYYYY).  e.g. "RuknHacpp", 0566477687, 23-10-2026 → RuknH7768723102026
 * Letters keep their case; spaces, digits and symbols in the name are skipped. Names with fewer
 * than 5 letters are padded with "X".
 */
export function buildCompanyCode(name: string, phone: string, date = new Date()): string {
  const letters = Array.from(name.normalize('NFC')).filter((ch) => /\p{L}/u.test(ch));
  const prefix = letters.slice(0, 5).join('').padEnd(5, 'X');
  const digits = normalizePhone(phone);
  if (digits.length < 5) throw AppError.unprocessable('رقم الجوال غير صالح');
  return `${prefix}${digits.slice(-5)}${subscriptionDate(date).ddmmyyyy}`;
}

// ---------------------------------------------------------------- registration

export interface RegistrationInput {
  name: string;
  phone: string;
  email: string;
  address: string;
}

/** Public sign-up: creates the company as PENDING_VERIFICATION and e-mails a confirmation code. */
export async function registerCompany(input: RegistrationInput, ip?: string) {
  return runAsSystem(async () => {
    const now = new Date();
    const code = buildCompanyCode(input.name, input.phone, now);
    const phone = normalizePhone(input.phone);

    // The subscriber e-mail is unique across the whole platform, whatever the application status.
    const clash = await query<{ code: string; email: string }>(
      `SELECT code, email FROM tenants WHERE LOWER(code) = LOWER($1) OR LOWER(email) = LOWER($2)`,
      [code, input.email],
    );
    if (clash.rows.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      throw AppError.conflict(`رمز الشركة ${code} مسجل مسبقاً — يوجد طلب بنفس الاسم والجوال وتاريخ الاشتراك`);
    }
    const userClash = await query(`SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND employee_no <> 'SYS-IOT'`, [input.email]);
    if (clash.rows.length || userClash.rowCount) {
      throw AppError.conflict('البريد الإلكتروني مسجل مسبقاً في المنصة — كل بريد يُستخدم لحساب واحد فقط');
    }

    const tenant = await withTransaction({ ip }, async (db) => {
      const { rows } = await db.query<Tenant>(
        `INSERT INTO tenants (code, name, phone, email, address, subscription_date, created_ip)
         VALUES ($1, $2, $3, LOWER($4), $5, $6, $7) RETURNING *`,
        [code, input.name, phone, input.email, input.address, subscriptionDate(now).iso, ip ?? null],
      );
      return rows[0]!;
    });

    const otp = await createChallenge({ purpose: 'REGISTRATION', tenantId: tenant.id, email: tenant.email, ip });
    await sendEmail(emails.registrationOtp(tenant.email, tenant.name, otp.code, OTP_TTL_MINUTES));
    return { tenant, challengeId: otp.id };
  });
}

/** Confirms the company e-mail and queues the application for platform review. */
export async function confirmRegistration(challengeId: string, code: string) {
  return runAsSystem(async () => {
    const challenge = await verifyChallenge(challengeId, 'REGISTRATION', code);
    const { rows } = await query<Tenant>(
      `UPDATE tenants SET status = 'PENDING_REVIEW', email_verified_at = now()
        WHERE id = $1 AND status = 'PENDING_VERIFICATION' RETURNING *`,
      [challenge.tenant_id],
    );
    const tenant = rows[0];
    if (!tenant) throw AppError.conflict('تم تأكيد هذا الطلب مسبقاً');

    // Notify platform administrators (best effort: the application is already queued).
    const admins = await query<{ email: string }>(`SELECT email FROM users WHERE role = 'PLATFORM_ADMIN' AND is_active`);
    for (const a of admins.rows) {
      await sendEmail(emails.newRegistration(a.email, tenant)).catch((err) => logger.warn({ err }, 'Registration notice not sent'));
    }
    return tenant;
  });
}

/** The company's personal sign-in link (company pre-selected, e-mail pre-filled). */
export function companyLoginUrl(code: string, email?: string) {
  const base = `${env.APP_URL.replace(/\/+$/, '')}/c/${encodeURIComponent(code)}`;
  return email ? `${base}?email=${encodeURIComponent(email)}` : base;
}

/** Public branding for a company login link: only the name of an ACTIVE company. */
export async function publicCompany(code: string) {
  return runAsSystem(async () => {
    const { rows } = await query<{ name: string; code: string }>(
      `SELECT name, code FROM tenants WHERE LOWER(code) = LOWER($1) AND status = 'ACTIVE' AND NOT is_platform`,
      [code],
    );
    if (!rows[0]) throw AppError.notFound('Company');
    return rows[0];
  });
}

// ---------------------------------------------------------------- password tokens (activation / reset)

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function issuePasswordToken(userId: string, tenantId: number, purpose: 'ACTIVATION' | 'RESET', hours: number) {
  const token = randomBytes(32).toString('base64url');
  await runAsSystem(() =>
    query(
      `INSERT INTO password_tokens (user_id, tenant_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
      [userId, tenantId, purpose, hashToken(token), hours],
    ),
  );
  return `${env.APP_URL.replace(/\/+$/, '')}/activate?token=${token}`;
}

export async function consumePasswordToken(token: string) {
  return runAsSystem(async () => {
    const { rows } = await query<{ id: string; user_id: string; tenant_id: number }>(
      `UPDATE password_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING id, user_id, tenant_id`,
      [hashToken(token)],
    );
    if (!rows[0]) throw new AppError(400, 'TOKEN_INVALID', 'الرابط غير صالح أو منتهي الصلاحية');
    return rows[0];
  });
}

// ---------------------------------------------------------------- platform review

async function loadTenant(id: number) {
  const { rows } = await query<Tenant>('SELECT * FROM tenants WHERE id = $1 AND NOT is_platform', [id]);
  if (!rows[0]) throw AppError.notFound('Company');
  return rows[0];
}

/**
 * Approval: provisions the company's HACCP plan, forms and main branch, creates the company
 * administrator (the registration e-mail) and e-mails the code + an activation link.
 */
export async function approveTenant(ctx: DbContext, id: number, notes?: string) {
  return runAsSystem(async () => {
    const tenant = await loadTenant(id);
    if (tenant.status !== 'PENDING_REVIEW') {
      throw AppError.conflict(tenant.status === 'PENDING_VERIFICATION' ? 'لم تؤكد الشركة بريدها الإلكتروني بعد' : `حالة الطلب الحالية: ${tenant.status}`);
    }

    // Company-scoped transaction: everything created here belongs to the new tenant.
    const adminId = await withTransaction({ ...ctx, tenantId: id, bypass: false }, async (db) => {
      await provisionTenantDefaults(db);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (employee_no, full_name, email, password_hash, role, branch_id)
         VALUES ('ADM-001', $1, LOWER($2), $3, 'ADMIN', (SELECT id FROM branches ORDER BY id LIMIT 1))
         ON CONFLICT (tenant_id, employee_no) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [`مدير حساب ${tenant.name}`, tenant.email, await unusablePasswordHash()],
      );
      return rows[0]!.id;
    });

    const approved = await withTransaction({ ...ctx, bypass: true }, async (db) => {
      const { rows } = await db.query<Tenant>(
        `UPDATE tenants SET status = 'ACTIVE', reviewed_by = $2, reviewed_at = now(), review_notes = $3
          WHERE id = $1 RETURNING *`,
        [id, ctx.userId ?? null, notes ?? null],
      );
      return rows[0]!;
    });

    // Password-less: the administrator signs in with the e-mail (link + code), no activation step.
    void adminId;
    await sendEmail(emails.approved(approved.email, approved, companyLoginUrl(approved.code, approved.email)));
    return approved;
  });
}

export async function setTenantStatus(ctx: DbContext, id: number, action: 'REJECT' | 'SUSPEND' | 'REACTIVATE' | 'REOPEN', reason?: string) {
  return runAsSystem(async () => {
    const tenant = await loadTenant(id);
    const transitions: Record<typeof action, { from: TenantStatus[]; to: TenantStatus }> = {
      REJECT: { from: ['PENDING_VERIFICATION', 'PENDING_REVIEW'], to: 'REJECTED' },
      SUSPEND: { from: ['ACTIVE'], to: 'SUSPENDED' },
      REACTIVATE: { from: ['SUSPENDED'], to: 'ACTIVE' },
      // A rejected application is reviewed again instead of re-registering the same e-mail.
      REOPEN: { from: ['REJECTED'], to: 'PENDING_REVIEW' },
    };
    const t = transitions[action];
    if (!t.from.includes(tenant.status)) throw AppError.conflict(`لا يمكن تنفيذ الإجراء على حالة ${tenant.status}`);
    if ((action === 'REJECT' || action === 'SUSPEND') && !reason?.trim()) throw AppError.unprocessable('السبب مطلوب');
    if (action === 'REOPEN' && !tenant.email_verified_at) throw AppError.conflict('لم تؤكد الشركة بريدها الإلكتروني');

    const updated = await withTransaction({ ...ctx, bypass: true }, async (db) => {
      const { rows } = await db.query<Tenant>(
        `UPDATE tenants SET status = $2, reviewed_by = $3, reviewed_at = now(), review_notes = COALESCE($4, review_notes)
          WHERE id = $1 RETURNING *`,
        [id, t.to, ctx.userId ?? null, reason ?? null],
      );
      return rows[0]!;
    });

    const mail = action === 'REJECT' ? emails.rejected(updated.email, updated.name, reason!) : action === 'SUSPEND' ? emails.suspended(updated.email, updated.name, reason!) : null;
    if (mail) await sendEmail(mail).catch((err) => logger.warn({ err }, 'Status e-mail not sent'));
    return updated;
  });
}

export interface TenantDetailsUpdate {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

/**
 * Platform administrator corrects a company's details. The company code is NOT regenerated:
 * it identifies the company since subscription and is embedded in the login link already sent.
 * Changing the official e-mail also moves the company administrator's sign-in e-mail (so the
 * company keeps access), after checking it is not used anywhere on the platform; both the old
 * and the new address are notified. Every change is kept in the audit trail.
 */
export async function updateTenantDetails(ctx: DbContext, id: number, patch: TenantDetailsUpdate) {
  return runAsSystem(async () => {
    const tenant = await loadTenant(id);
    const email = patch.email?.trim().toLowerCase();
    const emailChanged = !!email && email !== tenant.email.toLowerCase();
    const phone = patch.phone ? normalizePhone(patch.phone) : undefined;

    // Sign-in account that carries the company e-mail (the company administrator).
    const { rows: admins } = await query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND employee_no <> 'SYS-IOT'`,
      [id, tenant.email],
    );
    const adminId = admins[0]?.id ?? null;

    if (emailChanged) {
      const clash = await query(
        `SELECT 1 FROM tenants WHERE LOWER(email) = $1 AND id <> $2
         UNION ALL
         SELECT 1 FROM users WHERE LOWER(email) = $1 AND employee_no <> 'SYS-IOT' AND id IS DISTINCT FROM $3::uuid`,
        [email, id, adminId],
      );
      if (clash.rowCount) throw AppError.conflict('البريد الإلكتروني مستخدم مسبقاً في المنصة — كل بريد لحساب واحد فقط');
    }

    const updated = await withTransaction({ ...ctx, bypass: true }, async (db) => {
      const { rows } = await db.query<Tenant>(
        `UPDATE tenants SET name = COALESCE($2, name), phone = COALESCE($3, phone), email = COALESCE($4, email),
                address = COALESCE($5, address)
          WHERE id = $1 RETURNING *`,
        [id, patch.name?.trim() || null, phone ?? null, email ?? null, patch.address?.trim() || null],
      );
      if (emailChanged && adminId) {
        await db.query('UPDATE users SET email = $2 WHERE id = $1', [adminId, email]);
      }
      return rows[0]!;
    });

    if (emailChanged) {
      const notice = (to: string) =>
        sendEmail(emails.emailChanged(to, updated.name, tenant.email, updated.email, companyLoginUrl(updated.code, updated.email)))
          .catch((err) => logger.warn({ err }, 'E-mail change notice not sent'));
      await notice(tenant.email);
      await notice(updated.email);
    }
    return updated;
  });
}

/** Re-sends the approval e-mail with the company's login link. */
export async function resendActivation(id: number) {
  return runAsSystem(async () => {
    const tenant = await loadTenant(id);
    if (tenant.status !== 'ACTIVE') throw AppError.conflict('الحساب غير نشط');
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'ADMIN' AND is_active ORDER BY created_at LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw AppError.notFound('Company administrator');
    await sendEmail(emails.approved(tenant.email, tenant, companyLoginUrl(tenant.code, tenant.email)));
  });
}
