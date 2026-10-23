import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, runAsSystem, runInTenant, withTransaction } from '../config/database';
import { signAccessToken } from '../middlewares/auth';
import { insertAuditEvent } from '../models/audit.model';
import { findUserById, findUserForLogin } from '../models/user.model';
import { emails, sendEmail } from '../services/email.service';
import { createChallenge, maskEmail, OTP_TTL_MINUTES, resendChallenge, verifyChallenge } from '../services/otp.service';
import { companyLoginUrl, consumePasswordToken, issuePasswordToken } from '../services/tenant.service';
import { AppError } from '../utils/AppError';
import { dbContext, ok, requireUser } from '../utils/http';
import { uuid } from '../utils/schemas';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Used when the e-mail is unknown so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation', 12);

export const passwordPolicy = z
  .string()
  .min(10, 'كلمة المرور 10 أحرف على الأقل')
  .max(128)
  .regex(/[A-Z]/, 'كلمة المرور تحتاج حرفاً كبيراً (A-Z)')
  .regex(/[a-z]/, 'كلمة المرور تحتاج حرفاً صغيراً (a-z)')
  .regex(/\d/, 'كلمة المرور تحتاج رقماً');

/** Optional: the e-mail alone identifies the account (it is unique on the whole platform). */
const companyCode = z.string().trim().min(4).max(60).optional();

export const loginSchema = z.object({
  companyCode,
  email: z.email().max(255),
  password: z.string().min(1).max(128),
});
export const verifyOtpSchema = z.object({ challengeId: uuid, code: z.string().trim().regex(/^\d{6}$/, 'الرمز 6 أرقام') });
export const resendOtpSchema = z.object({ challengeId: uuid });
export const activateSchema = z.object({ token: z.string().min(20).max(200), password: passwordPolicy });
export const forgotPasswordSchema = z.object({ companyCode, email: z.email().max(255) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordPolicy });
export const pushTokenSchema = z.object({
  pushToken: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/, 'Invalid Expo push token').nullable(),
});

interface AttemptInfo {
  tenantId?: number | null;
  userId?: string | null;
  companyCode?: string;
  email?: string;
  stage: 'PASSWORD' | 'OTP' | 'OTP_RESEND';
  success: boolean;
  reason?: string;
}

