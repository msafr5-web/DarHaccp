# مصفوفة تتبع المتطلبات — PRD & SWOT ← التنفيذ

توضح هذه الوثيقة كيف تحقق كل متطلب في وثيقة متطلبات المنتج (PRD) وتحليل SWOT داخل الكود، مع مسار الملف ونوع التحقق.
**مفتاح الحالة:** ✅ منفّذ ومختبَر آلياً · 🟡 منفّذ جزئياً / يحتاج قراراً تشغيلياً · ⏳ خارج نطاق هذه المرحلة.

## 1. الهندسة المعمارية وهيكل المشروع

```
DarHaccp/
├── api/index.js                      # نقطة دخول Vercel (Serverless) — نفس النطاق للواجهة والـ API
├── vercel.json                       # البناء + التوجيه + Cron اليومي
├── docker-compose.yml                # تشغيل على VPS داخل المملكة (PostgreSQL + API + نسخ احتياطي)
├── backend/                          # Node.js + Express 5 + TypeScript + PostgreSQL
│   ├── database/migrations/          # 001_init.sql · 002_prd_modules.sql
│   └── src/
│       ├── config/       env (Zod) · database (معاملات + سياق التدقيق) · permissions (RBAC) · logger
│       ├── controllers/  auth · users · haccp · capa · alerts · qr · dashboard · equipment · health certs
│       │                 staff · quality (حوادث + تدقيق داخلي) · confectionery (وصفات + بطاقات) · hse · iot · audit
│       ├── middlewares/  auth (JWT + RBAC + عزل الأقسام + Cron) · security (Helmet/CORS/Rate limit) · validate · errorHandler
│       ├── models/       طبقة الوصول للبيانات (SQL مُعلَّم بالكامل)
│       ├── routes/       /auth /kitchens/:department /haccp /capas /alerts /qr /dashboard /staff /incidents
│       │                 /internal-audits /recipes /labels /contractors /documents /iot /audit-logs
│       ├── services/     haccpRules (محرك الحدود الحرجة) · record · capa · quality · auditChecklists
│       │                 qr · alert (SSE + Push) · scheduler · dashboard
│       ├── utils/        crypto (AES-256-GCM + روابط موقّعة) · schemas · scope · http · AppError
│       └── server.ts
├── mobile/                           # Expo (iOS/Android) + PWA للويب — واجهة عربية RTL
│   └── src/
│       ├── app/          (tabs)/[الرئيسية، مسح QR، النماذج، الوحدات، التنبيهات] · form · capa · incidents
│       │                 audits · labels · staff · contractors · documents · login
│       ├── offline.ts    وضع العمل دون اتصال (صندوق إرسال + ذاكرة النماذج)
│       └── hooks/ api/ context/ components/ constants.ts theme/
└── docs/                             # هذه الوثيقة + خطة التعافي من الكوارث
```

## 2. نطاق الموديولات (PRD §2.1)

