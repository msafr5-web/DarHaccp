-- =====================================================================
-- 002 — PRD alignment: branches, staff registry, hazard types, quality
--       (incidents & internal audits), confectionery (recipes & data cards),
--       HSE (contractors, controlled documents), IoT and offline sync.
-- =====================================================================

-- ---------- New enum values (not used inside this migration) ----------
ALTER TYPE alert_source  ADD VALUE IF NOT EXISTS 'INCIDENT';
ALTER TYPE alert_source  ADD VALUE IF NOT EXISTS 'LABEL_EXPIRY';
ALTER TYPE alert_source  ADD VALUE IF NOT EXISTS 'CONTRACTOR_EXPIRY';
ALTER TYPE alert_source  ADD VALUE IF NOT EXISTS 'DOCUMENT_REVIEW';
ALTER TYPE record_source ADD VALUE IF NOT EXISTS 'IOT';

-- ---------- Branches (multi-site scalability, PRD §3 users.branch_id) ----------
CREATE TABLE branches (
  id          SMALLSERIAL PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,
  name_ar     VARCHAR(150) NOT NULL,
  name_en     VARCHAR(150) NOT NULL,
  city        VARCHAR(80)  NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
INSERT INTO branches (code, name_ar, name_en, city)
VALUES ('RUH-CK', 'المطبخ المركزي — الرياض', 'Central Kitchen — Riyadh', 'Riyadh');

ALTER TABLE users ADD COLUMN branch_id SMALLINT REFERENCES branches(id);
UPDATE users SET branch_id = (SELECT id FROM branches WHERE code = 'RUH-CK');

-- ---------- HACCP: hazard classification (PRD §3 ccps.hazard_type) ----------
CREATE TYPE hazard_type AS ENUM ('BIOLOGICAL', 'CHEMICAL', 'PHYSICAL', 'ALLERGEN');
ALTER TABLE ccps ADD COLUMN hazard_type hazard_type NOT NULL DEFAULT 'BIOLOGICAL';

-- ---------- Daily logs: branch, corrective action at source, offline/IoT ----------
ALTER TABLE monitoring_records
  ADD COLUMN branch_id SMALLINT REFERENCES branches(id),
  ADD COLUMN corrective_action_taken TEXT,
  -- Client-generated id: offline submissions are retried safely (idempotent).
  ADD COLUMN client_ref UUID;
CREATE UNIQUE INDEX ux_records_client_ref ON monitoring_records (client_ref) WHERE client_ref IS NOT NULL;

-- Backfill the branch on historical records. Records are append-only, so the
-- immutability trigger is lifted only for this one-off schema migration.
ALTER TABLE monitoring_records DISABLE TRIGGER trg_records_immutable;
UPDATE monitoring_records SET branch_id = (SELECT id FROM branches WHERE code = 'RUH-CK');
ALTER TABLE monitoring_records ENABLE TRIGGER trg_records_immutable;

-- ---------- IoT probes: per-device API key (stored as SHA-256 hash) ----------
ALTER TABLE equipment ADD COLUMN device_key_hash VARCHAR(64) UNIQUE;

-- ---------- Staff registry (PRD §3 Staff & Health Certificates) ----------
CREATE TYPE staff_status AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');
CREATE TABLE staff (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no      VARCHAR(30)  NOT NULL UNIQUE,
  full_name        VARCHAR(150) NOT NULL,
  nationality      VARCHAR(60),
  id_number_enc    TEXT,                 -- national ID / iqama, AES-256-GCM encrypted
  id_number_last4  VARCHAR(4),           -- for display & search only
  job_title        VARCHAR(100),
  department_id    SMALLINT NOT NULL REFERENCES departments(id),
  branch_id        SMALLINT REFERENCES branches(id),
  user_id          UUID UNIQUE REFERENCES users(id),
  is_food_handler  BOOLEAN NOT NULL DEFAULT TRUE,
  status           staff_status NOT NULL DEFAULT 'ACTIVE',
  hire_date        DATE,
  phone            VARCHAR(20),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_staff_department ON staff (department_id, status);

-- health_certificates.certificate_no is the Riyadh municipality (Balady) certificate number.
ALTER TABLE health_certificates ADD COLUMN staff_id UUID REFERENCES staff(id);

INSERT INTO staff (employee_no, full_name, department_id, branch_id, user_id)
SELECT DISTINCT ON (h.employee_no) h.employee_no, h.employee_name, h.department_id,
       (SELECT id FROM branches WHERE code = 'RUH-CK'), u.id
  FROM health_certificates h LEFT JOIN users u ON u.employee_no = h.employee_no
 ORDER BY h.employee_no, h.expiry_date DESC
ON CONFLICT DO NOTHING;
UPDATE health_certificates h SET staff_id = s.id FROM staff s WHERE s.employee_no = h.employee_no;

-- ---------- Quality: internal audits (PRD §2.1-5) ----------
CREATE SEQUENCE internal_audit_seq;
CREATE TYPE internal_audit_status AS ENUM ('PLANNED', 'COMPLETED');
CREATE TABLE internal_audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_no        VARCHAR(30) NOT NULL UNIQUE
                    DEFAULT ('IA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('internal_audit_seq')::text, 4, '0')),
  title           VARCHAR(200) NOT NULL,
  standard        VARCHAR(40)  NOT NULL,          -- HACCP_ISO22000 | ISO45001_HSE
  department_id   SMALLINT NOT NULL REFERENCES departments(id),
  branch_id       SMALLINT REFERENCES branches(id),
  auditor_id      UUID NOT NULL REFERENCES users(id),
  scheduled_date  DATE NOT NULL,
  conducted_at    TIMESTAMPTZ,
  status          internal_audit_status NOT NULL DEFAULT 'PLANNED',
  items           JSONB NOT NULL,                 -- checklist: [{id, clause, question, compliant, note}]
  score           NUMERIC(5,2),
  summary         TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_completed CHECK (status <> 'COMPLETED' OR (conducted_at IS NOT NULL AND score IS NOT NULL))
);
CREATE INDEX ix_internal_audits_status ON internal_audits (status, scheduled_date);

-- ---------- Quality: incidents & non-conformities (PRD §3 CAPA Management) ----------
CREATE SEQUENCE incident_seq;
CREATE TYPE incident_type AS ENUM (
  'NON_CONFORMITY', 'FOOD_SAFETY_INCIDENT', 'OHS_INCIDENT', 'CUSTOMER_COMPLAINT',
  'NEAR_MISS', 'AUDIT_FINDING', 'REGULATORY_INSPECTION'
);
CREATE TYPE incident_status AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'CLOSED');
CREATE TABLE incidents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_no        VARCHAR(30) NOT NULL UNIQUE
                       DEFAULT ('NC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('incident_seq')::text, 5, '0')),
  type               incident_type  NOT NULL,
  severity           alert_severity NOT NULL DEFAULT 'MEDIUM',
  department_id      SMALLINT NOT NULL REFERENCES departments(id),
  branch_id          SMALLINT REFERENCES branches(id),
  title              VARCHAR(200) NOT NULL,
  description        TEXT NOT NULL,
  location           VARCHAR(150),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by        UUID NOT NULL REFERENCES users(id),
  assigned_to        UUID REFERENCES users(id),
  root_cause         TEXT,
  corrective_action  TEXT,
  status             incident_status NOT NULL DEFAULT 'OPEN',
  closed_by          UUID REFERENCES users(id),
  closed_at          TIMESTAMPTZ,
  audit_id           UUID REFERENCES internal_audits(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_incidents_status ON incidents (status, department_id);
ALTER TABLE capas ADD COLUMN incident_id UUID REFERENCES incidents(id);

-- ---------- Confectionery: recipes & product data cards (PRD §4.4) ----------
CREATE TABLE recipes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(40)  NOT NULL UNIQUE,
  name_ar               VARCHAR(150) NOT NULL,
  name_en               VARCHAR(150) NOT NULL,
  department_id         SMALLINT NOT NULL REFERENCES departments(id),
  ingredients           JSONB NOT NULL CHECK (jsonb_typeof(ingredients) = 'array'),
  allergens             TEXT[] NOT NULL DEFAULT '{}',
  shelf_life_hours      INTEGER NOT NULL CHECK (shelf_life_hours > 0),
  storage_temp_max      NUMERIC(5,2),
  storage_instructions  TEXT,
  ccp_notes             TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE label_seq;
CREATE TYPE label_status AS ENUM ('ACTIVE', 'CONSUMED', 'DISCARDED');
CREATE TABLE product_labels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label_no          VARCHAR(30) NOT NULL UNIQUE DEFAULT ('LB-' || lpad(nextval('label_seq')::text, 7, '0')),
  recipe_id         UUID NOT NULL REFERENCES recipes(id),
  -- Snapshot of the recipe at production time: the card is legal evidence.
  product_name      VARCHAR(150) NOT NULL,
  ingredients       JSONB NOT NULL,
  allergens         TEXT[] NOT NULL DEFAULT '{}',
  storage_temp_max  NUMERIC(5,2),
  batch_no          VARCHAR(60) NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit              VARCHAR(20) NOT NULL DEFAULT 'قطعة',
  produced_at       TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  department_id     SMALLINT NOT NULL REFERENCES departments(id),
  branch_id         SMALLINT REFERENCES branches(id),
  produced_by       UUID NOT NULL REFERENCES users(id),
  status            label_status NOT NULL DEFAULT 'ACTIVE',
  status_reason     TEXT,
  qr_token          VARCHAR(64) NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_label_expiry CHECK (expires_at > produced_at)
);
CREATE INDEX ix_labels_active_expiry ON product_labels (expires_at) WHERE status = 'ACTIVE';

-- ---------- HSE: contractors & evaluations (PRD §4.1) ----------
CREATE TYPE contractor_service AS ENUM ('PEST_CONTROL', 'MAINTENANCE', 'CLEANING', 'WASTE_DISPOSAL', 'TRANSPORT', 'FIRE_SAFETY', 'OTHER');
CREATE TABLE contractors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(150) NOT NULL,
  service_type    contractor_service NOT NULL,
  cr_number       VARCHAR(30),
  contact_name    VARCHAR(100),
  phone           VARCHAR(20),
  license_no      VARCHAR(60),
  license_expiry  DATE,
  contract_start  DATE,
  contract_end    DATE,
  is_approved     BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE contractor_evaluations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   UUID NOT NULL REFERENCES contractors(id),
  evaluated_by    UUID NOT NULL REFERENCES users(id),
  period          VARCHAR(20) NOT NULL,          -- e.g. 2026-Q4
  scores          JSONB NOT NULL,                -- {quality, compliance, timeliness, safety, documentation}: 1..5
  total_score     NUMERIC(5,2) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  recommendation  VARCHAR(20) NOT NULL CHECK (recommendation IN ('CONTINUE', 'IMPROVE', 'TERMINATE')),
  notes           TEXT,
  evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_contractor_eval ON contractor_evaluations (contractor_id, evaluated_at DESC);

-- ---------- IMS controlled documents (policies, evacuation plans, extinguisher layouts) ----------
CREATE TYPE document_category AS ENUM (
  'IMS_POLICY', 'HACCP_PLAN', 'SOP', 'EVACUATION_PLAN', 'FIRE_EXTINGUISHER_LAYOUT', 'EMERGENCY_PLAN', 'LICENSE', 'CERTIFICATE', 'OTHER'
);
CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          VARCHAR(40)  NOT NULL UNIQUE,
  title           VARCHAR(200) NOT NULL,
  category        document_category NOT NULL,
  department_id   SMALLINT REFERENCES departments(id),
  version         VARCHAR(20) NOT NULL DEFAULT '1.0',
  effective_date  DATE NOT NULL,
  review_date     DATE,
  file_url        TEXT CHECK (file_url IS NULL OR file_url ~ '^https://'),
  owner_id        UUID REFERENCES users(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- updated_at + audit triggers on the new tables ----------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff', 'internal_audits', 'incidents', 'recipes', 'product_labels', 'contractors', 'documents'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['branches', 'staff', 'internal_audits', 'incidents', 'recipes', 'product_labels',
                           'contractors', 'contractor_evaluations', 'documents'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t);
  END LOOP;
END $$;

-- Never leak the encrypted ID number into the audit trail either.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger AS $$
DECLARE
  v_old      JSONB;
  v_new      JSONB;
  v_changed  TEXT[];
  v_user     TEXT := NULLIF(current_setting('app.current_user_id', true), '');
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE n.key <> 'updated_at' AND (v_old -> n.key) IS DISTINCT FROM n.value;
    IF v_changed IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  v_old := v_old - 'password_hash' - 'push_token' - 'id_number_enc' - 'device_key_hash';
  v_new := v_new - 'password_hash' - 'push_token' - 'id_number_enc' - 'device_key_hash';

  INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data, changed_fields,
                          ip_address, user_agent, request_id)
  VALUES (v_user::uuid, TG_OP, TG_TABLE_NAME, COALESCE(v_new ->> 'id', v_old ->> 'id'), v_old, v_new, v_changed,
          NULLIF(current_setting('app.client_ip', true), ''),
          NULLIF(current_setting('app.user_agent', true), ''),
          NULLIF(current_setting('app.request_id', true), ''));

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