/** Every attempt — successful or not — is written to the append-only login_attempts table. */
function recordAttempt(req: Request, a: AttemptInfo) {
  return runAsSystem(() =>
    query(
      `INSERT INTO login_attempts (tenant_id, user_id, company_code, email, stage, success, failure_reason, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [a.tenantId ?? null, a.userId ?? null, a.companyCode?.slice(0, 60) ?? null, a.email?.slice(0, 255) ?? null, a.stage,
        a.success, a.reason ?? null, req.ip ?? null, req.get('user-agent')?.slice(0, 300) ?? null],
    ),
  );
}

const TENANT_STATUS_MESSAGES: Record<string, string> = {
  PENDING_VERIFICATION: 'لم يتم تأكيد بريد الشركة بعد — أكمل خطوة التأكيد من رسالة التسجيل',
  PENDING_REVIEW: 'طلب اشتراك شركتكم قيد المراجعة من إدارة المنصة، ستصلكم رسالة عند الموافقة',
  SUSPENDED: 'حساب الشركة موقوف — تواصل مع إدارة المنصة',
};

/**
 * Step 1 — company code + e-mail + password. On success no session is created yet:
 * a 6-digit code is e-mailed and must be confirmed with /auth/verify-otp.
 */
export async function login(req: Request, res: Response) {
  const { companyCode: code, email, password } = req.valid.body as z.infer<typeof loginSchema>;

  const result = await runAsSystem(async () => {
    // Company from the code (company login link) or, without a code, from the e-mail itself.
    const { rows: tenants } = code
      ? await query<{ id: number; status: string; name: string }>(
          `SELECT id, status, name FROM tenants WHERE LOWER(code) = LOWER($1) ORDER BY id DESC LIMIT 1`,
          [code],
        )
      : await query<{ id: number; status: string; name: string }>(
          `SELECT t.id, t.status, t.name FROM users u JOIN tenants t ON t.id = u.tenant_id
            WHERE LOWER(u.email) = LOWER($1) AND u.employee_no <> 'SYS-IOT'
           UNION ALL
           SELECT t.id, t.status, t.name FROM tenants t
            WHERE LOWER(t.email) = LOWER($1) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id)
           LIMIT 1`,
          [email],
        );
    const tenant = tenants[0];
    const fail = async (reason: string, userId?: string) => {
      await recordAttempt(req, { tenantId: tenant?.id, userId, companyCode: code, email, stage: 'PASSWORD', success: false, reason });
    };

    if (tenant && TENANT_STATUS_MESSAGES[tenant.status]) {
      await fail(`TENANT_${tenant.status}`);
      throw new AppError(403, `TENANT_${tenant.status}`, TENANT_STATUS_MESSAGES[tenant.status]!);
    }

    const user = tenant ? await findUserForLogin(tenant.id, email) : undefined;
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      await fail('ACCOUNT_LOCKED', user.id);
      throw new AppError(423, 'ACCOUNT_LOCKED', `تم قفل الحساب مؤقتاً بسبب محاولات فاشلة، حاول بعد ${LOCK_MINUTES} دقيقة`);
    }

    const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!tenant || !user || !valid || !user.is_active) {
      if (user) {
        await query(
          `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
                  locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) END
            WHERE id = $1`,
          [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
        );
      }
      await fail(!tenant ? 'UNKNOWN_COMPANY' : !user ? 'UNKNOWN_USER' : !user.is_active ? 'USER_INACTIVE' : 'WRONG_PASSWORD', user?.id);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'رمز الشركة أو البريد أو كلمة المرور غير صحيحة');
    }

    const otp = await createChallenge({ purpose: 'LOGIN', tenantId: tenant.id, userId: user.id, email: user.email, ip: req.ip });
    await sendEmail(emails.loginOtp(user.email, user.full_name, otp.code, OTP_TTL_MINUTES));
    await recordAttempt(req, { tenantId: tenant.id, userId: user.id, companyCode: code, email, stage: 'PASSWORD', success: true });
    return { challengeId: otp.id, email: maskEmail(user.email), expiresInSeconds: OTP_TTL_MINUTES * 60 };
  });

  return ok(res, { otpRequired: true, ...result });
}

/** Step 2 — the e-mailed code. Issues the session token. */
export async function verifyOtp(req: Request, res: Response) {
  const { challengeId, code } = req.valid.body as z.infer<typeof verifyOtpSchema>;

  const challenge = await runAsSystem(async () => {
    const { rows } = await query<{ tenant_id: number; user_id: string | null; email: string }>(
      `SELECT tenant_id, user_id, email FROM otp_challenges WHERE id = $1`,
      [challengeId],
    );
    try {
      return await verifyChallenge(challengeId, 'LOGIN', code);
    } catch (err) {
      await recordAttempt(req, { tenantId: rows[0]?.tenant_id, userId: rows[0]?.user_id, email: rows[0]?.email, stage: 'OTP', success: false,
        reason: err instanceof AppError ? err.code : 'ERROR' });
      throw err;
    }
  });

  return runInTenant(challenge.tenant_id, async () => {
    const user = challenge.user_id ? await findUserById(challenge.user_id) : undefined;
    if (!user || !user.is_active) throw AppError.unauthorized('الحساب غير نشط');
    await query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
    await recordAttempt(req, { tenantId: challenge.tenant_id, userId: user.id, email: user.email, stage: 'OTP', success: true });
    await insertAuditEvent({ userId: user.id, action: 'LOGIN', entity: 'auth', entityId: user.id, ip: req.ip,
      userAgent: req.get('user-agent'), requestId: req.requestId });
    const { rows: t } = await query<{ id: number; account_no: string; code: string; name: string }>(
      'SELECT id, account_no, code, name FROM tenants WHERE id = $1',
      [challenge.tenant_id],
    );
    return ok(res, { token: signAccessToken(user.id, user.role, challenge.tenant_id), user, tenant: t[0] });
  });
}

export async function resendOtp(req: Request, res: Response) {
  const { challengeId } = req.valid.body as z.infer<typeof resendOtpSchema>;
  const result = await runAsSystem(async () => {
    let resent: Awaited<ReturnType<typeof resendChallenge>>;
    try {
      resent = await resendChallenge(challengeId, 'LOGIN');
    } catch (err) {
      // Refused resends (cool-down, limits) are attempts too.
      const { rows } = await query<{ tenant_id: number; user_id: string | null; email: string }>(
        'SELECT tenant_id, user_id, email FROM otp_challenges WHERE id = $1',
        [challengeId],
      );
      await recordAttempt(req, { tenantId: rows[0]?.tenant_id, userId: rows[0]?.user_id, email: rows[0]?.email, stage: 'OTP_RESEND',
        success: false, reason: err instanceof AppError ? err.code : 'ERROR' });
      throw err;
    }
    const { challenge, code } = resent;
    const { rows } = await query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [challenge.user_id]);
    await sendEmail(emails.loginOtp(challenge.email, rows[0]?.full_name ?? '', code, OTP_TTL_MINUTES));
    await recordAttempt(req, { tenantId: challenge.tenant_id, userId: challenge.user_id, email: challenge.email, stage: 'OTP_RESEND', success: true });
    return { email: maskEmail(challenge.email), expiresInSeconds: OTP_TTL_MINUTES * 60 };
  });
  return ok(res, result);
}

/** Sets the password from an activation (new company admin) or reset link. */
export async function activate(req: Request, res: Response) {
  const { token, password } = req.valid.body as z.infer<typeof activateSchema>;
  const t = await consumePasswordToken(token);
  const hash = await bcrypt.hash(password, 12);
  await withTransaction({ ...dbContext(req), userId: t.user_id, tenantId: t.tenant_id }, (db) =>
    db.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [t.user_id, hash],
    ),
  );
  const { rows } = await runAsSystem(() =>
    query<{ code: string; email: string }>(
      'SELECT t.code, u.email FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE t.id = $1 AND u.id = $2',
      [t.tenant_id, t.user_id],
    ),
  );
  return ok(res, { companyCode: rows[0]?.code, email: rows[0]?.email });
}

/** Always answers the same way so it cannot be used to discover accounts. */
export async function forgotPassword(req: Request, res: Response) {
  const { companyCode: code, email } = req.valid.body as z.infer<typeof forgotPasswordSchema>;
  await runAsSystem(async () => {
    const { rows } = await query<{ id: string; tenant_id: number; full_name: string; email: string }>(
      `SELECT u.id, u.tenant_id, u.full_name, u.email FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE ($1::text IS NULL OR LOWER(t.code) = LOWER($1)) AND t.status = 'ACTIVE' AND LOWER(u.email) = LOWER($2)
          AND u.is_active AND u.employee_no <> 'SYS-IOT'`,
      [code ?? null, email],
    );
    const user = rows[0];
    if (!user) return;
    const url = await issuePasswordToken(user.id, user.tenant_id, 'RESET', 1);
    await sendEmail(emails.passwordReset(user.email, user.full_name, url));
  }).catch((err) => {
    if (!(err instanceof AppError && err.code === 'EMAIL_UNAVAILABLE')) throw err;
  });
  return ok(res, { sent: true });
}

export const loginLinkSchema = z.object({ email: z.email().max(255) });

/**
 * "I forgot my company's login link": e-mails the company name, code and personal login link
 * to the account's official e-mail. Always answers the same way (no account discovery).
 */
export async function sendLoginLink(req: Request, res: Response) {
  const { email } = req.valid.body as z.infer<typeof loginLinkSchema>;
  await runAsSystem(async () => {
    const { rows } = await query<{ full_name: string; email: string; name: string; code: string; account_no: string }>(
      `SELECT u.full_name, u.email, t.name, t.code, t.account_no FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE LOWER(u.email) = LOWER($1) AND u.is_active AND t.status = 'ACTIVE' AND u.employee_no <> 'SYS-IOT'`,
      [email],
    );
    const u = rows[0];
    if (!u) return;
    await sendEmail(emails.loginLink(u.email, u.full_name, u, companyLoginUrl(u.code, u.email)));
  }).catch((err) => {
    if (!(err instanceof AppError && err.code === 'EMAIL_UNAVAILABLE')) throw err;
  });
  return ok(res, { sent: true });
}

export async function me(req: Request, res: Response) {
  const authUser = requireUser(req);
  const user = await findUserById(authUser.id);
  if (!user) throw AppError.notFound('User');
  const { rows } = await query('SELECT id, account_no, code, name FROM tenants WHERE id = $1', [authUser.tenantId]);
  return ok(res, { ...user, tenant: rows[0] });
}

export async function changePassword(req: Request, res: Response) {
  const authUser = requireUser(req);
  const { currentPassword, newPassword } = req.valid.body as z.infer<typeof changePasswordSchema>;
  const { rows } = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [authUser.id]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'كلمة المرور الحالية غير صحيحة');
  }
  const hash = await bcrypt.hash(newPassword, 12);
  // password_changed_at revokes every token issued before now (see authenticate()).
  await withTransaction(dbContext(req), (db) =>
    db.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [authUser.id, hash]),
  );
  const user = await findUserById(authUser.id);
  return ok(res, { token: signAccessToken(authUser.id, authUser.role, authUser.tenantId), user });
}

export async function updatePushToken(req: Request, res: Response) {
  const { pushToken } = req.valid.body as z.infer<typeof pushTokenSchema>;
  await query('UPDATE users SET push_token = $2 WHERE id = $1', [requireUser(req).id, pushToken]);
  return ok(res, { registered: !!pushToken });
}
