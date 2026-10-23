-- =====================================================================
-- 011 — Health certificate knowledge base (الدليل المرجعي للشهادة الصحية)
--   Platform-level reference data, one table per tab of the establishment's workbook:
--     hc_requirements   ملخص المتطلبات
--     hc_activities     الأنشطة المستهدفة
--     hc_medical_tests  الفحوصات الطبية
--     hc_issuance_steps خطوات الإصدار
--   plus hc_sources: every item points to the page it was taken from, with its reliability level.
--   Readable by every company; changed only by the platform administrator (audited).
--   The register (010) gets the process-tracking columns the issuance steps refer to.
-- =====================================================================

CREATE TABLE hc_sources (
  id            SMALLSERIAL PRIMARY KEY,
  code          VARCHAR(30)  NOT NULL UNIQUE,
  title         VARCHAR(250) NOT NULL,
  publisher     VARCHAR(150) NOT NULL,
  url           TEXT,
  -- OFFICIAL: ministry / Balady page · CLINICS: practice published by medical centres (not a regulation)
  level         VARCHAR(10)  NOT NULL CHECK (level IN ('OFFICIAL', 'CLINICS')),
  retrieved_on  DATE         NOT NULL
);

CREATE TABLE hc_requirements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(40)  NOT NULL UNIQUE,
  kind           VARCHAR(12)  NOT NULL CHECK (kind IN ('REQUIREMENT', 'CONDITION', 'FEE', 'VALIDITY', 'PENALTY', 'CHANNEL', 'SUPPORT', 'NOTE')),
  title_ar       VARCHAR(200) NOT NULL,
  detail_ar      TEXT         NOT NULL,
  value_text     VARCHAR(80),
  items          JSONB        NOT NULL DEFAULT '[]'::jsonb,     -- list values (e.g. the health-education cities)
  source_code    VARCHAR(30)  REFERENCES hc_sources(code),
  sort           SMALLINT     NOT NULL DEFAULT 100,
  verification   VARCHAR(10)  NOT NULL DEFAULT 'OFFICIAL' CHECK (verification IN ('OFFICIAL', 'REPORTED', 'UNVERIFIED')),
  verified_on    DATE,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  edited         BOOLEAN      NOT NULL DEFAULT FALSE,            -- changed by the platform administrator: never overwritten by a seed upgrade
  seed_revision  INTEGER      NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE hc_activities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             VARCHAR(30)  NOT NULL UNIQUE,
  sector           VARCHAR(14)  NOT NULL CHECK (sector IN ('FOOD', 'PUBLIC_HEALTH')),
  name_ar          VARCHAR(150) NOT NULL,
  examples_ar      TEXT,
  keywords         TEXT[]       NOT NULL DEFAULT '{}',            -- words of a profession / section that suggest this activity
  cert_required    BOOLEAN      NOT NULL DEFAULT TRUE,
  notes_ar         TEXT,
  source_code      VARCHAR(30)  REFERENCES hc_sources(code),
  sort             SMALLINT     NOT NULL DEFAULT 100,
  verification     VARCHAR(10)  NOT NULL DEFAULT 'OFFICIAL' CHECK (verification IN ('OFFICIAL', 'REPORTED', 'UNVERIFIED')),
  verified_on      DATE,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  edited           BOOLEAN      NOT NULL DEFAULT FALSE,
  seed_revision    INTEGER      NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE hc_medical_tests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(30)  NOT NULL UNIQUE,
  category       VARCHAR(10)  NOT NULL CHECK (category IN ('CLINICAL', 'LAB', 'IMAGING')),
  name_ar        VARCHAR(150) NOT NULL,
  purpose_ar     TEXT         NOT NULL,
  applicability  VARCHAR(12)  NOT NULL DEFAULT 'COMMON' CHECK (applicability IN ('COMMON', 'CASE_BY_CASE')),
  source_code    VARCHAR(30)  REFERENCES hc_sources(code),
  sort           SMALLINT     NOT NULL DEFAULT 100,
  verification   VARCHAR(10)  NOT NULL DEFAULT 'REPORTED' CHECK (verification IN ('OFFICIAL', 'REPORTED', 'UNVERIFIED')),
  verified_on    DATE,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  edited         BOOLEAN      NOT NULL DEFAULT FALSE,
  seed_revision  INTEGER      NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE hc_issuance_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(30)  NOT NULL UNIQUE,
  step_no        SMALLINT     NOT NULL UNIQUE CHECK (step_no BETWEEN 1 AND 50),
  title_ar       VARCHAR(200) NOT NULL,
  detail_ar      TEXT         NOT NULL,
  actor          VARCHAR(20)  NOT NULL CHECK (actor IN ('APPLICANT', 'HEALTH_CENTER', 'TRAINING_CENTER', 'SYSTEM')),
  system_name    VARCHAR(10)  NOT NULL CHECK (system_name IN ('BALADY', 'SEHHA', 'TRAINING', 'PAYMENT')),
  -- the register column that records this milestone; NULL = a navigation step inside Balady
  tracked_by     VARCHAR(20)  CHECK (tracked_by IN ('request_no', 'exam_status', 'edu_status', 'fee_paid_on', 'cert_expiry')),
  conditional    BOOLEAN      NOT NULL DEFAULT FALSE,              -- only where the Amana has activated the rule (health education)
  source_code    VARCHAR(30)  REFERENCES hc_sources(code),
  verification   VARCHAR(10)  NOT NULL DEFAULT 'OFFICIAL' CHECK (verification IN ('OFFICIAL', 'REPORTED', 'UNVERIFIED')),
  verified_on    DATE,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  edited         BOOLEAN      NOT NULL DEFAULT FALSE,
  seed_revision  INTEGER      NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['hc_sources', 'hc_requirements', 'hc_activities', 'hc_medical_tests', 'hc_issuance_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY reference_read ON %I USING (TRUE) WITH CHECK (app_bypass())', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['hc_requirements', 'hc_activities', 'hc_medical_tests', 'hc_issuance_steps'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

-- ---------- The register tracks the process the steps describe ----------
-- Only process facts are stored — never medical results (the official outcome is the single fit / unfit status).
ALTER TABLE health_register
  ADD COLUMN city           VARCHAR(60),
  ADD COLUMN activity_code  VARCHAR(30) REFERENCES hc_activities(code) ON UPDATE CASCADE,
  ADD COLUMN request_no     VARCHAR(30),                               -- Balady request number
  ADD COLUMN edu_status     VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (edu_status IN ('PENDING', 'PASSED', 'FAILED')),
  ADD COLUMN fee_paid_on    DATE;
CREATE INDEX ix_health_register_activity ON health_register (tenant_id, activity_code);
