import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, runAsSystem, runInTenant, withTransaction } from '../config/database';
import { env } from '../config/env';
import { signAccessToken } from '../middlewares/auth';
import { insertAuditEvent } from '../models/audit.model';
import { findUserById } from '../models/user.model';
import { emails, sendEmail } from '../services/email.service';
import { createChallenge, maskEmail, OtpChallenge, OTP_TTL_MINUTES, recentChallenges, resendChallenge, verifyChallenge, verifyMagicLink } from '../services/otp.service';
import { companyLoginUrl, consumePasswordToken, issuePasswordToken } from '../services/tenant.service';
import { AppError } from '../utils/AppError';
import { dbContext, ok, requireUser } from '../utils/http';
import { uuid } from '../utils/schemas';


export const passwordPolicy = z
  .string()
  .min(10, 'كلمة المرور 10 أحرف على الأقل')
  .max(128)
  .regex(/[A-Z]/, 'كلمة المرور تحتاج حرفاً كبيراً (A-Z)')
  .regex(/[a-z]/, 'كلمة المرور تحتاج حرفاً صغيراً (a-z)')
  .regex(/\d/, 'كلمة المرور تحتاج رقماً');

/** Optional: the e-mail alone identifies the account (it is unique on the whole platform). */
const companyCode = z.string().trim().min(4).max(60).optional();

/** Password-less sign-in: the official e-mail is the identity (unique on the whole platform). */
export const loginSchema = z.object({
  companyCode,
  email: z.email().max(255),
});
export const magicLinkSchema = z.object({ challengeId: uuid, token: z.string().min(20).max(100) });
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
  stage: 'EMAIL' | 'OTP' | 'MAGIC_LINK' | 'OTP_RESEND' | 'PASSWORD';
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

const FLOOD_COOLDOWN_SECONDS = 60;
const FLOOD_MAX_PER_15_MIN = 10;

/** One-click login link carried by the e-mail (opens /magic and signs in). */
const magicLoginUrl = (challengeId: string, token: string) =>
  `${env.APP_URL.replace(/\/+$/, '')}/magic?c=${challengeId}&t=${token}`;

/**
 * Step 1 — the e-mail only. When it belongs to an active account, ONE message is sent with a
 * one-click login link and a 6-digit code (5 minutes, single use).
 * The answer is identical whether or not the e-mail exists, so accounts cannot be discovered;
 * the outcome is in the login_attempts log. A company that cannot sign in yet (under review,
 * suspended) is told why by e-mail. Anti-flooding: one message per 60 s, five per 15 min.
 */
