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

## Equipment and data loggers (الأجهزة ومسجلات البيانات)

Screen path: Modules → **📟 الأجهزة ومسجلات البيانات**.

- Managed by the company admin, HACCP officer and HSE officer. Other staff see a read-only list of their own department.

### Adding a device

When adding a device, you set:

- A number. It is fixed after creation, and appears on the label and in every record.
- A name and a type.
- A department and a location or zone.
- The monitoring form its QR code opens. The form must be one this department may use.
- The preventive-maintenance interval.

### On each device

- **QR label:**
  - A preview of the label.
  - **Print** it (A4, small or large), or **share the link**.
  - **Fill the form now.**
  - **Issue a new code** for a lost or damaged label. The old code stops working at once.
- **Status:** an *out of service* device refuses to open its form.
- **Maintenance and calibration:** a history, and the next due date is updated.
- **Smart probe (company admin only):** issue an IoT API key, shown once.
- **Archive:** the device leaves the lists and its code stops working. Its records are kept.

### Device list

- Today's readings against the minimum frequency (for example `اليوم 1 / 2`).
- Maintenance that is due or overdue.
- Select several devices to print their labels together, or print all.

### API

| Endpoint | Purpose |
|---|---|
| `GET /equipment?search=&type=&department=` | Device list |
| `POST /equipment`, `PATCH /equipment/:id` | Add / edit a device |
| `GET /equipment/:id/maintenance`, `POST /equipment/:id/maintenance` | Maintenance history / log a maintenance |
| `POST /qr/labels-data` | QR images for in-app display and printing |
| `POST /qr/equipment/:id/rotate` | Issue a new QR code |
| `POST /equipment/:id/device-key` | Issue a smart-probe key |
| `GET /kitchens/:dept/records?equipmentId=` | Readings of one device |

## Item master ⇄ Excel (جدول الأصناف — Excel)

Screen: **📚 جدول الأصناف الرئيسي** → **📊 Excel**.

- **Export:** `GET /items/export.xlsx` returns a right-to-left workbook with:
  - dropdowns for the storage condition and the status;
  - read-only columns for the current stock and the number of batches;
  - an instructions sheet.
- **Template:** `GET /items/export.xlsx?template=true` returns a blank workbook with one example row.
- **Import / update:** `POST /items/import` takes the raw `.xlsx` file as the request body (max 4 MB, up to 5,000 items).
  - The import first returns a preview: new items, updated items with the changed fields, unchanged items, and an error for each row.
  - `?apply=true` applies everything in one transaction. If any row has an error, nothing is applied.
  - The item code is the key: a new code creates an item, an existing code updates it. Empty cells keep the current values.
  - Items are never deleted. Use the status column (`نشط` / `موقوف`) instead.
  - Every change is recorded in the audit trail.
- **Permissions:** importing needs `item:manage` (company admin, HACCP officer, kitchen supervisor). Exporting is open to every company user.
