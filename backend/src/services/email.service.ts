import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Development/test only: messages are kept in memory (tests read OTP codes from here). */
export const devOutbox: Email[] = [];

let transporter: Transporter | null = null;
const smtp = () =>
  (transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  }));

/**
 * Sends a transactional e-mail (OTP codes, account approval, password links).
 * Throws EMAIL_UNAVAILABLE so callers never pretend a code was delivered when it was not.
 */
export async function sendEmail(email: Email): Promise<void> {
  try {
    switch (env.EMAIL_PROVIDER) {
      case 'smtp':
        if (!env.SMTP_HOST) throw new Error('SMTP_HOST is not configured');
        await smtp().sendMail({ from: env.EMAIL_FROM, ...email });
        return;
      case 'resend': {
        if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.EMAIL_FROM, ...email }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Resend rejected the message (${res.status}): ${await res.text()}`);
        return;
      }
      default:
        if (isProduction) throw new Error('EMAIL_PROVIDER=log cannot deliver e-mail in production');
        devOutbox.push(email);
        if (devOutbox.length > 200) devOutbox.shift();
        logger.info({ to: email.to, subject: email.subject }, 'E-mail captured (development outbox)');
    }
  } catch (err) {
    logger.error({ err, to: email.to, subject: email.subject }, 'E-mail delivery failed');
    throw new AppError(503, 'EMAIL_UNAVAILABLE', 'تعذر إرسال البريد الإلكتروني حالياً، حاول مرة أخرى بعد قليل');
  }
}

// ---------------------------------------------------------------- templates (Arabic, RTL)

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f3f4f6;font-family:Tahoma,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b5d3b;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">DarHaccp — ${esc(title)}</td></tr>
<tr><td style="padding:24px;color:#1d2939;font-size:15px;line-height:1.8">${body}</td></tr>
<tr><td style="padding:14px 24px;background:#f9fafb;color:#667085;font-size:12px">منصة سلامة الغذاء والجودة المتكاملة (IMS &amp; HACCP). إذا لم تطلب هذا البريد فتجاهله.</td></tr>
</table></td></tr></table></body></html>`;
}

const codeBox = (code: string) =>
  `<div style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#0b5d3b;background:#e3f1ea;border-radius:10px;padding:14px;text-align:center;direction:ltr">${code}</div>`;

const button = (href: string, label: string) =>
  `<p style="text-align:center;margin:22px 0"><a href="${esc(href)}" style="background:#0b5d3b;color:#fff;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(label)}</a></p>`;

export const emails = {
  loginOtp: (to: string, name: string, code: string, minutes: number): Email => ({
    to,
    subject: `رمز الدخول ${code} — DarHaccp`,
    text: `رمز التحقق لتسجيل الدخول: ${code} (صالح ${minutes} دقائق). لا تشاركه مع أحد.`,
    html: layout('رمز تسجيل الدخول', `<p>مرحباً ${esc(name)}،</p><p>رمز التحقق لتسجيل الدخول:</p>${codeBox(code)}
      <p>صالح لمدة <b>${minutes} دقائق</b> ولمرة واحدة. لا تشارك هذا الرمز مع أي شخص — فريق المنصة لن يطلبه منك أبداً.</p>`),
  }),

  registrationOtp: (to: string, company: string, code: string, minutes: number): Email => ({
    to,
    subject: `تأكيد بريد الشركة ${code} — DarHaccp`,
    text: `رمز تأكيد البريد لتسجيل شركة ${company}: ${code} (صالح ${minutes} دقائق).`,
    html: layout('تأكيد بريد الشركة', `<p>شكراً لتسجيل <b>${esc(company)}</b> في منصة DarHaccp.</p><p>أدخل الرمز التالي لتأكيد البريد الإلكتروني:</p>
      ${codeBox(code)}<p>بعد التأكيد يُرسل طلبك لمراجعة إدارة المنصة.</p>`),
  }),

  newRegistration: (to: string, t: { name: string; code: string; account_no: string; phone: string; email: string; address: string }): Email => ({
    to,
    subject: `طلب اشتراك جديد بانتظار المراجعة: ${t.name}`,
    text: `طلب اشتراك جديد: ${t.name} (${t.code}) — ${t.email} — ${t.phone}`,
    html: layout('طلب اشتراك جديد', `<p>شركة جديدة أكدت بريدها وتنتظر المراجعة:</p>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
      <tr><td>الشركة</td><td><b>${esc(t.name)}</b></td></tr><tr><td>رمز الشركة</td><td dir="ltr"><b>${esc(t.code)}</b></td></tr>
      <tr><td>الرقم التعريفي</td><td>${esc(t.account_no)}</td></tr><tr><td>الجوال</td><td dir="ltr">${esc(t.phone)}</td></tr>
      <tr><td>البريد</td><td dir="ltr">${esc(t.email)}</td></tr><tr><td>العنوان</td><td>${esc(t.address)}</td></tr></table>
      ${button(`${env.APP_URL}/platform`, 'فتح لوحة إدارة المنصة')}`),
  }),

  approved: (to: string, t: { name: string; code: string; account_no: string }, activationUrl: string): Email => ({
    to,
    subject: `تمت الموافقة على اشتراك ${t.name} — DarHaccp`,
    text: `تمت الموافقة على اشتراككم. رمز الشركة: ${t.code}. الرقم التعريفي: ${t.account_no}. فعّل حساب المدير: ${activationUrl}`,
    html: layout('تمت الموافقة على الاشتراك', `<p>يسعدنا إبلاغكم بالموافقة على اشتراك <b>${esc(t.name)}</b>.</p>
      <table cellpadding="6" style="font-size:15px"><tr><td>رمز الشركة</td><td dir="ltr"><b>${esc(t.code)}</b></td></tr>
      <tr><td>الرقم التعريفي</td><td><b>${esc(t.account_no)}</b></td></tr></table>
      <p>احتفظوا برمز الشركة؛ يُطلب عند كل تسجيل دخول. اضغطوا لتعيين كلمة مرور مدير الحساب (الرابط صالح 72 ساعة):</p>
      ${button(activationUrl, 'تفعيل حساب المدير')}`),
  }),

  rejected: (to: string, name: string, reason: string): Email => ({
    to,
    subject: `بخصوص طلب اشتراك ${name} — DarHaccp`,
    text: `نعتذر، لم تتم الموافقة على طلب الاشتراك. السبب: ${reason}`,
    html: layout('نتيجة مراجعة طلب الاشتراك', `<p>نعتذر، لم تتم الموافقة على طلب اشتراك <b>${esc(name)}</b>.</p><p>السبب: ${esc(reason)}</p>
      <p>يمكنكم تصحيح البيانات وإعادة التسجيل.</p>`),
  }),

  suspended: (to: string, name: string, reason: string): Email => ({
    to,
    subject: `تم إيقاف حساب ${name} مؤقتاً — DarHaccp`,
    text: `تم إيقاف حساب الشركة مؤقتاً. السبب: ${reason}`,
    html: layout('إيقاف الحساب', `<p>تم إيقاف حساب <b>${esc(name)}</b> مؤقتاً.</p><p>السبب: ${esc(reason)}</p>`),
  }),

  passwordReset: (to: string, name: string, url: string): Email => ({
    to,
    subject: 'إعادة تعيين كلمة المرور — DarHaccp',
    text: `لإعادة تعيين كلمة المرور افتح الرابط (صالح ساعة): ${url}`,
    html: layout('إعادة تعيين كلمة المرور', `<p>مرحباً ${esc(name)}،</p><p>طُلبت إعادة تعيين كلمة المرور لحسابك. الرابط صالح لمدة ساعة واحدة:</p>
      ${button(url, 'تعيين كلمة مرور جديدة')}`),
  }),
};