export async function login(req: Request, res: Response) {
  const { companyCode: code, email } = req.valid.body as z.infer<typeof loginSchema>;

  const challengeId = await runAsSystem(async () => {
    const attempt = (a: Omit<AttemptInfo, 'stage' | 'email' | 'companyCode'>) =>
      recordAttempt(req, { ...a, email, companyCode: code, stage: 'EMAIL' });

    const { rows: users } = await query<{
      id: string; full_name: string; email: string; is_active: boolean; tenant_id: number;
      tenant_status: string; tenant_name: string;
    }>(
      `SELECT u.id, u.full_name, u.email, u.is_active, u.tenant_id, t.status AS tenant_status, t.name AS tenant_name
         FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE LOWER(u.email) = LOWER($1) AND u.employee_no <> 'SYS-IOT'
          AND ($2::text IS NULL OR LOWER(t.code) = LOWER($2))`,
      [email, code ?? null],
    );
    const user = users[0];

    const recent = await recentChallenges(email);
    const coolingDown = !!recent.last_at && Date.now() - new Date(recent.last_at).getTime() < FLOOD_COOLDOWN_SECONDS * 1000;
    if (coolingDown && recent.last_id) {
      await attempt({ tenantId: user?.tenant_id, userId: user?.id, success: false, reason: 'EMAIL_COOLDOWN' });
      return recent.last_id; // the previous message is still valid
    }
    if (recent.n >= FLOOD_MAX_PER_15_MIN) {
      await attempt({ tenantId: user?.tenant_id, userId: user?.id, success: false, reason: 'EMAIL_THROTTLED' });
      return randomUUID();
    }

    // A company that cannot sign in yet (under review, suspended…): explain why by e-mail.
    const { rows: tenants } = user
      ? { rows: [] as { id: number; name: string; status: string; email: string }[] }
      : await query<{ id: number; name: string; status: string; email: string }>(
          `SELECT id, name, status, email FROM tenants WHERE LOWER(email) = LOWER($1) AND NOT is_platform`,
          [email],
        );
    const blocked = user && user.tenant_status !== 'ACTIVE'
      ? { id: user.tenant_id, name: user.tenant_name, status: user.tenant_status, email: user.email }
      : tenants[0] && tenants[0].status !== 'ACTIVE' ? tenants[0] : undefined;
    if (blocked) {
      const message = TENANT_STATUS_MESSAGES[blocked.status] ?? 'لا يمكن الدخول حالياً — تواصل مع إدارة المنصة';
      // A code-less challenge keeps the same anti-flooding rules for these notices.
      await createChallenge({ purpose: 'LOGIN', tenantId: blocked.id, email: blocked.email, ip: req.ip });
      await sendEmail(emails.accountStatus(blocked.email, blocked.name, message)).catch(() => undefined);
      await attempt({ tenantId: blocked.id, userId: user?.id, success: false, reason: `TENANT_${blocked.status}` });
      return randomUUID();
    }

    if (!user || !user.is_active) {
      await attempt({ tenantId: user?.tenant_id, userId: user?.id, success: false, reason: user ? 'USER_INACTIVE' : 'UNKNOWN_EMAIL' });
      return randomUUID();
    }

    const otp = await createChallenge({
      purpose: 'LOGIN', tenantId: user.tenant_id, userId: user.id, email: user.email, ip: req.ip, withMagicLink: true,
    });
    await sendEmail(emails.loginCode(user.email, user.full_name, user.tenant_name, otp.code, magicLoginUrl(otp.id, otp.magic!), OTP_TTL_MINUTES));
    await attempt({ tenantId: user.tenant_id, userId: user.id, success: true });
    return otp.id;
  });

  return ok(res, { otpRequired: true, challengeId, email: maskEmail(email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
}

/** Creates the session once the code or the link has been verified. */
async function issueSession(req: Request, res: Response, challenge: OtpChallenge, stage: 'OTP' | 'MAGIC_LINK') {
  return runInTenant(challenge.tenant_id, async () => {
    const user = challenge.user_id ? await findUserById(challenge.user_id) : undefined;
    if (!user || !user.is_active) throw AppError.unauthorized('الحساب غير نشط');
    await query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
    await recordAttempt(req, { tenantId: challenge.tenant_id, userId: user.id, email: user.email, stage, success: true });
    await insertAuditEvent({
      userId: user.id, action: 'LOGIN', entity: 'auth', entityId: user.id, ip: req.ip,
      userAgent: req.get('user-agent'), requestId: req.requestId, data: { method: stage },
    });
    const { rows: t } = await query<{ id: number; account_no: string; code: string; name: string }>(
      'SELECT id, account_no, code, name FROM tenants WHERE id = $1',
      [challenge.tenant_id],
    );
    return ok(res, { token: signAccessToken(user.id, user.role, challenge.tenant_id), user, tenant: t[0] });
  });
}

/** Runs a code/link verification, recording failures in the login-attempt log. */
async function verifyWith(req: Request, challengeId: string, stage: 'OTP' | 'MAGIC_LINK', verify: () => Promise<OtpChallenge>) {
  return runAsSystem(async () => {
    const { rows } = await query<{ tenant_id: number; user_id: string | null; email: string }>(
      `SELECT tenant_id, user_id, email FROM otp_challenges WHERE id = $1`,
      [challengeId],
    );
    try {
      const challenge = await verify();
      if (!challenge.user_id) throw new AppError(400, 'OTP_INVALID_SESSION', 'انتهت جلسة التحقق، ابدأ من جديد');
      return challenge;
    } catch (err) {
      await recordAttempt(req, {
        tenantId: rows[0]?.tenant_id, userId: rows[0]?.user_id, email: rows[0]?.email, stage, success: false,
        reason: err instanceof AppError ? err.code : 'ERROR',
      });
      throw err;
    }
  });
}

/** Step 2a — the 6-digit code typed on the sign-in page. */
export async function verifyOtp(req: Request, res: Response) {
  const { challengeId, code } = req.valid.body as z.infer<typeof verifyOtpSchema>;
  const challenge = await verifyWith(req, challengeId, 'OTP', () => verifyChallenge(challengeId, 'LOGIN', code));
  return issueSession(req, res, challenge, 'OTP');
}

/** Step 2b — the one-click link from the e-mail. */
export async function verifyMagicLinkLogin(req: Request, res: Response) {
  const { challengeId, token } = req.valid.body as z.infer<typeof magicLinkSchema>;
  const challenge = await verifyWith(req, challengeId, 'MAGIC_LINK', () => verifyMagicLink(challengeId, token));
  return issueSession(req, res, challenge, 'MAGIC_LINK');
}

export async function resendOtp(req: Request, res: Response) {
  const { challengeId } = req.valid.body as z.infer<typeof resendOtpSchema>;
  const result = await runAsSystem(async () => {
    let resent: Awaited<ReturnType<typeof resendChallenge>>;
    try {
      resent = await resendChallenge(challengeId, 'LOGIN');
      if (!resent.challenge.user_id) throw new AppError(400, 'OTP_INVALID_SESSION', 'انتهت جلسة التحقق، ابدأ من جديد');
    } catch (err) {
      // Refused resends (cool-down, limits, unknown session) are attempts too.
      const { rows } = await query<{ tenant_id: number; user_id: string | null; email: string }>(
        'SELECT tenant_id, user_id, email FROM otp_challenges WHERE id = $1',
        [challengeId],
      );
      await recordAttempt(req, {
        tenantId: rows[0]?.tenant_id, userId: rows[0]?.user_id, email: rows[0]?.email, stage: 'OTP_RESEND',
        success: false, reason: err instanceof AppError ? err.code : 'ERROR',
      });
      throw err;
    }
    const { challenge, code, magic } = resent;
    const { rows } = await query<{ full_name: string; tenant_name: string }>(
      'SELECT u.full_name, t.name AS tenant_name FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1',
      [challenge.user_id],
    );
    await sendEmail(emails.loginCode(challenge.email, rows[0]?.full_name ?? '', rows[0]?.tenant_name ?? '', code,
      magicLoginUrl(challenge.id, magic!), OTP_TTL_MINUTES));
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
