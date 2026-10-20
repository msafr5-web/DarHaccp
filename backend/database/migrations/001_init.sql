-- =====================================================================
-- Dar Al Dhiafa — IMS & HACCP platform : initial schema
-- PostgreSQL 14+
-- =====================================================================

-- ---------- Enumerations ----------
CREATE TYPE user_role        AS ENUM ('ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF');
CREATE TYPE department_code  AS ENUM ('HOT', 'COLD', 'SWEETS', 'SUPPORT');
CREATE TYPE record_status    AS ENUM ('PASS', 'FAIL');
CREATE TYPE record_source    AS ENUM ('QR', 'MANUAL');
CREATE TYPE alert_severity   AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE alert_status     AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE alert_source     AS ENUM ('CCP_DEVIATION', 'HEALTH_CERT_EXPIRY', 'EQUIPMENT_MAINTENANCE');
CREATE TYPE capa_status      AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'VERIFIED');
CREATE TYPE equipment_status AS ENUM ('OPERATIONAL', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE');
CREATE TYPE maintenance_type AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'CALIBRATION');

-- ---------- Generic helpers ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- ---------- Departments (kitchens & support services) ----------
CREATE TABLE departments (
  id          SMALLSERIAL PRIMARY KEY,
  code        department_code NOT NULL UNIQUE,
  name_ar     VARCHAR(100)    NOT NULL,
  name_en     VARCHAR(100)    NOT NULL,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------- Users & roles ----------
CREATE TABLE users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no            VARCHAR(30)  NOT NULL UNIQUE,
  full_name              VARCHAR(150) NOT NULL,
  email                  VARCHAR(255) NOT NULL,
  phone                  VARCHAR(20),
  password_hash          TEXT         NOT NULL,
  role                   user_role    NOT NULL,
  department_id          SMALLINT REFERENCES departments(id),
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  push_token             TEXT,
  failed_login_attempts  INTEGER      NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  password_changed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Kitchen staff must belong to a department; officers/admins are cross-department.
  CONSTRAINT chk_users_department CHECK (
    role IN ('ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER') OR department_id IS NOT NULL
  )
);
CREATE UNIQUE INDEX ux_users_email ON users (LOWER(email));
CREATE INDEX ix_users_role_dept ON users (role, department_id) WHERE is_active;

-- ---------- HACCP Critical Control Points ----------
CREATE TABLE ccps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(20)  NOT NULL UNIQUE,          -- e.g. CCP-1
  name_ar               VARCHAR(150) NOT NULL,
  name_en               VARCHAR(150) NOT NULL,
  department_id         SMALLINT REFERENCES departments(id),   -- NULL = applies to all kitchens
  hazard                TEXT         NOT NULL,
  parameter             VARCHAR(50)  NOT NULL DEFAULT 'TEMPERATURE',
  unit                  VARCHAR(10)  NOT NULL DEFAULT '°C',
  min_value             NUMERIC(8,2),                          -- critical limit (lower)
  max_value             NUMERIC(8,2),                          -- critical limit (upper)
  monitoring_frequency  VARCHAR(100) NOT NULL,
  corrective_action     TEXT         NOT NULL,                 -- pre-defined immediate action
  severity              alert_severity NOT NULL DEFAULT 'CRITICAL',
  is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_ccp_has_limit CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
  CONSTRAINT chk_ccp_limit_order CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

-- ---------- Digital operational forms (one QR code each) ----------
CREATE TABLE form_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(50)  NOT NULL UNIQUE,                 -- e.g. MEAT_RECEIVING
  title_ar       VARCHAR(200) NOT NULL,
  title_en       VARCHAR(200) NOT NULL,
  description    TEXT,
  department_id  SMALLINT REFERENCES departments(id),          -- NULL = any department
  ccp_id         UUID REFERENCES ccps(id),
  fields         JSONB        NOT NULL,
  qr_token       VARCHAR(64)  NOT NULL UNIQUE,
  version        INTEGER      NOT NULL DEFAULT 1,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_fields_array CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) > 0)
);

