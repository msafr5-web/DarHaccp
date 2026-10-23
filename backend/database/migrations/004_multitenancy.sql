-- =====================================================================
-- 004 — SaaS multi-tenancy
--   * tenants (companies) with a unique company code and admin review workflow
--   * tenant_id on every business table, filled automatically from the session
--   * PostgreSQL Row-Level Security: a company can never read or write another
--     company's rows, even if an application query forgets a filter
--   * dedicated runtime role without BYPASSRLS (the managed owner role has it)
--   * email OTP challenges, password tokens and an append-only login-attempt log
-- =====================================================================

-- ---------- Session helpers used by defaults and policies ----------
CREATE OR REPLACE FUNCTION app_tenant() RETURNS INTEGER LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::int $$;

-- Platform-level / system operations (registration, platform admin, schedulers).
CREATE OR REPLACE FUNCTION app_bypass() RETURNS BOOLEAN LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on' $$;

-- ---------- Tenants (companies) ----------
CREATE TYPE tenant_status AS ENUM ('PENDING_VERIFICATION', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED');

CREATE TABLE tenants (
  id                 SERIAL PRIMARY KEY,
  account_no         VARCHAR(12) GENERATED ALWAYS AS ('T-' || lpad(id::text, 6, '0')) STORED,
  -- 5 letters of the name + last 5 phone digits + subscription date (DDMMYYYY), e.g. RuknH7768723102026
  code               VARCHAR(40)  NOT NULL,
  name               VARCHAR(150) NOT NULL,
  phone              VARCHAR(20)  NOT NULL,
  email              VARCHAR(255) NOT NULL,
  address            VARCHAR(300) NOT NULL,
  subscription_date  DATE NOT NULL,
  status             tenant_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  is_platform        BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at  TIMESTAMPTZ,
  reviewed_by        UUID,
  reviewed_at        TIMESTAMPTZ,
  review_notes       TEXT,
  created_ip         VARCHAR(64),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A code / e-mail can be reused only after the previous application was rejected.
CREATE UNIQUE INDEX ux_tenants_code  ON tenants (LOWER(code))  WHERE status <> 'REJECTED';
CREATE UNIQUE INDEX ux_tenants_email ON tenants (LOWER(email)) WHERE status <> 'REJECTED';
CREATE INDEX ix_tenants_status ON tenants (status, created_at DESC);
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Every registration, approval, rejection or suspension is kept in the audit trail.
CREATE TRIGGER trg_tenants_audit AFTER INSERT OR UPDATE OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- The SaaS operator itself (platform administrators live in this tenant).
INSERT INTO tenants (id, code, name, phone, email, address, subscription_date, status, is_platform, email_verified_at, reviewed_at)
VALUES (1, 'DARHACCP', 'منصة DarHaccp', '+966500000000', 'platform@darhaccp.sa', 'المملكة العربية السعودية',
        CURRENT_DATE, 'ACTIVE', TRUE, now(), now());

-- Fresh installation: drop the placeholder branch created by 002 (each company gets its own).
DELETE FROM branches WHERE NOT EXISTS (SELECT 1 FROM users);

-- Existing single-company data becomes the first customer tenant (only if there is data).
INSERT INTO tenants (id, code, name, phone, email, address, subscription_date, status, email_verified_at, reviewed_at, review_notes)
SELECT 2, 'DarAl0000020102026', 'Dar Al Dhiafa — دار الضيافة', '+966500000000', 'admin@daraldhiafa.sa',
       'الرياض، المملكة العربية السعودية', DATE '2026-10-20', 'ACTIVE', now(), now(),
       'حساب تجريبي أُنشئ من بيانات النظام قبل التحول إلى SaaS — حدّث رقم الجوال والعنوان'
 WHERE EXISTS (SELECT 1 FROM users);
SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT max(id) FROM tenants), 2));

-- ---------- tenant_id on every business table ----------
-- Existing rows belong to tenant 2; new rows take the tenant of the current session.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'branches', 'ccps', 'form_templates', 'equipment', 'maintenance_logs',
                           'monitoring_records', 'alerts', 'capas', 'health_certificates', 'staff',
                           'internal_audits', 'incidents', 'recipes', 'product_labels', 'contractors',
                           'contractor_evaluations', 'documents'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 2 REFERENCES tenants(id)', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT app_tenant()', t);
    EXECUTE format('CREATE INDEX ix_%1$s_tenant ON %1$I (tenant_id)', t);
  END LOOP;
END $$;

-- Audit rows of platform-level actions have no tenant.
ALTER TABLE audit_logs ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) DEFAULT app_tenant();
ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_immutable;
UPDATE audit_logs SET tenant_id = 2 WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 2);
ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_immutable;
CREATE INDEX ix_audit_tenant_time ON audit_logs (tenant_id, occurred_at DESC);

