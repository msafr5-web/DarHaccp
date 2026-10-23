import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, runAsSystem } from '../config/database';
import { emails, sendEmail } from '../services/email.service';
import { maskEmail, OTP_TTL_MINUTES, resendChallenge } from '../services/otp.service';
import {
  approveTenant, buildCompanyCode, confirmRegistration, normalizePhone, publicCompany, registerCompany, resendActivation, setTenantStatus, updateTenantDetails,
} from '../services/tenant.service';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, paginate, requireUser } from '../utils/http';
import { isoDateTime, pagination, uuid } from '../utils/schemas';

// ---------------------------------------------------------------- public registration

const phone = z
  .string()
  .trim()
  .refine((p) => /^05\d{8}$/.test(normalizePhone(p)), 'رقم جوال سعودي غير صالح (مثال: 0566477687)');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'اسم الشركة مطلوب').max(150).refine((n) => /\p{L}/u.test(n), 'اسم الشركة يجب أن يحتوي حروفاً'),
  phone,
  email: z.email('بريد إلكتروني غير صالح').max(255),
  address: z.string().trim().min(5, 'العنوان مطلوب').max(300),
});
export const registrationOtpSchema = z.object({ challengeId: uuid, code: z.string().trim().regex(/^\d{6}$/, 'الرمز 6 أرقام') });
export const registrationResendSchema = z.object({ challengeId: uuid });
export const codePreviewQuery = z.object({ name: z.string().max(150).default(''), phone: z.string().max(20).default('') });

/** Live preview of the company code while the form is being filled. */
export function previewCode(req: Request, res: Response) {
  const { name, phone: p } = req.valid.query as z.infer<typeof codePreviewQuery>;
  let code: string | null = null;
  try {
    if (name.trim() && normalizePhone(p).length >= 5) code = buildCompanyCode(name, p);
  } catch {
    code = null;
  }
  return ok(res, { code });
}

export async function register(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof registerSchema>;
  const { tenant, challengeId } = await registerCompany(b, req.ip);
  return created(res, {
    id: tenant.id,
    accountNo: tenant.account_no,
    code: tenant.code,
    status: tenant.status,
    challengeId,
    email: maskEmail(tenant.email),
  });
}

export const companyCodeParams = z.object({ code: z.string().trim().min(4).max(60) });

/** Branding for a company login link (/c/<code>): the company name only. */
export async function companyByCode(req: Request, res: Response) {
  const { code } = req.valid.params as z.infer<typeof companyCodeParams>;
  return ok(res, await publicCompany(code));
}

export async function verifyRegistration(req: Request, res: Response) {
  const { challengeId, code } = req.valid.body as z.infer<typeof registrationOtpSchema>;
  const tenant = await confirmRegistration(challengeId, code);
  return ok(res, { id: tenant.id, accountNo: tenant.account_no, code: tenant.code, status: tenant.status });
}

export async function resendRegistrationOtp(req: Request, res: Response) {
  const { challengeId } = req.valid.body as z.infer<typeof registrationResendSchema>;
  const result = await runAsSystem(async () => {
    const { challenge, code } = await resendChallenge(challengeId, 'REGISTRATION');
    const { rows } = await query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [challenge.tenant_id]);
    await sendEmail(emails.registrationOtp(challenge.email, rows[0]?.name ?? '', code, OTP_TTL_MINUTES));
    return { email: maskEmail(challenge.email) };
  });
  return ok(res, result);
}

// ---------------------------------------------------------------- platform administration (SaaS operator)

const tenantStatus = z.enum(['PENDING_VERIFICATION', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED']);
export const listTenantsQuery = pagination.extend({ status: tenantStatus.optional(), search: z.string().trim().max(100).optional() });
export const tenantIdParams = z.object({ id: z.coerce.number().int().positive() });
export const reviewSchema = z.object({ notes: z.string().trim().max(1000).optional() });
export const tenantUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'اسم الشركة مطلوب').max(150),
    phone,
    email: z.email('بريد إلكتروني غير صالح').max(255),
    address: z.string().trim().min(5, 'العنوان مطلوب').max(300),
  })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'لا توجد تغييرات' });
export const reasonSchema = z.object({ reason: z.string().trim().min(5, 'اذكر السبب').max(1000) });
export const attemptsQuery = pagination.extend({
  tenantId: z.coerce.number().int().positive().optional(),
  success: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  from: isoDateTime.optional(),
});

const TENANT_SELECT = `
  SELECT t.id, t.account_no, t.code, t.name, t.phone, t.email, t.address, t.subscription_date, t.status,
         t.email_verified_at, t.reviewed_at, t.review_notes, t.created_at, r.full_name AS reviewed_by_name,
         (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.is_active AND u.employee_no <> 'SYS-IOT') AS users_count,
         (SELECT max(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login_at,
         (SELECT COUNT(*)::int FROM monitoring_records m WHERE m.tenant_id = t.id) AS records_count
    FROM tenants t LEFT JOIN users r ON r.id = t.reviewed_by
   WHERE NOT t.is_platform`;

