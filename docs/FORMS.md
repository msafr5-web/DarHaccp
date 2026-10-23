# مكتبة النماذج الرقمية — Form library

The platform administrator maintains a **library of digital forms** (`form_catalog`) and decides which forms each company receives. Each enabled form is a feature of that company, with its own QR code.

## Flow

| Who | Where | What |
|---|---|---|
| Platform admin | Console → **🧩 مكتبة النماذج** | Create forms. Add, remove or reorder fields and edit their rules. Field changes bump the version and reach every company copy that was not customised. |
| Platform admin | Console → company → **النماذج والخصائص المفعّلة** | Enable or disable a form for a company. **الحقول** customises the form for this company only. **إعادة** returns it to the library version. |
| Company admin | **الموظفون والصلاحيات** | Add employees and choose their access: **تعبئة فقط** (`FILL`) or **تعبئة وتعديل** (`FILL_EDIT`). |
| HACCP officer | Forms tab → **⚙ القوائم المعتمدة** | Maintain company-owned lists, such as approved suppliers (`companyOptions` fields). |
| Employee | Phone camera or the in-app scanner | The QR opens `APP_URL/q/<token>`. If not signed in, the employee signs in first and the form then opens automatically. |

## What the form and the record show

- Company name
- Site: equipment location, otherwise the branch
- Device number: the equipment or data-logger code, plus the phone/browser id (`WEB-XXXXXX`)
- Fill time
- Employee name, number and role
- The employee's permission: fill only, or fill and edit

All of these are stored with the record (`device_info`, `recorded_by`, `recorded_at`, `branch_id`, `equipment_id`).

## Amendments (FILL_EDIT)

- A reason is mandatory.
- The previous version goes to `record_revisions`, an append-only table that keeps the values, the author, the time and the reason.
- The record is checked again with the same rules. A new deviation raises an alert and opens a CAPA.
- Kitchen staff can amend only their own records.
- Records captured on an older form version, and IoT readings, cannot be amended.
- The database trigger `guard_record_mutation` refuses any other change, and never allows deletion.

## Field rules (PRD constraints)

| Rule | Example (PRD) | Effect |
|---|---|---|
| `min` / `max`, `critical` | FEFO rate ≥ 95 % | Deviation → alert and CAPA (critical: urgent, also e-mailed) |
| `limitsBy` | Vehicle temperature: chilled 2–8 °C, frozen ≤ −18 °C | Critical limit chosen by another answer |
| `validMin` / `validMax` | Quantity ≥ 0, humidity 0–100 % | Value refused |
| `after` | `expiry_date > mfg_date` | Entry refused |
| `pattern` | ERP purchase-order number | Entry refused |
| `unique`, `uniqueWith` | One PO per shipment; one summary per month and item | 409 |
| `compute` | `transport_status`, `compliance_status`, `days_remaining`, `expiry_alert_status`, `closing_balance` | Calculated by the server; any client value is ignored |
| `carryFrom`, `carryMatch` | Opening balance = previous closing balance of the same item | Carried by the server; read-only on the form |
| `prefill` | `sensor_id` and `zone_location` from the data-logger QR | Filled automatically |
| `onCriticalDeviation` | A shipment with a critical deviation must be `Rejected` | Any other answer is refused |
| `min_daily_entries` | Environmental monitoring at least twice a day | `MISSED_MONITORING` alert on the next morning |

The PRD forms (`backend/src/db/prdForms.ts`, category `WMS_GDP`):

- `INBOUND_SHIPMENT`
- `BATCH_INSPECTION`
- `ENV_MONITORING`
- `INVENTORY_STOCK`
- `MONTHLY_CONSUMPTION`

The kitchen HACCP logs are `is_default`: every new company gets them.