-- Platform administrators have no kitchen department.
ALTER TABLE users DROP CONSTRAINT chk_users_department;
ALTER TABLE users ADD CONSTRAINT chk_users_department CHECK (
  role IN ('ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'PLATFORM_ADMIN') OR department_id IS NOT NULL
);

-- ---------- Business keys become unique per company ----------
ALTER TABLE users DROP CONSTRAINT users_employee_no_key;
ALTER TABLE users ADD CONSTRAINT users_tenant_employee_no_key UNIQUE (tenant_id, employee_no);
DROP INDEX ux_users_email;
CREATE UNIQUE INDEX ux_users_tenant_email ON users (tenant_id, LOWER(email));

ALTER TABLE branches DROP CONSTRAINT branches_code_key;
ALTER TABLE branches ADD CONSTRAINT branches_tenant_code_key UNIQUE (tenant_id, code);
ALTER TABLE ccps DROP CONSTRAINT ccps_code_key;
ALTER TABLE ccps ADD CONSTRAINT ccps_tenant_code_key UNIQUE (tenant_id, code);
ALTER TABLE form_templates DROP CONSTRAINT form_templates_code_key;
ALTER TABLE form_templates ADD CONSTRAINT form_templates_tenant_code_key UNIQUE (tenant_id, code);
ALTER TABLE equipment DROP CONSTRAINT equipment_code_key;
ALTER TABLE equipment ADD CONSTRAINT equipment_tenant_code_key UNIQUE (tenant_id, code);
ALTER TABLE health_certificates DROP CONSTRAINT health_certificates_certificate_no_key;
ALTER TABLE health_certificates ADD CONSTRAINT health_certificates_tenant_cert_key UNIQUE (tenant_id, certificate_no);
ALTER TABLE staff DROP CONSTRAINT staff_employee_no_key;
ALTER TABLE staff ADD CONSTRAINT staff_tenant_employee_no_key UNIQUE (tenant_id, employee_no);
ALTER TABLE recipes DROP CONSTRAINT recipes_code_key;
ALTER TABLE recipes ADD CONSTRAINT recipes_tenant_code_key UNIQUE (tenant_id, code);
ALTER TABLE documents DROP CONSTRAINT documents_doc_no_key;
ALTER TABLE documents ADD CONSTRAINT documents_tenant_doc_no_key UNIQUE (tenant_id, doc_no);

-- ---------- Authentication: OTP challenges, password tokens, login attempts ----------
CREATE TYPE otp_purpose AS ENUM ('LOGIN', 'REGISTRATION');
CREATE TABLE otp_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       otp_purpose NOT NULL,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  user_id       UUID REFERENCES users(id),
  email         VARCHAR(255) NOT NULL,
  code_hash     VARCHAR(64) NOT NULL,           -- HMAC-SHA256, the code itself is never stored
  expires_at    TIMESTAMPTZ NOT NULL,
  attempts      SMALLINT NOT NULL DEFAULT 0,
  sends         SMALLINT NOT NULL DEFAULT 1,
  last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at   TIMESTAMPTZ,
  ip_address    VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_user ON otp_challenges (user_id, created_at DESC);

CREATE TYPE password_token_purpose AS ENUM ('ACTIVATION', 'RESET');
CREATE TABLE password_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  purpose     password_token_purpose NOT NULL,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every login attempt (password stage, OTP stage, resends) — append-only evidence.
CREATE TABLE login_attempts (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        INTEGER REFERENCES tenants(id),
  user_id          UUID REFERENCES users(id),
  company_code     VARCHAR(60),
  email            VARCHAR(255),
  stage            VARCHAR(20) NOT NULL,          -- PASSWORD | OTP | OTP_RESEND
  success          BOOLEAN NOT NULL,
  failure_reason   VARCHAR(60),
  ip_address       VARCHAR(64),
  user_agent       VARCHAR(300),
  occurred_at      TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_login_attempts_tenant ON login_attempts (tenant_id, occurred_at DESC);
CREATE INDEX ix_login_attempts_time ON login_attempts (occurred_at DESC);
CREATE TRIGGER trg_login_attempts_immutable BEFORE UPDATE OR DELETE ON login_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------- Row-Level Security ----------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'branches', 'ccps', 'form_templates', 'equipment', 'maintenance_logs',
                           'monitoring_records', 'alerts', 'capas', 'health_certificates', 'staff',
                           'internal_audits', 'incidents', 'recipes', 'product_labels', 'contractors',
                           'contractor_evaluations', 'documents', 'audit_logs', 'login_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR tenant_id = app_tenant()) WITH CHECK (app_bypass() OR tenant_id = app_tenant())', t);
  END LOOP;
END $$;

-- A company may read its own tenant record; everything else is platform-only.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants USING (app_bypass() OR id = app_tenant()) WITH CHECK (app_bypass());

ALTER TABLE otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON otp_challenges USING (app_bypass()) WITH CHECK (app_bypass());
ALTER TABLE password_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON password_tokens USING (app_bypass()) WITH CHECK (app_bypass());

-- ---------- Runtime role without BYPASSRLS ----------
-- The managed database owner can bypass RLS, so the API switches to this role on every connection.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dar_app') THEN
    CREATE ROLE dar_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
-- PG16+: the owner needs the SET option to switch into the role (SET ROLE / set_config('role')).
GRANT dar_app TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
GRANT USAGE ON SCHEMA public TO dar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dar_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO dar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dar_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dar_app;
-- Migrations bookkeeping and advisory schema objects stay owner-only.
REVOKE ALL ON schema_migrations FROM dar_app;