| # | المتطلب | التنفيذ | الحالة |
|---|---|---|:-:|
| 1 | **الخدمات المساندة و HSE**: سياسات IMS | `documents` (فئة IMS_POLICY) — `hse.controller.ts` | ✅ |
| 1 | سجلات العاملين والشهادات الصحية | `staff` + `health_certificates` — `staff.controller.ts` | ✅ |
| 1 | الطوارئ والسلامة + الكاميرات | نموذج `SAFETY_DAILY` (طفايات، مخارج، إنارة طوارئ، غاز، إسعافات، CCTV) + وثائق `EVACUATION_PLAN` و`FIRE_EXTINGUISHER_LAYOUT` | ✅ |
| 1 | تقييم المقاولين | `contractors` + `contractor_evaluations` (5 معايير → نسبة مئوية؛ "إنهاء" يوقف الاعتماد) | ✅ |
| 1 | أسطول النقل | المعدات من نوع `VEHICLE` + سجل صيانة + نموذج `VEHICLE_CHECK` (≤ 4°م) | ✅ |
| 2 | **المطبخ البارد**: الثلاجات ≤ 4°م | CCP-2 + `FRIDGE_CHECK` + QR لكل ثلاجة + مجسات IoT | ✅ |
| 2 | تعقيم الخضار (~50 ppm + مدة النقع) | CCP-5 (50–200 ppm) + حقل زمن التلامس ≥ 5 د | ✅ |
| 2 | منع المرتجعات الملوثة وإثبات إتلافها | نموذج `RETURNS_DISPOSAL`: «هل أُعيد للمخزون؟» = نعم ⇒ انحراف حرج + CAPA؛ شاهد + سجل غير قابل للتعديل | ✅ |
| 3 | **المطبخ الساخن**: استلام اللحوم | CCP-4 + `MEAT_RECEIVING` (حرارة المنتج والمركبة، الحلال، SFDA) | ✅ |
| 3 | الطهي ≥ 75°م بالمجسات | CCP-1 + `COOKING_CCP1` + واجهة IoT للمجسات | ✅ |
| 3 | التبريد السريع 60→4°م خلال 6 ساعات | CCP-7 + `BLAST_CHILLING`: حقل نوع `time` مع قاعدة مدة `maxMinutes: 360` (يعبر منتصف الليل) | ✅ |
| 3 | الحفظ الساخن | CCP-3 + `HOT_HOLDING` (≥ 63°م) | ✅ |
| 4 | **الحلويات**: الوصفات | `recipes` (مكونات، مسببات حساسية، مدة صلاحية، حرارة حفظ) | ✅ |
| 4 | بطاقات البيانات (إنتاج، مكونات، صلاحية) | `product_labels` بنسخة ثابتة من الوصفة + صفحة طباعة مع QR + منع استخدام المنتج المنتهي | ✅ |
| 4 | نقاط الطبخ والخبز | CCP-8 + `SWEETS_BAKING` (≥ 75°م) | ✅ |
| 4 | تبريد وتعبئة الحلويات | `SWEETS_COOLING_PACKING` (CCP-2 + إرفاق بطاقة البيانات) | ✅ |
| 4 | الألبان والبيض تحت 5°م | `SWEETS_RAW_MATERIALS` (حد 5°م حرج + الصلاحية) | ✅ |
| 5 | **الجودة و CAPA**: التدقيق الداخلي | `internal_audits` + قوائم HACCP/ISO 22000 و ISO 45001 — كل بند غير مطابق ⇒ ملاحظة + CAPA | ✅ |
| 5 | الحوادث وعدم المطابقة | `incidents` (7 أنواع) ⇒ CAPA تلقائي؛ إغلاق CAPA يغلق البلاغ بالسبب الجذري | ✅ |
| 5 | الإجراءات التصحيحية والوقائية | `capas`: مفتوح ← قيد المعالجة ← مغلق ← تحقق (فصل المهام) | ✅ |

## 3. نموذج البيانات (PRD §3)

| كيان PRD | الحقول المطلوبة | الجدول / العمود |
|---|---|---|
| Users & RBAC | user_id, full_name, role, branch_id, status | `users` (+ `branch_id` في 002، `is_active`) + جدول `branches` |
| Staff & Health Certificates | staff_id, name, nationality, id_number, municipality_cert_no, cert_expiry_date, daily_temp_log_reference | `staff` (`id_number_enc` مشفّر AES-256-GCM + `id_number_last4`) · `health_certificates.certificate_no` = شهادة البلدية · المرجع اليومي = آخر سجل `STAFF_DAILY_HEALTH` (`last_daily_check`) |
| HACCP CCPs | ccp_id, department_name, hazard_type, critical_limit, monitoring_frequency | `ccps` (+ `hazard_type` BIOLOGICAL/CHEMICAL/PHYSICAL/ALLERGEN، `min_value`/`max_value`) |
| Monitoring & Daily Logs | log_id, ccp_id, recorded_value, status, corrective_action_taken, recorded_by, timestamp | `monitoring_records` (+ `corrective_action_taken`، `branch_id`، `client_ref`) — غير قابل للتعديل أو الحذف |
| CAPA Management | incident_id, department, description, root_cause, corrective_action, assigned_to, closed_status | `incidents` + `capas.incident_id` |

## 4. المتطلبات الوظيفية (PRD §4)

| المتطلب | التنفيذ | الحالة |
|---|---|:-:|
| تنبيه قبل انتهاء الشهادة الصحية بـ 30 يوماً | `HEALTH_CERT_WARNING_DAYS=30` · المجدول + لوحة التحكم + حالة «غير لائق» تمنع العامل | ✅ |
| إدخال قراءات الثلاجات آلياً أو يدوياً | يدوي/QR + `POST /api/v1/iot/readings` بمفتاح جهاز (SHA-256) | ✅ |
| تنبيهات فورية للإدارة عند الانحراف | تنبيه + CAPA في نفس المعاملة، SSE للوحات، Expo Push للجوال | ✅ |

## 5. المتطلبات غير الوظيفية (PRD §5)

