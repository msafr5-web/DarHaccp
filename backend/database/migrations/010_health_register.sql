-- =====================================================================
-- 010 — Health certificates register (Balady): one row per worker, mirroring the
--       establishment's Balady follow-up sheet column for column.
--   م · اسم المنشأة / الفرع · رقم رخصة بلدي · القسم / النشاط الداخلي · اسم العامل (حسب الهوية)
--   رقم الهوية / الإقامة · تاريخ الميلاد · المهنة بالرخصة · رقم الجوال · تاريخ الفحص الطبي
--   حالة الفحص · تاريخ انتهاء الشهادة · حالة الشهادة (computed) · ملاحظات التنفيذ
-- =====================================================================

ALTER TYPE alert_source ADD VALUE IF NOT EXISTS 'HEALTH_REGISTER';

CREATE TABLE health_register (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL DEFAULT app_tenant() REFERENCES tenants(id),
  serial             INTEGER NOT NULL,                       -- م (order of the sheet)
  branch_name        VARCHAR(150) NOT NULL,                  -- اسم المنشأة / الفرع
  balady_license_no  VARCHAR(20)  NOT NULL CHECK (balady_license_no ~ '^[0-9]{5,20}$'),
  internal_section   VARCHAR(120),                           -- القسم / النشاط الداخلي
  worker_name        VARCHAR(150) NOT NULL,                  -- اسم العامل (حسب الهوية)
  -- رقم الهوية / الإقامة: AES-256-GCM encrypted; blind index for uniqueness; last 4 digits for display
  id_number_enc      TEXT         NOT NULL,
  id_number_hash     VARCHAR(64)  NOT NULL,
  id_number_last4    VARCHAR(4)   NOT NULL,
  id_type            VARCHAR(10)  NOT NULL CHECK (id_type IN ('CITIZEN', 'RESIDENT')),   -- 1… national ID / 2… iqama
  birth_date         DATE,
  profession         VARCHAR(120),                           -- المهنة بالرخصة
  mobile             VARCHAR(10)  CHECK (mobile IS NULL OR mobile ~ '^05[0-9]{8}$'),
  exam_date          DATE,                                   -- تاريخ الفحص الطبي
  exam_status        VARCHAR(10)  NOT NULL DEFAULT 'PENDING'
                       CHECK (exam_status IN ('FIT', 'PENDING', 'UNFIT')),             -- سليم (معتمد) / بانتظار النتيجة / غير لائق
  cert_expiry        DATE,                                   -- تاريخ انتهاء الشهادة
  notes              TEXT,                                   -- ملاحظات التنفيذ
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_register_expiry CHECK (cert_expiry IS NULL OR exam_date IS NULL OR cert_expiry > exam_date)
);
CREATE UNIQUE INDEX ux_health_register_worker ON health_register (tenant_id, id_number_hash);
CREATE INDEX ix_health_register_tenant ON health_register (tenant_id, serial);
CREATE INDEX ix_health_register_expiry ON health_register (tenant_id, cert_expiry);

CREATE TRIGGER trg_health_register_updated_at BEFORE UPDATE ON health_register FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_health_register_audit AFTER INSERT OR UPDATE OR DELETE ON health_register FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE health_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_register FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON health_register
  USING (app_bypass() OR tenant_id = app_tenant()) WITH CHECK (app_bypass() OR tenant_id = app_tenant());

-- The encrypted ID and its blind index never enter the audit trail.
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

  v_old := v_old - 'password_hash' - 'push_token' - 'id_number_enc' - 'device_key_hash' - 'id_number_hash';
  v_new := v_new - 'password_hash' - 'push_token' - 'id_number_enc' - 'device_key_hash' - 'id_number_hash';

  INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data, changed_fields,
                          ip_address, user_agent, request_id)
  VALUES (v_user::uuid, TG_OP, TG_TABLE_NAME, COALESCE(v_new ->> 'id', v_old ->> 'id'), v_old, v_new, v_changed,
          NULLIF(current_setting('app.client_ip', true), ''),
          NULLIF(current_setting('app.user_agent', true), ''),
          NULLIF(current_setting('app.request_id', true), ''));

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
