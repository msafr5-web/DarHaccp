# DarHaccp كمنصة SaaS متعددة الشركات

## 1. رحلة الشركة
| الخطوة | ما يحدث | الحالة |
|---|---|---|
| التسجيل `/register` | اسم الشركة، جوال التواصل، البريد، العنوان ← يُنشأ **رمز الشركة** و**رقم تعريفي** (`T-000123`) | `PENDING_VERIFICATION` |
| تأكيد البريد | رمز من 6 أرقام على بريد الشركة (يثبت أن رموز OTP ستصل) | `PENDING_REVIEW` + إشعار لمدير المنصة |
| مراجعة مدير المنصة `/platform` | التحقق من البيانات ثم **اعتماد** أو **رفض** (بسبب) | `ACTIVE` / `REJECTED` |
| الاعتماد | تُجهَّز للشركة تلقائياً: خطة الهاسب (8 CCPs)، 17 نموذجاً رقمياً برموز QR جديدة، الفرع الرئيسي، حساب مدير الشركة ← بريد فيه رمز الشركة ورابط تفعيل (72 ساعة) | — |
| التفعيل `/activate` | مدير الشركة يعيّن كلمة المرور ثم يضيف مستخدمي شركته | — |
| الإيقاف / إعادة التفعيل | يقطع جلسات الشركة فوراً | `SUSPENDED` ↔ `ACTIVE` |

## 2. رمز الشركة
`أول 5 أحرف من اسم الشركة` + `آخر 5 أرقام من الجوال` + `تاريخ الاشتراك DDMMYYYY` (بتوقيت الرياض)

```
RuknHacpp + 0566477687 + 23-10-2026  →  RuknH | 77687 | 23102026  →  RuknH7768723102026
```
- تُتجاهَل المسافات والرموز والأرقام في الاسم، ويُحافَظ على حالة الأحرف، والأسماء العربية مدعومة (`ركن الضيافة` ← `ركنال…`). الاسم الأقل من 5 أحرف يُكمَّل بـ `X`.
- الرمز **فريد**: لا يُقبل طلب ثانٍ بنفس الرمز أو نفس البريد ما لم يكن الطلب السابق مرفوضاً. المطابقة عند الدخول لا تعتمد حالة الأحرف.
- منصة الإدارة نفسها رمزها `DARHACCP`.

## 3. تسجيل الدخول — بالبريد فقط (رابط + رمز OTP)
1. يكتب المستخدم **بريده الرسمي فقط** (لا كلمة مرور ولا رمز شركة — البريد فريد على مستوى المنصة).
2. إن كان البريد مسجلاً لحساب نشط تصله **رسالة واحدة** من `darhaccp@darhaccp.com` فيها:
   - زر **«الدخول الآن»** (رابط بضغطة واحدة `…/magic?c=…&t=…`)،
   - و**رمز تحقق من 6 أرقام** يكتبه في صفحة الدخول بدلاً من الرابط.
3. الرابط والرمز صالحان **5 دقائق** و**لمرة واحدة**؛ استخدام أحدهما يُبطل الآخر.

الحماية:
- **رد موحّد:** الصفحة تعرض «تحقق من بريدك» سواء كان البريد مسجلاً أم لا — لا يمكن اكتشاف الحسابات. النتيجة الحقيقية في سجل المحاولات.
- **شركة قيد المراجعة/موقوفة:** تصلها رسالة توضّح الحالة بدل رمز الدخول.
- **منع إغراق البريد:** رسالة جديدة كل 60 ثانية كحد أقصى (الطلب المتكرر يُعيد استخدام الرسالة السابقة)، و10 رسائل لكل 15 دقيقة.
- الرابط والرمز لا يُخزَّنان (HMAC فقط)، 5 محاولات خاطئة تقفل الجلسة.
- **كل محاولة** (طلب الرابط، الدخول بالرابط، الرمز، إعادة الإرسال — الناجحة والفاشلة) تُسجَّل في `login_attempts` مع IP والمتصفح، والجدول **غير قابل للتعديل أو الحذف**.
- **رابط الشركة** `…/c/<رمز الشركة>` يُرسل عند الاعتماد ويفتح صفحة دخول باسم الشركة والبريد معبأ.
- **البريد لا يتكرر نهائياً**: بريد المشترك لحساب واحد فقط في كل المنصة.