| المتطلب | التنفيذ | الحالة |
|---|---|:-:|
| تشفير أثناء النقل TLS/SSL | HTTPS إلزامي (Vercel) + HSTS preload (Helmet) + SSL لقاعدة البيانات | ✅ |
| تشفير AES-256 في قاعدة البيانات | تشفير القرص AES-256 لدى مزود قاعدة البيانات + تشفير على مستوى الحقل AES-256-GCM لرقم الهوية/الإقامة (`utils/crypto.ts`)؛ فك التشفير لـ HSE/المدير فقط ويُسجَّل `VIEW_SENSITIVE` | ✅ |
| RBAC صارم | 30+ صلاحية دقيقة في `config/permissions.ts` + عزل الأقسام + نطاق لوحة التحكم | ✅ |
| سجل تدقيق لكل إدخال/تعديل | Triggers على كل الجداول (من، متى بدقة الميكروثانية، القيم القديمة/الجديدة، IP) — append-only | ✅ |
| استجابة < 2 ثانية | فهارس على الاستعلامات الرئيسية + Pool اتصالات + ضغط؛ القياس الفعلي على بيئة التجربة: 0.4–0.6 ث للشاشات الرئيسية (≈ 1 ث لأول طلب بعد خمول) | ✅ |
| واجهة متجاوبة للأجهزة اللوحية والجوال | Expo + PWA قابل للتثبيت، تخطيط متجاوب (حد أقصى للعرض، أعمدة متغيرة) | ✅ |
| سيادة البيانات في المملكة | الكود جاهز للتشغيل على VPS محلي عبر `docker-compose.yml`؛ بيئة التجربة الحالية على Vercel/Neon **خارج المملكة** | 🟡 قرار تشغيلي — انظر `DISASTER-RECOVERY.md` |

## 6. معالجة تحليل SWOT

| البند | المعالجة التقنية | الحالة |
|---|---|:-:|
| ضعف: انقطاع الإنترنت (Offline Mode) | ذاكرة نماذج على الجهاز + صندوق إرسال بوقت القياس الحقيقي + إعادة إرسال تلقائية + منع التكرار عبر `client_ref` (مقبول حتى 24 ساعة) | ✅ |
| ضعف: مقاومة التغيير | مسح QR بدل البحث، حدود حرجة تظهر أثناء الكتابة، رسائل عربية، إجراء فوري مقترح | ✅ |
| ضعف: تعقيد سير العمل | محرك قواعد عام (حقول + حدود + مدد) — نموذج جديد = بيانات وليس كوداً | ✅ |
| فرصة: إنترنت الأشياء | مفاتيح أجهزة لكل معدّة + نفس منطق التقييم والتنبيه و CAPA | ✅ |
| فرصة: التوسع لفروع أخرى | جدول `branches` و `branch_id` على المستخدمين والسجلات والبلاغات والبطاقات | ✅ |
| تهديد: تغيّر اشتراطات SFDA | الحدود الحرجة في جدول `ccps` (تعديلها يُسجَّل في التدقيق) والنماذج بإصدارات | ✅ |
| تهديد: الهجمات السيبرانية | Helmet/CSP، Rate limiting، قفل الحساب، إلغاء الجلسات، روابط طباعة موقّعة قصيرة العمر، تشفير الحقول الحساسة | ✅ |
| تهديد: تعطل الخوادم | نسخ احتياطي يومي آلي (Docker) + PITR لدى Neon + خطة استعادة موثقة | ✅ |

## 7. الاختبار

اختبار تكامل آلي من البداية للنهاية: **100 فحص** يغطي كل ما سبق على PostgreSQL مضمّن (الصلاحيات، عزل الأقسام، QR، الحدود الحرجة والمدد، المرتجعات، وضع عدم الاتصال، التشفير، الحوادث، التدقيق، البطاقات والطباعة الموقّعة، المقاولين، الوثائق، IoT، لوحة التحكم، عدم قابلية السجلات للتعديل).

## 8. خارطة الطريق (PRD §6) — موقع المشروع

| المرحلة | النطاق | الحالة |
|---|---|:-:|
| 1 — النواة وقاعدة البيانات | المصادقة، الصلاحيات، مخطط البيانات | ✅ |
| 2 — موديولات الأقسام | الساخن، البارد، الحلويات، المساندة | ✅ |
| 3 — نقاط الهاسب والتنبيهات | CCPs، التنبيهات الفورية، CAPA | ✅ |
| 4 — الاختبار التجريبي والإطلاق | تدريب المشرفين، UAT، الإطلاق الرسمي | ⏳ يتطلب فريق التشغيل |
