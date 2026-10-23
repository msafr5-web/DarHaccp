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
  /** Password-less sign-in: one message with a one-click link and the same session's 6-digit code. */
  loginCode: (to: string, name: string, company: string, code: string, loginUrl: string, minutes: number): Email => ({
    to,
    subject: `رمز الدخول ${code} — ${company}`,
    text: `رمز الدخول إلى ${company}: ${code} — أو اضغط رابط الدخول: ${loginUrl} (صالحان ${minutes} دقائق ولمرة واحدة). لا تشاركهما مع أحد.`,
    html: layout('الدخول إلى المنصة', `<p>مرحباً ${esc(name)}،</p><p>طُلب الدخول إلى منصة <b>${esc(company)}</b> بهذا البريد.</p>
      ${button(loginUrl, 'الدخول الآن بضغطة واحدة')}
      <p style="text-align:center;color:#667085;font-size:13px">أو أدخل رمز التحقق في صفحة الدخول:</p>${codeBox(code)}
      <p>الرابط والرمز صالحان لمدة <b>${minutes} دقائق</b> ولمرة واحدة. إن لم تطلب الدخول فتجاهل هذه الرسالة — لا يمكن لأحد الدخول بدون هذا البريد.</p>`),
  }),

  /** Sign-in requested for a company that cannot sign in yet (under review, suspended…). */
  accountStatus: (to: string, company: string, message: string): Email => ({
    to,
    subject: `حالة حساب ${company} — DarHaccp`,
    text: `طُلب الدخول إلى ${company}: ${message}`,
    html: layout('حالة الحساب', `<p>طُلب الدخول إلى <b>${esc(company)}</b> بهذا البريد.</p><p>${esc(message)}</p>`),
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

  approved: (to: string, t: { name: string; code: string; account_no: string }, loginUrl: string): Email => ({
    to,
    subject: `تمت الموافقة على اشتراك ${t.name} — DarHaccp`,
    text: `تمت الموافقة على اشتراككم. رابط الدخول الخاص بشركتكم: ${loginUrl} — أدخلوا بريدكم الرسمي وسيصلكم رابط ورمز الدخول. رمز الشركة: ${t.code} — الرقم التعريفي: ${t.account_no}`,
    html: layout('تمت الموافقة على الاشتراك', `<p>يسعدنا إبلاغكم بالموافقة على اشتراك <b>${esc(t.name)}</b> في منصة DarHaccp.</p>
      <p>للدخول افتحوا رابط شركتكم وأدخلوا هذا البريد الرسمي فقط، وسيصلكم <b>رابط دخول ورمز تحقق</b> فوراً — لا حاجة لكلمة مرور ولا لحفظ رمز الشركة.</p>
      ${button(loginUrl, 'الدخول إلى منصة شركتكم')}
      <p style="direction:ltr;text-align:center;font-size:13px;color:#667085">${esc(loginUrl)}</p>
      <table cellpadding="6" style="font-size:14px;color:#344054"><tr><td>رمز الشركة</td><td dir="ltr"><b>${esc(t.code)}</b></td></tr>
      <tr><td>الرقم التعريفي</td><td><b>${esc(t.account_no)}</b></td></tr></table>`),
  }),

  loginLink: (to: string, name: string, t: { name: string; code: string; account_no: string }, loginUrl: string): Email => ({
    to,
    subject: `رابط الدخول إلى ${t.name} — DarHaccp`,
    text: `رابط الدخول الخاص بشركتكم: ${loginUrl} — رمز الشركة: ${t.code}`,
    html: layout('رابط الدخول الخاص بشركتكم', `<p>مرحباً ${esc(name)}،</p><p>هذا رابط الدخول إلى منصة <b>${esc(t.name)}</b> كما طلبت:</p>
      ${button(loginUrl, 'الدخول إلى المنصة')}
      <p style="direction:ltr;text-align:center;font-size:13px;color:#667085">${esc(loginUrl)}</p>
      <p>رمز الشركة: <b dir="ltr">${esc(t.code)}</b> · الرقم التعريفي: <b>${esc(t.account_no)}</b></p>
      <p style="font-size:13px;color:#667085">سيُطلب منك رمز تحقق يصل إلى بريدك عند كل دخول.</p>`),
  }),

  rejected: (to: string, name: string, reason: string): Email => ({
    to,
    subject: `بخصوص طلب اشتراك ${name} — DarHaccp`,
    text: `نعتذر، لم تتم الموافقة على طلب الاشتراك. السبب: ${reason}`,
    html: layout('نتيجة مراجعة طلب الاشتراك', `<p>نعتذر، لم تتم الموافقة على طلب اشتراك <b>${esc(name)}</b>.</p><p>السبب: ${esc(reason)}</p>
      <p>يمكنكم تصحيح البيانات وإعادة التسجيل.</p>`),
  }),

  emailChanged: (to: string, company: string, oldEmail: string, newEmail: string, loginUrl: string): Email => ({
    to,
    subject: `تم تحديث البريد الرسمي لـ ${company} — DarHaccp`,
    text: `حدّثت إدارة المنصة البريد الرسمي لشركة ${company} من ${oldEmail} إلى ${newEmail}. رموز وروابط الدخول تُرسل الآن إلى ${newEmail}. رابط الدخول: ${loginUrl}`,
    html: layout('تحديث البريد الرسمي', `<p>حدّثت إدارة منصة DarHaccp البريد الرسمي لشركة <b>${esc(company)}</b>:</p>
      <table cellpadding="6" style="font-size:14px"><tr><td>البريد السابق</td><td dir="ltr">${esc(oldEmail)}</td></tr>
      <tr><td>البريد الجديد</td><td dir="ltr"><b>${esc(newEmail)}</b></td></tr></table>
      <p>من الآن تُرسل رموز وروابط الدخول إلى البريد الجديد.</p>${button(loginUrl, 'الدخول إلى منصة الشركة')}
      <p style="font-size:13px;color:#b42318">إن لم تطلبوا هذا التغيير فتواصلوا مع إدارة المنصة فوراً.</p>`),
  }),

  criticalAlert: (to: string, company: string, title: string, message: string, url: string): Email => ({
    to,
    subject: `⚠ تنبيه فوري: ${title} — ${company}`,
    text: `${title}
${message}
تم فتح إجراء تصحيحي (CAPA) تلقائياً. التفاصيل: ${url}`,
    html: layout('تنبيه سلامة غذاء فوري', `<p style="color:#b42318;font-weight:700">${esc(title)}</p>
      <p>${esc(message)}</p><p>تم فتح إجراء تصحيحي (CAPA) تلقائياً وإبلاغ المشرف المختص.</p>
      ${button(url, 'فتح التنبيهات')}`),
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
