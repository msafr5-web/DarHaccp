# سجل الشهادات الصحية (بلدي) — Balady health certificates register

Screen: Modules → **🪪 سجل الشهادات الصحية (بلدي)** (`/health-register`). It mirrors the establishment's Balady follow-up sheet column for column.

| # | Column | Storage / rule |
|---|---|---|
| 1 | م | `serial`. New workers are appended. |
| 2 | اسم المنشأة / الفرع | Required. |
| 3 | رقم رخصة بلدي | Digits only. **One license per branch**: a second number for the same branch is refused. |
| 4 | القسم / النشاط الداخلي | Free text. |
| 5 | اسم العامل (حسب الهوية) | Required. |
| 6 | رقم الهوية / الإقامة | 10 digits, starting with `1` (national ID) or `2` (iqama). Stored AES-256-GCM encrypted, with an HMAC blind index so it is unique per company. Shown masked (`••••••6789`). Only the admin and the HSE officer can reveal the full number, and every reveal is audited. |
| 7 | تاريخ الميلاد | Accepts `DD/MM/YYYY`, `YYYY/MM/DD` (as written in the sheet), `YYYY-MM-DD` and Arabic-Indic digits. Ages 15–90. |
| 8 | المهنة بالرخصة | Free text. |
| 9 | رقم الجوال | Normalised to `05XXXXXXXX`; `+9665…` is accepted. |
| 10 | تاريخ الفحص الطبي | Cannot be in the future. |
| 11 | حالة الفحص | سليم (معتمد) / بانتظار النتيجة / غير لائق. |
| 12 | تاريخ انتهاء الشهادة | Must be after the exam date. |
| 13 | حالة الشهادة | **Computed, never typed** (see below). |
| 14 | ملاحظات التنفيذ | Free text. |

**How «حالة الشهادة» is computed:**

- غير لائق (the exam result is unfit)
- تجديد مطلوب (the exam is pending, or there is no expiry date)
- منتهية (the expiry date has passed)
- قريب الانتهاء (≤ `HEALTH_CERT_WARNING_DAYS`, 30 days)
- سارية (otherwise)

A pending exam is never shown as a valid certificate, even when an expiry date is filled in.

**Import (Excel `.xlsx` or CSV):**

- Reads the establishment's own sheet: CSV in UTF-8 or Windows-1256, separated by `;` or `,`, with title lines before the header row.
- Workers are matched on their ID number. Empty template rows (serial and branch only) are skipped.
- The import first returns a preview with:
  - new and updated workers;
  - an error for each row;
  - warnings: a status written in the file that contradicts the computed one, or a pending exam that has an expiry date.
- Applying is all or nothing.

**Export:**

- The same title and 14 columns, with the computed status colour-coded, plus a summary sheet (by status and by branch).
- Full ID numbers appear only for the admin and the HSE officer, and the export is audited.

**Alerts:** the daily job raises `HEALTH_REGISTER` alerts:

| Situation | Severity |
|---|---|
| Expired certificate, or unfit worker | HIGH |
| Exam result pending, or certificate expiring within 7 days | MEDIUM |
| Certificate expiring within 30 days | LOW |
