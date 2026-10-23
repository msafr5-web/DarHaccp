# دار الضيافة — منصة سلامة الغذاء والجودة المتكاملة (IMS & HACCP)

> 🏢 **منصة SaaS متعددة الشركات (التسجيل، رمز الشركة، OTP، العزل):** [docs/SAAS.md](docs/SAAS.md)
>
> 📋 **مطابقة وثيقة المتطلبات (PRD) وتحليل SWOT:** [docs/PRD-TRACEABILITY.md](docs/PRD-TRACEABILITY.md) · **خطة التعافي من الكوارث:** [docs/DISASTER-RECOVERY.md](docs/DISASTER-RECOVERY.md)

منصة رقمية تستبدل السجلات الورقية في المطابخ المركزية لشركة دار الضيافة (المطبخ الساخن، المطبخ البارد، الحلويات، الخدمات المساندة):

- **Backend** — `Node.js + Express 5 + TypeScript + PostgreSQL`
- **Mobile** — تطبيق `Expo / React Native` (عربي RTL) لمسح رموز QR وتعبئة النماذج الرقمية ومتابعة التنبيهات والإجراءات التصحيحية

---

## هيكل المشروع

```
DarHaccp/
├── backend/
│   ├── database/migrations/001_init.sql   # مخطط PostgreSQL + Triggers التدقيق وعدم قابلية التعديل
│   ├── src/
│   │   ├── config/        # env (Zod) · database (Pool + transactions) · logger · permissions (RBAC)
│   │   ├── controllers/   # auth · users · haccp · capa · alerts · qr · dashboard · health certs · equipment · audit
│   │   ├── middlewares/   # auth (JWT + RBAC + عزل الأقسام) · security (Helmet/CORS/Rate limit) · validate · errorHandler
│   │   ├── models/        # طبقة الوصول للبيانات (SQL)
│   │   ├── routes/        # مسارات /api/v1 (بما فيها /kitchens/:department)
│   │   ├── services/      # محرك قواعد الهاسب · QR · التنبيهات (SSE + Push) · CAPA · الجدولة · التحليلات
│   │   ├── db/            # migrate · seed (خطة HACCP مرجعية + حسابات تجريبية)
│   │   ├── app.ts
│   │   └── server.ts
│   ├── Dockerfile
│   └── .env.example
├── mobile/
│   └── src/
│       ├── app/           # Expo Router: login · (tabs)/[الرئيسية، مسح QR، النماذج، التنبيهات] · form · capa/[id]
│       ├── api/  context/  components/  theme/
│       └── notifications.ts
└── docker-compose.yml
```

## قاعدة البيانات (ERD مختصر)

| الجدول | الوصف |
|---|---|
| `departments` | HOT · COLD · SWEETS · SUPPORT |
| `users` | الأدوار: ADMIN, HACCP_OFFICER, HSE_OFFICER, KITCHEN_SUPERVISOR, CHEF — الشيف والمشرف مرتبطان إلزامياً بقسم |
| `ccps` | نقاط التحكم الحرجة وحدودها (min/max) والإجراء الفوري |
| `form_templates` | النماذج الرقمية (حقول JSONB بحدودها) + `qr_token` فريد + إصدار |
| `equipment` / `maintenance_logs` | الأجهزة (ثلاجات، أفران…) برمز QR خاص بكل جهاز + سجل الصيانة |
| `monitoring_records` | السجلات اليومية — **غير قابلة للتعديل أو الحذف** (Trigger) |
| `alerts` | تنبيهات الانحرافات/انتهاء الشهادات/الصيانة (تنبيه مفتوح واحد لكل مصدر) |
| `capas` | الإجراءات التصحيحية والوقائية: OPEN → IN_PROGRESS → CLOSED → VERIFIED |
| `health_certificates` | الشهادات الصحية للعاملين |
| `audit_logs` | سجل التدقيق — append-only بدقة الميكروثانية |