export async function platformStats(_req: Request, res: Response) {
  const { rows } = await runAsSystem(() =>
    query(
      `SELECT COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW')::int AS pending_review,
              COUNT(*) FILTER (WHERE status = 'PENDING_VERIFICATION')::int AS pending_verification,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
              COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
              COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
              COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS registrations_30d,
              (SELECT COUNT(*)::int FROM login_attempts WHERE NOT success AND occurred_at >= now() - interval '24 hours') AS failed_logins_24h,
              (SELECT COUNT(*)::int FROM login_attempts WHERE success AND stage = 'OTP' AND occurred_at >= now() - interval '24 hours') AS logins_24h
         FROM tenants WHERE NOT is_platform`,
    ),
  );
  return ok(res, rows[0]);
}

export async function listTenants(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listTenantsQuery>;
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.status) where.push(`x.status = $${params.push(q.status)}`);
  if (q.search) {
    const p = params.push(`%${q.search}%`);
    where.push(`(x.name ILIKE $${p} OR x.code ILIKE $${p} OR x.email ILIKE $${p} OR x.phone ILIKE $${p} OR x.account_no ILIKE $${p})`);
  }
  const { limit, offset } = paginate(q.page, q.pageSize);
  const { rows } = await runAsSystem(() =>
    query<{ total: number }>(
      `SELECT x.*, COUNT(*) OVER()::int AS total FROM (${TENANT_SELECT}) x
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE x.status WHEN 'PENDING_REVIEW' THEN 0 WHEN 'PENDING_VERIFICATION' THEN 1 ELSE 2 END, x.created_at DESC
        LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params,
    ),
  );
  return ok(res, rows.map(({ total: _t, ...r }) => r), { page: q.page, pageSize: q.pageSize, total: rows[0]?.total ?? 0 });
}

export async function getTenant(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  const { rows } = await runAsSystem(() => query(`${TENANT_SELECT} AND t.id = $1`, [id]));
  if (!rows[0]) throw AppError.notFound('Company');
  return ok(res, rows[0]);
}

export async function approve(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  const { notes } = req.valid.body as z.infer<typeof reviewSchema>;
  return ok(res, await approveTenant(dbContext(req), id, notes));
}

export async function reject(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  return ok(res, await setTenantStatus(dbContext(req), id, 'REJECT', (req.valid.body as z.infer<typeof reasonSchema>).reason));
}

export async function suspend(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  return ok(res, await setTenantStatus(dbContext(req), id, 'SUSPEND', (req.valid.body as z.infer<typeof reasonSchema>).reason));
}

export async function reactivate(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  return ok(res, await setTenantStatus(dbContext(req), id, 'REACTIVATE'));
}

/** Corrects the company's name, mobile, official e-mail or address (code stays fixed). */
export async function updateDetails(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  return ok(res, await updateTenantDetails(dbContext(req), id, req.valid.body as z.infer<typeof tenantUpdateSchema>));
}

export async function reopen(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  return ok(res, await setTenantStatus(dbContext(req), id, 'REOPEN', (req.valid.body as z.infer<typeof reviewSchema>).notes));
}

export async function resendActivationLink(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof tenantIdParams>;
  await resendActivation(id);
  return ok(res, { sent: true });
}

async function listAttempts(q: z.infer<typeof attemptsQuery>, tenantId: number | null) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (tenantId) where.push(`a.tenant_id = $${params.push(tenantId)}`);
  if (q.success !== undefined) where.push(`a.success = $${params.push(q.success)}`);
  if (q.from) where.push(`a.occurred_at >= $${params.push(q.from)}`);
  const { limit, offset } = paginate(q.page, q.pageSize);
  const { rows } = await query<{ total: number }>(
    `SELECT a.id, a.tenant_id, t.name AS tenant_name, t.code AS tenant_code, a.user_id, u.full_name AS user_name, a.company_code,
            a.email, a.stage, a.success, a.failure_reason, a.ip_address, a.user_agent, a.occurred_at, COUNT(*) OVER()::int AS total
       FROM login_attempts a LEFT JOIN tenants t ON t.id = a.tenant_id LEFT JOIN users u ON u.id = a.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

/** Platform view: attempts across all companies (including unknown company codes). */
export async function platformAttempts(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof attemptsQuery>;
  const { rows, total } = await runAsSystem(() => listAttempts(q, q.tenantId ?? null));
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

/** Company admin view: attempts against the company's own accounts (RLS-confined). */
export async function companyAttempts(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof attemptsQuery>;
  const { rows, total } = await listAttempts(q, requireUser(req).tenantId);
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

/** The signed-in user's company profile (code, account number). */
export async function myCompany(req: Request, res: Response) {
  const { rows } = await query(
    `SELECT id, account_no, code, name, phone, email, address, subscription_date, status FROM tenants WHERE id = $1`,
    [requireUser(req).tenantId],
  );
  return ok(res, rows[0]);
}
