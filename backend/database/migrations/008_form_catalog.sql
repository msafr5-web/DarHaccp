-- =====================================================================
-- 008 — Platform form library & per-company features
--   * form_catalog: the platform's library of digital forms (HACCP logs and the
--     PRD warehouse / GDP forms). The platform administrator adds or removes fields
--     and enables each form for each company according to its needs.
--   * form_templates.catalog_id: a company's copy of a library form (own QR code);
--     library changes propagate unless the copy was customised for that company.
--   * users.record_access: FILL (fill only) or FILL_EDIT (fill and amend).
--   * controlled amendments of monitoring records with an append-only revision
--     history (original values, who, when, why) — the record itself stays protected.
--   * device that filled the form, and MISSED_MONITORING alerts (minimum frequency).
-- =====================================================================

ALTER TYPE alert_source ADD VALUE IF NOT EXISTS 'MISSED_MONITORING';

-- ---------- Platform library of forms (not tenant-scoped) ----------
CREATE TABLE form_catalog (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR(50)  NOT NULL UNIQUE,
  title_ar           VARCHAR(200) NOT NULL,
  title_en           VARCHAR(200) NOT NULL,
  description        TEXT,
  category           VARCHAR(30)  NOT NULL DEFAULT 'HACCP',      -- HACCP | WMS_GDP | HSE ...
  department_code    department_code,                            -- NULL = any department
  ccp_code           VARCHAR(20),                                -- linked to the company's CCP with this code
  fields             JSONB        NOT NULL,
  min_daily_entries  SMALLINT     NOT NULL DEFAULT 0 CHECK (min_daily_entries BETWEEN 0 AND 24),
  version            INTEGER      NOT NULL DEFAULT 1,
  is_default         BOOLEAN      NOT NULL DEFAULT FALSE,          -- given to every new company
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_catalog_fields CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) > 0)
);
CREATE TRIGGER trg_form_catalog_updated_at BEFORE UPDATE ON form_catalog FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_form_catalog_audit AFTER INSERT OR UPDATE OR DELETE ON form_catalog FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Every session may read the library; only platform/system operations may change it.
ALTER TABLE form_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_read ON form_catalog USING (TRUE) WITH CHECK (app_bypass());

-- ---------- Company copies of library forms ----------
ALTER TABLE form_templates
  ADD COLUMN catalog_id        UUID REFERENCES form_catalog(id),
  ADD COLUMN catalog_version   INTEGER,
  ADD COLUMN customized        BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN min_daily_entries SMALLINT NOT NULL DEFAULT 0 CHECK (min_daily_entries BETWEEN 0 AND 24);
CREATE UNIQUE INDEX ux_templates_tenant_catalog ON form_templates (tenant_id, catalog_id) WHERE catalog_id IS NOT NULL;

-- ---------- Employee permission on records ----------
ALTER TABLE users ADD COLUMN record_access VARCHAR(10) NOT NULL DEFAULT 'FILL'
  CHECK (record_access IN ('FILL', 'FILL_EDIT'));
UPDATE users SET record_access = 'FILL_EDIT' WHERE role IN ('ADMIN', 'HACCP_OFFICER');

-- ---------- Records: filling device + amendment trail ----------
ALTER TABLE monitoring_records
  ADD COLUMN device_info       VARCHAR(200),
  ADD COLUMN revision          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN amended_at        TIMESTAMPTZ,
  ADD COLUMN amended_by        UUID REFERENCES users(id),
  ADD COLUMN amendment_reason  TEXT;
CREATE INDEX ix_records_template_time ON monitoring_records (template_id, recorded_at DESC);

-- Previous versions of amended records (append-only legal evidence).
CREATE TABLE record_revisions (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                INTEGER NOT NULL DEFAULT app_tenant() REFERENCES tenants(id),
  record_id                UUID NOT NULL REFERENCES monitoring_records(id),
  revision                 INTEGER NOT NULL,
  data                     JSONB NOT NULL,
  status                   record_status NOT NULL,
  deviations               JSONB NOT NULL,
  notes                    TEXT,
  corrective_action_taken  TEXT,
  authored_by              UUID NOT NULL REFERENCES users(id),
  authored_at              TIMESTAMPTZ NOT NULL,
  superseded_by            UUID NOT NULL REFERENCES users(id),
  reason                   TEXT NOT NULL,
  superseded_at            TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (record_id, revision)
);
CREATE INDEX ix_record_revisions_tenant ON record_revisions (tenant_id);
CREATE TRIGGER trg_record_revisions_immutable BEFORE UPDATE OR DELETE ON record_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
ALTER TABLE record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON record_revisions
  USING (app_bypass() OR tenant_id = app_tenant()) WITH CHECK (app_bypass() OR tenant_id = app_tenant());

-- Records stay append-only. The only permitted change is a controlled amendment: the API sets
-- app.record_amend for that transaction, only the captured values may change, the revision must
-- advance by one, and the previous version is kept in record_revisions. Deletion is never allowed.
CREATE OR REPLACE FUNCTION guard_record_mutation() RETURNS trigger AS $$
DECLARE
  amendable TEXT[] := ARRAY['data', 'status', 'deviations', 'measured_value', 'unit', 'notes', 'corrective_action_taken',
                            'product_name', 'batch_no', 'revision', 'amended_at', 'amended_by', 'amendment_reason'];
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.record_amend', true), '') = 'on'
     AND (to_jsonb(OLD) - amendable) = (to_jsonb(NEW) - amendable)
     AND NEW.revision = OLD.revision + 1
     AND NEW.amended_by IS NOT NULL
     AND EXISTS (SELECT 1 FROM record_revisions WHERE record_id = OLD.id AND revision = OLD.revision) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER trg_records_immutable ON monitoring_records;
CREATE TRIGGER trg_records_immutable
  BEFORE UPDATE OR DELETE ON monitoring_records
  FOR EACH ROW EXECUTE FUNCTION guard_record_mutation();