### آلية التدقيق (Audit Trail)
كل عملية `INSERT/UPDATE/DELETE` على الجداول الرئيسية تُسجَّل تلقائياً عبر Trigger في PostgreSQL مع: المستخدم، القيم القديمة والجديدة، الحقول المتغيرة، عنوان IP، الـ User-Agent، ومعرّف الطلب. يتم تمرير هوية المستخدم من الـ API إلى قاعدة البيانات عبر `set_config('app.current_user_id', …)` داخل كل معاملة، لذلك لا يمكن لأي كود أن ينسى التسجيل. كلمات المرور وتوكنات الإشعارات لا تُحفظ في السجل، وأحداث الدخول/الدخول الفاشل/مسح QR تُسجَّل أيضاً.

## منطق الهاسب (CCP)

| CCP | الحد الحرج | القسم |
|---|---|---|
| CCP-1 الطهي | ≥ 75°م | الساخن |
| CCP-2 التخزين المبرد | ≤ 4°م | جميع الأقسام |
| CCP-3 الحفظ الساخن | ≥ 63°م | الساخن |
| CCP-4 استلام اللحوم المبردة | ≤ 4°م | المساندة |
| CCP-5 تعقيم الخضار | 50–200 ppm | البارد |
| CCP-6 التخزين المجمد | ≤ -18°م | جميع الأقسام |

عند إرسال سجل: يُتحقق من البيانات وفق تعريف النموذج (Zod ديناميكي)، ثم تُقارن القراءة بحدود الـ CCP (مصدر واحد للحقيقة) وبقية الفحوصات (نعم/لا، حدود الحقول). عند أي انحراف (**FAIL**) يتم ضمن **نفس المعاملة**: حفظ السجل + إنشاء تنبيه + فتح CAPA مسندة لمشرف القسم (استحقاق 24 ساعة للانحراف الحرج)، ثم يُبث التنبيه فوراً عبر **SSE** للوحات التحكم و**Expo Push** للجوال.

## الصلاحيات (RBAC)

| الصلاحية | ADMIN | HACCP | HSE | SUPERVISOR | CHEF |
|---|:-:|:-:|:-:|:-:|:-:|
| تسجيل القراءات / مسح QR | ✓ | ✓ | ✓ | قسمه | قسمه |
| تحديث وإغلاق CAPA | ✓ | ✓ | | قسمه | |
| التحقق من CAPA (شخص غير الذي أغلقها) | ✓ | ✓ | | | |
| إدارة CCP والنماذج و QR | ✓ | ✓ | | | |
| الشهادات الصحية | ✓ | ✓ | ✓ | عرض | |
| الأجهزة والصيانة | ✓ | | ✓ | عرض | عرض |
| لوحة التحكم | ✓ | ✓ | ✓ | قسمه | |
| سجل التدقيق | ✓ | ✓ | | | |
| إدارة المستخدمين | ✓ | | | | |

## واجهات API الرئيسية (`/api/v1`)

| Method | Path | الوصف |
|---|---|---|
| POST | `/auth/login` | تسجيل الدخول (JWT) — قفل الحساب بعد 5 محاولات |
| GET | `/auth/me` · POST `/auth/change-password` · PUT `/auth/push-token` | |
| GET/POST | `/kitchens/{hot\|cold\|sweets\|support}/records` | سجلات القسم (معزولة حسب القسم) |
| GET/POST/PATCH | `/haccp/ccps` · `/haccp/templates` | خطة الهاسب والنماذج |
| POST | `/qr/resolve` | يستقبل محتوى رمز QR من الجوال ويعيد النموذج الرقمي (مع الحدود الحرجة) |
| GET | `/qr/{templates\|equipment}/:id/image?format=png\|svg` | صورة QR |
| POST | `/qr/{templates\|equipment}/:id/rotate` | إلغاء ملصق مفقود وإصدار رمز جديد |
| GET | `/qr/labels?target=templates\|equipment` | صفحة ملصقات قابلة للطباعة |
| GET/PATCH/POST | `/capas` · `/capas/:id` · `/capas/:id/close` · `/capas/:id/verify` | دورة CAPA |
| GET/POST | `/alerts` · `/alerts/stream` (SSE) · `/alerts/:id/acknowledge` · `/alerts/:id/resolve` | |
| GET | `/dashboard/overview` | نسب الامتثال اليومية لكل قسم، الانحرافات، CAPA، الشهادات، الأجهزة |
| GET | `/dashboard/compliance-trend?days=30` · `/dashboard/deviations` | الاتجاهات وتحليل الانحرافات |
| GET | `/dashboard/health-certificates` | ساري / ينتهي خلال 30 يوماً / منتهي |
| GET | `/dashboard/equipment` | حالة الأجهزة والصيانة المستحقة والمتأخرة |
| CRUD | `/health-certificates` · `/equipment` · `/equipment/:id/maintenance` · `/users` | |
| GET | `/audit-logs` | سجل التدقيق مع فلاتر |

