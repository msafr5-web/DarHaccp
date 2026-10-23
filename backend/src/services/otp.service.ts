import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { query } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

/** One-time e-mail codes for every login and for confirming a company's e-mail at registration. */
export const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS = 5;

export type OtpPurpose = 'LOGIN' | 'REGISTRATION';

export interface OtpChallenge {
  id: string;
  purpose: OtpPurpose;
  tenant_id: number;
  user_id: string | null;
  email: string;
  expires_at: string;
  attempts: number;
  sends: number;
  last_sent_at: string;
  consumed_at: string | null;
}

// The code itself is never stored: only an HMAC bound to the challenge id.
const hashCode = (challengeId: string, code: string) =>
  createHmac('sha256', env.JWT_SECRET).update(`otp:${challengeId}:${code}`).digest('hex');

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// One-click login link token (256-bit), stored as an HMAC like the code.
const hashMagic = (challengeId: string, token: string) =>
  createHmac('sha256', env.JWT_SECRET).update(`magic:${challengeId}:${token}`).digest('hex');
const newMagicToken = () => randomBytes(32).toString('base64url');

export const maskEmail = (email: string) => {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 3))}@${domain}`;
};

/** Must be called from a system scope (otp_challenges is not visible to tenants). */
export async function createChallenge(c: {
  purpose: OtpPurpose; tenantId: number; userId?: string; email: string; ip?: string; withMagicLink?: boolean;
}) {
  const id = randomUUID();
  const code = newCode();
  const magic = c.withMagicLink ? newMagicToken() : undefined;
  await query(
    `INSERT INTO otp_challenges (id, purpose, tenant_id, user_id, email, code_hash, magic_hash, expires_at, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8), $9)`,
    [id, c.purpose, c.tenantId, c.userId ?? null, c.email, hashCode(id, code), magic ? hashMagic(id, magic) : null,
      OTP_TTL_MINUTES, c.ip ?? null],
  );
  return { id, code, magic };
}

/** Recent login challenges for an e-mail: drives the anti-flooding rules. */
export async function recentChallenges(email: string) {
  const { rows } = await query<{ n: number; last_id: string | null; last_at: string | null }>(
    // n: messages sent in 15 min; last_*: the newest message that can still be used.
    `SELECT COUNT(*)::int AS n,
            (array_agg(id ORDER BY created_at DESC) FILTER (WHERE user_id IS NOT NULL AND consumed_at IS NULL AND expires_at > now() AND attempts < 5))[1] AS last_id,
            max(last_sent_at) FILTER (WHERE user_id IS NOT NULL AND consumed_at IS NULL AND expires_at > now() AND attempts < 5) AS last_at
       FROM otp_challenges
      WHERE LOWER(email) = LOWER($1) AND purpose = 'LOGIN' AND created_at > now() - interval '15 minutes'`,
    [email],
  );
  return rows[0]!;
}

/** Verifies a one-click login link (same single-use / attempt rules as the code). */
export async function verifyMagicLink(id: string, token: string): Promise<OtpChallenge> {
  const challenge = await load(id, 'LOGIN');
  if (challenge.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'OTP_LOCKED', 'تم تجاوز عدد المحاولات، اطلب رابطاً جديداً');
  if (new Date(challenge.expires_at) < new Date()) throw new AppError(400, 'OTP_EXPIRED', 'انتهت صلاحية الرابط، اطلب رابطاً جديداً');
  const { rows } = await query<{ magic_hash: string | null }>('SELECT magic_hash FROM otp_challenges WHERE id = $1', [id]);
  const stored = rows[0]?.magic_hash;
  const ok = !!stored && /^[\w-]{20,100}$/.test(token)
    && timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(hashMagic(id, token), 'hex'));
  if (!ok) {
    await query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [id]);
    throw new AppError(401, 'MAGIC_LINK_INVALID', 'رابط الدخول غير صالح — اطلب رابطاً جديداً');
  }
  const consumed = await query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [id]);
  if (!consumed.rowCount) throw new AppError(400, 'OTP_INVALID_SESSION', 'تم استخدام هذا الرابط مسبقاً');
  return challenge;
}

async function load(id: string, purpose: OtpPurpose) {
  const { rows } = await query<OtpChallenge>('SELECT * FROM otp_challenges WHERE id = $1 AND purpose = $2', [id, purpose]);
  if (!rows[0] || rows[0].consumed_at) throw new AppError(400, 'OTP_INVALID_SESSION', 'انتهت جلسة التحقق، ابدأ من جديد');
  return rows[0];
}

/** Verifies a code. Wrong codes count against the challenge; after 5 the challenge is locked. */
export async function verifyChallenge(id: string, purpose: OtpPurpose, code: string): Promise<OtpChallenge> {
  const challenge = await load(id, purpose);
  if (challenge.attempts >= MAX_ATTEMPTS) {
    throw new AppError(429, 'OTP_LOCKED', 'تم تجاوز عدد المحاولات المسموح، ابدأ تسجيل الدخول من جديد');
  }
  if (new Date(challenge.expires_at) < new Date()) throw new AppError(400, 'OTP_EXPIRED', 'انتهت صلاحية الرمز، اطلب رمزاً جديداً');

  const { rows } = await query<{ code_hash: string }>('SELECT code_hash FROM otp_challenges WHERE id = $1', [id]);
  const expected = Buffer.from(rows[0]!.code_hash, 'hex');
  const received = Buffer.from(hashCode(id, code), 'hex');
  if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected, received)) {
    const { rows: upd } = await query<{ attempts: number }>(
      'UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
      [id],
    );
    const left = MAX_ATTEMPTS - (upd[0]?.attempts ?? MAX_ATTEMPTS);
    throw new AppError(401, 'OTP_INVALID', left > 0 ? `رمز غير صحيح — متبقٍ ${left} محاولات` : 'رمز غير صحيح — تم قفل الجلسة، ابدأ من جديد', {
      remainingAttempts: left,
    });
  }
  // Single use: consumption is atomic so a code can never be replayed concurrently.
  const consumed = await query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [id]);
  if (!consumed.rowCount) throw new AppError(400, 'OTP_INVALID_SESSION', 'انتهت جلسة التحقق، ابدأ من جديد');
  return challenge;
}

/** Issues a fresh code for the same challenge (cool-down 60 s, at most 5 sends). */
export async function resendChallenge(id: string, purpose: OtpPurpose) {
  const challenge = await load(id, purpose);
  const wait = RESEND_COOLDOWN_SECONDS - (Date.now() - new Date(challenge.last_sent_at).getTime()) / 1000;
  if (wait > 0) throw new AppError(429, 'OTP_COOLDOWN', `انتظر ${Math.ceil(wait)} ثانية قبل طلب رمز جديد`, { retryAfter: Math.ceil(wait) });
  if (challenge.sends >= MAX_SENDS) throw new AppError(429, 'OTP_SEND_LIMIT', 'تم تجاوز عدد مرات الإرسال، ابدأ من جديد');
  if (challenge.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'OTP_LOCKED', 'تم قفل الجلسة، ابدأ من جديد');
  const code = newCode();
  const { rows } = await query<{ has_magic: boolean }>('SELECT magic_hash IS NOT NULL AS has_magic FROM otp_challenges WHERE id = $1', [id]);
  const magic = rows[0]?.has_magic ? newMagicToken() : undefined;
  await query(
    `UPDATE otp_challenges SET code_hash = $2, expires_at = now() + make_interval(mins => $3), sends = sends + 1,
            last_sent_at = now(), attempts = 0, magic_hash = COALESCE($4, magic_hash)
      WHERE id = $1`,
    [id, hashCode(id, code), OTP_TTL_MINUTES, magic ? hashMagic(id, magic) : null],
  );
  return { challenge, code, magic };
}