## 4. عزل بيانات الشركات
- كل جدول تشغيلي فيه `tenant_id` يُملأ تلقائياً من جلسة الطلب.
- **PostgreSQL Row-Level Security**: سياسة على كل جدول تسمح فقط بصفوف شركة الجلسة — حتى لو نسي استعلام في الكود شرط الشركة لا يمكنه قراءة أو كتابة بيانات شركة أخرى.
- الـ API يعمل بدور قاعدة بيانات مقيّد `dar_app` (بدون `BYPASSRLS`) لأن دور المالك في Neon يتجاوز RLS.
- عمليات النظام فقط (التسجيل، إدارة المنصة، المهام المجدولة، مجسات IoT، روابط الطباعة الموقّعة) تعمل في نطاق نظام صريح.
- مدير المنصة **لا يرى** البيانات التشغيلية للشركات — فقط بيانات الاشتراك وسجل الدخول.

## 5. البريد الإلكتروني
`EMAIL_PROVIDER=smtp` عبر Hostinger (`smtp.hostinger.com:465`، المرسل `darhaccp@darhaccp.com`). بدائل مدعومة: `resend`. وضع `log` للتطوير فقط ولا يرسل شيئاً (ويرفض العمل في الإنتاج).

| المتغير | القيمة |
|---|---|
| `EMAIL_PROVIDER` | `smtp` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.hostinger.com` / `465` / `true` |
| `SMTP_USER` / `SMTP_PASS` | `darhaccp@darhaccp.com` / كلمة مرور صندوق البريد |
| `EMAIL_FROM` | `DarHaccp <darhaccp@darhaccp.com>` |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | حساب مدير المنصة الأول |
| `APP_URL` | رابط الموقع (لروابط التفعيل) |

## مديرو المنصة (Platform administrators)

Console → **👑 مديرو المنصة**. Every platform administrator has the full platform permissions: reviewing, approving and editing companies, the form library, the health certificate guide, the login-attempts log, and managing the other administrators.

- **Adding:** a name and an e-mail. The e-mail must not be used by any user or any non-rejected company, and it is normalised (trimmed, lower case) before validation. The new administrator gets employee number `PLT-00N`, no password, and a notice e-mail with the console link. The addition is in the audit trail.
- **Signing in:** the same as everyone else: type the e-mail, then use the link or the 6-digit code that arrives in that mailbox. The mailbox must therefore be real and controlled by the person.
- **Suspending / restoring:** a suspended administrator loses the session at once and cannot sign in. You cannot suspend your own account.
- **Not the same as a company admin:** a platform administrator cannot read a company's operational data (the dashboard answers 403).

API: `GET /platform/admins`, `POST /platform/admins`, `PATCH /platform/admins/:id`.

## صفحة دخول الإدارة (`/admin`)

A separate sign-in page for platform administrators: `https://dar-haccp.vercel.app/admin`.

- Same password-less flow: type the administrator e-mail, then use the login link or the 6-digit code from the mailbox.
- Sent with `portal: "PLATFORM"` to `POST /auth/login`. The server then serves platform administrators only.
- **No account discovery:** an administrator, a company user and an unknown e-mail all get the same answer. Only an administrator receives a message.
- No company notices are sent from this page, and a company code is ignored.
- A refused attempt (a non-administrator, or a suspended one) is recorded in the login-attempts log as `NOT_PLATFORM_ADMIN`, so the administrators can see who tried.
- An administrator who is already signed in is sent to the console; a company user is sent to their own home.
- Notices to administrators (new company registrations, being added as an administrator) link to this page.
- The company sign-in page (`/login`) is unchanged and still works for everyone, including administrators.