-- ---------- Equipment (fridges, ovens, chillers…) ----------
CREATE TABLE equipment (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   VARCHAR(30)  NOT NULL UNIQUE,
  name                   VARCHAR(150) NOT NULL,
  type                   VARCHAR(40)  NOT NULL,                -- FRIDGE, FREEZER, OVEN, BLAST_CHILLER…
  department_id          SMALLINT NOT NULL REFERENCES departments(id),
  location               VARCHAR(150),
  status                 equipment_status NOT NULL DEFAULT 'OPERATIONAL',
  form_template_id       UUID REFERENCES form_templates(id),   -- check form opened when its QR is scanned
  qr_token               VARCHAR(64)  NOT NULL UNIQUE,
  maintenance_interval_days INTEGER   NOT NULL DEFAULT 90 CHECK (maintenance_interval_days > 0),
  last_maintenance_date  DATE,
  next_maintenance_date  DATE,
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_equipment_next_maint ON equipment (next_maintenance_date) WHERE is_active;

CREATE TABLE maintenance_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id    UUID NOT NULL REFERENCES equipment(id),
  type            maintenance_type NOT NULL,
  description     TEXT NOT NULL,
  performed_by    UUID NOT NULL REFERENCES users(id),
  vendor          VARCHAR(150),
  performed_at    DATE NOT NULL,
  next_due_date   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_maint_equipment ON maintenance_logs (equipment_id, performed_at DESC);

-- ---------- Daily monitoring records (replace paper logs) ----------
CREATE TABLE monitoring_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES form_templates(id),
  template_version INTEGER NOT NULL,
  ccp_id          UUID REFERENCES ccps(id),
  department_id   SMALLINT NOT NULL REFERENCES departments(id),
  equipment_id    UUID REFERENCES equipment(id),
  recorded_by     UUID NOT NULL REFERENCES users(id),
  measured_value  NUMERIC(8,2),
  unit            VARCHAR(10),
  data            JSONB NOT NULL,
  status          record_status NOT NULL,
  deviations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_name    VARCHAR(150),
  batch_no        VARCHAR(60),
  notes           TEXT,
  source          record_source NOT NULL DEFAULT 'MANUAL',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_records_dept_time   ON monitoring_records (department_id, recorded_at DESC);
CREATE INDEX ix_records_status_time ON monitoring_records (status, recorded_at DESC);
CREATE INDEX ix_records_ccp_time    ON monitoring_records (ccp_id, recorded_at DESC);

-- HACCP records are legal evidence: never edited or deleted, corrections go through CAPA.
CREATE TRIGGER trg_records_immutable
  BEFORE UPDATE OR DELETE ON monitoring_records
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------- Alerts ----------
CREATE TABLE alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      alert_source   NOT NULL,
  source_id        UUID           NOT NULL,
  department_id    SMALLINT REFERENCES departments(id),
  severity         alert_severity NOT NULL,
  title            VARCHAR(200)   NOT NULL,
  message          TEXT           NOT NULL,
  status           alert_status   NOT NULL DEFAULT 'OPEN',
  acknowledged_by  UUID REFERENCES users(id),
  acknowledged_at  TIMESTAMPTZ,
  resolved_by      UUID REFERENCES users(id),
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one unresolved alert per source (scheduler is idempotent).
CREATE UNIQUE INDEX ux_alerts_open_source ON alerts (source_type, source_id) WHERE status <> 'RESOLVED';
CREATE INDEX ix_alerts_status ON alerts (status, created_at DESC);

-- ---------- CAPA (Corrective And Preventive Actions) ----------
CREATE SEQUENCE capa_seq;
CREATE TABLE capas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_no             VARCHAR(30) NOT NULL UNIQUE
                        DEFAULT ('CAPA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('capa_seq')::text, 6, '0')),
  record_id           UUID REFERENCES monitoring_records(id),
  alert_id            UUID REFERENCES alerts(id),
  ccp_id              UUID REFERENCES ccps(id),
  department_id       SMALLINT NOT NULL REFERENCES departments(id),
  description         TEXT NOT NULL,
  immediate_action    TEXT,
  root_cause          TEXT,
  corrective_action   TEXT,
  preventive_action   TEXT,
  product_disposition VARCHAR(30),               -- RECOOK, DISCARD, HOLD, RELEASE…
  assigned_to         UUID REFERENCES users(id),
  due_date            DATE,
  status              capa_status NOT NULL DEFAULT 'OPEN',
  created_by          UUID REFERENCES users(id),
  closed_by           UUID REFERENCES users(id),
  closed_at           TIMESTAMPTZ,
  verified_by         UUID REFERENCES users(id),
  verified_at         TIMESTAMPTZ,
  verification_notes  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_capa_closed CHECK (status NOT IN ('CLOSED', 'VERIFIED') OR (corrective_action IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT chk_capa_verified CHECK (status <> 'VERIFIED' OR verified_by IS NOT NULL)
);
CREATE INDEX ix_capas_status ON capas (status, department_id);

-- ---------- Staff health certificates ----------
CREATE TABLE health_certificates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id),
  employee_no        VARCHAR(30)  NOT NULL,
  employee_name      VARCHAR(150) NOT NULL,
  department_id      SMALLINT NOT NULL REFERENCES departments(id),
  certificate_no     VARCHAR(60)  NOT NULL UNIQUE,
  issuing_authority  VARCHAR(150) NOT NULL DEFAULT 'Baladi',
  issue_date         DATE NOT NULL,
  expiry_date        DATE NOT NULL,
  notes              TEXT,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cert_dates CHECK (expiry_date > issue_date)
);
CREATE INDEX ix_cert_expiry ON health_certificates (expiry_date);
CREATE INDEX ix_cert_employee ON health_certificates (employee_no);

-- =====================================================================
-- Audit trail (append-only, microsecond precision)
-- =====================================================================
CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID,
  action          VARCHAR(30)  NOT NULL,      -- INSERT | UPDATE | DELETE | LOGIN | LOGIN_FAILED | ...
  entity          VARCHAR(60)  NOT NULL,
  entity_id       TEXT,
  old_data        JSONB,
  new_data        JSONB,
  changed_fields  TEXT[],
  ip_address      VARCHAR(64),
  user_agent      VARCHAR(300),
  request_id      VARCHAR(64),
  occurred_at     TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_audit_entity ON audit_logs (entity, entity_id);
CREATE INDEX ix_audit_user_time ON audit_logs (user_id, occurred_at DESC);
CREATE INDEX ix_audit_time ON audit_logs (occurred_at DESC);

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Generic row-level audit: reads the acting user from transaction-local settings
-- populated by the API (see withTransaction in src/config/database.ts).
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
      RETURN NEW;  -- no effective change, nothing to audit
    END IF;
  END IF;

  -- Never persist secrets in the audit trail.
  v_old := v_old - 'password_hash' - 'push_token';
  v_new := v_new - 'password_hash' - 'push_token';

  INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data, changed_fields,
                          ip_address, user_agent, request_id)
  VALUES (v_user::uuid, TG_OP, TG_TABLE_NAME, COALESCE(v_new ->> 'id', v_old ->> 'id'), v_old, v_new, v_changed,
          NULLIF(current_setting('app.client_ip', true), ''),
          NULLIF(current_setting('app.user_agent', true), ''),
          NULLIF(current_setting('app.request_id', true), ''));

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Attach updated_at + audit triggers
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'ccps', 'form_templates', 'equipment', 'alerts', 'capas', 'health_certificates'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['departments', 'users', 'ccps', 'form_templates', 'equipment', 'maintenance_logs',
                           'monitoring_records', 'alerts', 'capas', 'health_certificates'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t);
  END LOOP;
END $$;
