# مطابقة الدليل الفني v2 (HACCP & GDP) — Compliance matrix

This document maps every requirement of *Technical PRD & ER Architecture (HACCP & GDP)* to its implementation and to the automated test that proves it. The tests are 279 API checks plus browser tests.

The platform implements the controls and keeps the evidence that SFDA GDP inspections, HACCP (Codex) and ISO 22000 / ISO 9001 audits look for. Certification itself is issued by the regulator or certification body after an on-site audit.

## 1. Inbound receiving — `INBOUND_SHIPMENT`

| PRD requirement | Implementation | Test |
|---|---|---|
| `shipment_id` is a UUID | The record id (`gen_random_uuid`). | ✓ |
| `receiving_date` is automatic and cannot be in the future | Server timestamp. A device time is accepted only up to 24 h in the past, and no more than 5 min ahead. | ✓ |
| `po_number` is alphanumeric and unique per shipment | `pattern` + `unique` rules. | *duplicate PO refused*, *pattern enforced* |
| Supplier must be on the Approved Vendor List | `companyOptions` list maintained by the company. Any other supplier is refused. | *supplier outside the list refused* |
| `vehicle_temp`: CCP limits are frozen ≤ −18 °C and chilled 2–8 °C, with an immediate alarm | `limitsBy` on the product category plus `critical`. A breach raises a CRITICAL alert, push notification, e-mail and the in-app audible alarm, and opens a CAPA. | *chilled 12 °C*, *frozen −10 °C*, *audible alarm* |
| `transport_status` is computed | `compute: compliance`. Any value sent by the client is ignored. | *forged computed value ignored* |
| `acceptance_status`: a **Reject opens an NCR** | `onCriticalDeviation: Rejected` (a breach forces rejection). `ncrWhen: Rejected` opens a NON_CONFORMITY incident (NC-YYYY-#####) linked to the record and to its CAPA. | *rejected shipment opens an NCR*, *one CAPA only* |

## 2. Batch inspection — `BATCH_INSPECTION`

| PRD requirement | Implementation | Test |
|---|---|---|
| `item_code` is a **foreign key** to the Item Master | `itemRef`: the code must exist and be active in `items`. The name is filled from the master. | *unknown item code refused*, *name filled from the master* |
| `batch_number` is **indexed** for traceability | Expression index `ix_records_batch_number`, plus the **🔎 تتبع التشغيلة** screen and `GET /traceability`. | *batch traceability* |
| `expiry_date > mfg_date`, otherwise saving is refused | `after` rule, returning 422. | *strict refusal* |
| `coa_verified = false` means the shipment is not accepted | Critical deviation, alert and CAPA, plus an NCR (`ncrWhen: false`). | *missing CoA → NCR* |

## 3. Environmental monitoring — `ENV_MONITORING`

| PRD requirement | Implementation | Test |
|---|---|---|
| A reading **every 2 hours**, with an administrative alert after **2 h 30** without one | `max_gap_minutes = 150` (and `min_daily_entries = 12`). The gap is checked per data logger, or per form when no logger is linked. It raises a HIGH `MONITORING_OVERDUE` alert, and the next reading resolves it immediately. | *overdue alert*, *resolved by the next reading* |
| Zones, including the sensitive medicines room at 2–8 °C | Zone types: chilled, frozen, dry, and sensitive medicines 2–8 °C. Humidity ≤ 60 % for dry and sensitive rooms. | *sensitive room 9 °C critical* |
| `sensor_id` from the data logger | Pre-filled from the data logger's QR code. Smart-probe key: `POST /iot/readings`. | *data-logger QR* |
| Audible alarm or instant message to the quality manager | CRITICAL/HIGH alerts trigger: an in-app audible alarm and banner, push notifications, and an e-mail to the company admin and HACCP officers. | *audible alarm banner* |
| `compliance_status` is computed | `compute: compliance`. | ✓ |

> **How often the 2-hour gap is checked:**
> - Whenever a company user opens alerts, the dashboard or the device list (at most every 5 min per company).
> - In the daily scheduled job.
>
> For a check every 10–15 minutes around the clock, point an external scheduler at `GET /api/v1/internal/cron/monitoring` with `Authorization: Bearer <CRON_SECRET>`.

## 4. Inventory & FEFO engine — `INVENTORY_STOCK` and `STOCK_ISSUE`

| PRD requirement | Implementation | Test |
|---|---|---|
| `current_quantity ≥ 0` | `validMin: 0`, plus a `CHECK` constraint on `stock_batches`. | *negative quantity refused* |
| `days_remaining` = expiry − today | `compute: daysUntil`, using the company's time zone. | ✓ |
| `expiry_alert_status`: Safe / Expiring Soon (≤ 7 days) / Expired | `compute: expiryStatus`. Expiring Soon is a deviation; Expired is critical. | ✓ |
| **The FEFO engine enforces the issue order** | `stock_batches` holds the balance per item and batch, and `stock_movements` is an append-only ledger. A stock count (`count`) sets the batch balance. An issue (`issue`) is refused when the batch is **not the earliest-expiring available one** (409 `FEFO_ORDER`, naming the batch to issue first), when it is **expired** (`FEFO_EXPIRED`), when it is **above the balance**, or when it is **unknown**. Stock records are never amended (`STOCK_RECORD`). | *FEFO order / expired / balance / unknown / ledger* |
| Prevent issuing expired stock | Refused by the engine. Daily `STOCK_EXPIRY` alerts flag expired stock (HIGH) and stock expiring within 7 days (MEDIUM). | *expired stock alerts* |

## 5. Monthly consumption — `MONTHLY_CONSUMPTION`

| PRD requirement | Implementation | Test |
|---|---|---|
| `period_month` as YYYY-MM, with no duplicate of the same item in the same month | `month` type plus `unique` on (month + item). | *one summary per month and item* |
| `opening_balance` carried from the previous closing balance | `carryFrom: closing_balance` on the same item. Read-only on the form; any value sent by the client is ignored. | *opening balance carried* |
| `closing_balance` = Opening + Inbound − Consumption − Waste | `compute: sum`. A negative result is refused. | *closing balance*, *negative refused* |
| `fefo_compliance_rate` target **≥ 98 %** | `min: 98`. A lower rate is a deviation and opens a CAPA. | *97 % < 98 %* |

## 6. Regulatory and quality-system alignment

| Requirement | Where in the platform |
|---|---|
| **HACCP principles 1–7 (Codex):** hazards and CCPs, critical limits, monitoring, corrective actions, verification, records | CCP plan with hazard types; field rules; QR / IoT monitoring; automatic CAPA (verified by an officer); internal audits; append-only records with amendment history |
| **SFDA GDP:** temperature-controlled storage and transport, monitoring and data loggers, calibration | Environmental and vehicle CCPs; 2-hourly gap alerts; device register with a calibration and maintenance log; out-of-service devices refuse their form |
| **SFDA GDP:** approved suppliers, CoA, quarantine and rejection | Approved vendor list; CoA check; rejection → NCR |
| **SFDA GDP:** FEFO, expired stock, traceability and recall | FEFO engine; expiry alerts; batch traceability (receipt → inspection → counts → where it was issued) |
| **Quality management (ISO 9001 / 22000):** NCR / CAPA, document control, internal audits, record integrity (ALCOA+) | Incidents and NCR with CAPA; controlled documents; internal audits. Records are attributable (employee, device, time, site). Amendments need a reason, keep the original, and are protected by a DB trigger. Full audit trail. |