كل الاستجابات بصيغة موحدة: `{ success, data, meta? }` أو `{ success: false, error: { code, message, details?, requestId } }`.

## الأمان
Helmet (CSP, HSTS…) · CORS بقائمة بيضاء · Rate limiting عام + خاص بتسجيل الدخول · bcrypt (12) · سياسة كلمات مرور · قفل الحساب · إلغاء التوكنات عند تغيير كلمة المرور أو تعطيل الحساب · استعلامات SQL مُعلمة بالكامل · التحقق من كل المدخلات بـ Zod · رموز QR عشوائية 144-bit غير قابلة للتخمين · سجلات الهاسب والتدقيق غير قابلة للتعديل.

## التشغيل

### Backend
```bash
cd backend
cp .env.example .env          # عدّل JWT_SECRET و DATABASE_URL
npm install
npm run db:migrate
npm run db:seed               # بيانات مرجعية + حسابات تجريبية
npm run dev                   # http://localhost:4000
```
أو بالكامل عبر Docker: `cp backend/.env.example backend/.env && docker compose up -d --build` (ثم `docker compose exec api node dist/db/seed.js`).

**حسابات تجريبية** (كلمة المرور = `SEED_ADMIN_PASSWORD`، الافتراضية `ChangeMe!2026` — غيّرها فوراً):
`admin@daraldhiafa.sa` · `haccp@` · `hse@` · `hot.supervisor@` · `cold.supervisor@` · `sweets.supervisor@` · `support.supervisor@` · `hot.chef@` · `cold.chef@` (النطاق `daraldhiafa.sa`).

ملصقات QR للطباعة: سجّل الدخول كمسؤول ثم افتح `GET /api/v1/qr/labels?target=equipment`.

### Mobile
```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<IP-جهازك>:4000/api/v1 npx expo start
```
مسح QR والإشعارات يتطلبان جهازاً حقيقياً. للإشعارات اربط المشروع بـ EAS (`npx eas-cli init`) وفعّل `EXPO_PUSH_ENABLED=true` في الخادم.

## الاختبار
تم اختبار الـ API من البداية للنهاية (54 فحصاً) على PostgreSQL مضمّن: الصلاحيات وعزل الأقسام، مسح QR، سجلات PASS/FAIL، التنبيهات وCAPA، عدم قابلية التعديل، التدقيق، ولوحات التحكم.

## النشر على Vercel
المشروع منشور كـ **مشروع Vercel واحد** (`dar-haccp`) على نطاق واحد:

| المسار | المحتوى |
|---|---|
| `https://dar-haccp.vercel.app/` | تطبيق الويب (PWA قابل للتثبيت) |
| `https://dar-haccp.vercel.app/api/v1/...` | الـ API (Serverless Function من `api/index.js`) |
| `https://dar-haccp.vercel.app/health` | فحص حالة الخادم وقاعدة البيانات |

- الإعدادات في `vercel.json` بجذر المستودع؛ كل `git push` على `main` ينشر تلقائياً، والبناء يطبّق ترحيلات قاعدة البيانات أولاً.
- قاعدة البيانات: Neon Postgres (`dar-haccp-db`) مربوطة بالمشروع وتوفّر `DATABASE_URL`.
- متغيرات البيئة المطلوبة: `JWT_SECRET`, `CRON_SECRET`, `SEED_ADMIN_PASSWORD`, `CORS_ORIGINS`, `DB_POOL_MAX`, `APP_TIMEZONE`.
- **لا تحذف المشروع `dar-haccp` ولا تفصل عنه قاعدة البيانات** — الواجهة والـ API في المشروع نفسه.
- صفحة الدخول تفحص `/api/v1/health` تلقائياً وتعرض حالة الاتصال.
