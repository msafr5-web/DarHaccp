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

## دليل الشهادة الصحية (Health certificate guide)

Screen: Modules → **📚 دليل الشهادة الصحية** (`/health-guide`). It has the four tabs of the establishment's workbook.
The data is stored in the database as reference tables that every company reads and that only the platform administrator edits
(console → **📚 دليل الشهادة الصحية**).

| Tab | Table | Content |
|---|---|---|
| ملخص المتطلبات | `hc_requirements` | Fee 60 SAR, validity one year, renewal 60 days before expiry, fit medical report, the verifications (profession, shop licence, licence activity), the sponsorship declaration, health education (the 12 cities where it is active, and the retake rule 150 SAR), the Riyadh and Eastern region redirect, printing, support, and penalties. |
| الأنشطة المستهدفة | `hc_activities` | Restaurants, cafés, bakeries, food retail, men's salons, women's beauty salons, laundries, and relaxation and body-care centres. Each has keywords used to suggest an activity for every worker. |
| الفحوصات الطبية | `hc_medical_tests` | Clinical examination, stool, blood and urine tests, chest X-ray, and throat swab. |
| خطوات الإصدار | `hc_issuance_steps` | The nine steps of the Balady user guide. Five of them are milestones that the register tracks. |

**Sources and reliability.** Every item points to the page it was read from (`hc_sources`, read on 2026-10-23) and carries a level:

- **رسمي (OFFICIAL):** stated on a Ministry of Municipal, Rural Affairs and Housing / Balady page.
- **منقول (REPORTED):** published by medical centres as their practice. The official pages do not list the individual tests; they only require a fit report from a centre approved by the Ministry of Health. The tab says so, and every test is marked non-official.
- **غير مؤكَّد (UNVERIFIED):** a reasonable reading that no page states, for example the central-kitchen activity. It carries a note telling the user to check the licence activity.

Where the pages give no value, the guide says so rather than filling the gap. This applies to fine amounts. The list of approved medical centres could not be read either, so it is not included.

**Effect on the register.**

- *Activity:* each worker's activity is suggested from the profession and section text, and can be set by hand.
- *Renewal window:* «التجديد متاح» appears when 60 days or fewer remain, or the certificate has expired.
- *Process tracker:* new fields per worker: city, Balady request number, health-education result, and the date the fee was paid. From them the system computes the **next step**:
  - Request, medical exam, health education, fee, and issue.
  - Health education is skipped outside the active cities.
  - An unfit result or a failed education test blocks the steps after it.
  - A certificate in force means every step is done.
- These tracking fields are not columns of the Balady sheet. They are not in the Excel export, and re-importing the sheet keeps them.
- *Privacy:* the system stores **no medical test results**, only the official fit / pending / unfit outcome.

**Keeping it current.**

- The platform administrator edits any item. It is stamped with the verification date and is no longer touched by automatic updates.
- Items the administrator has not edited are refreshed when a new revision of `healthGuideSeed.ts` is deployed.
