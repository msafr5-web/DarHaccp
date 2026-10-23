-- =====================================================================
-- 009 — Technical PRD v2 (HACCP & GDP): item master, FEFO stock engine,
--       2-hourly environmental monitoring, NCR on rejection, batch traceability
-- =====================================================================

ALTER TYPE alert_source ADD VALUE IF NOT EXISTS 'MONITORING_OVERDUE';
ALTER TYPE alert_source ADD VALUE IF NOT EXISTS 'STOCK_EXPIRY';

-- ---------- Item master (form fields reference it like a foreign key) ----------
CREATE TABLE items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          INTEGER NOT NULL DEFAULT app_tenant() REFERENCES tenants(id),
  code               VARCHAR(40)  NOT NULL,
  name_ar            VARCHAR(150) NOT NULL,
  name_en            VARCHAR(150),
  category           VARCHAR(60),
  -- CHILLED 2–8 °C | FROZEN ≤ −18 °C | AMBIENT | SENSITIVE (pharma 2–8 °C)
  storage_condition  VARCHAR(20)  NOT NULL DEFAULT 'AMBIENT'
                       CHECK (storage_condition IN ('CHILLED', 'FROZEN', 'AMBIENT', 'SENSITIVE')),
  unit               VARCHAR(20)  NOT NULL DEFAULT 'وحدة',
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_items_tenant_code ON items (tenant_id, UPPER(code));

-- ---------- FEFO stock engine: balance per item batch + append-only movements ----------
CREATE TABLE stock_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       INTEGER NOT NULL DEFAULT app_tenant() REFERENCES tenants(id),
  item_code       VARCHAR(40)  NOT NULL,
  batch_number    VARCHAR(80)  NOT NULL,
  expiry_date     DATE         NOT NULL,
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),
  last_record_id  UUID REFERENCES monitoring_records(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_stock_batches ON stock_batches (tenant_id, UPPER(item_code), UPPER(batch_number));
CREATE INDEX ix_stock_fefo ON stock_batches (tenant_id, item_code, expiry_date) WHERE quantity > 0;

CREATE TABLE stock_movements (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL DEFAULT app_tenant() REFERENCES tenants(id),
  stock_batch_id   UUID NOT NULL REFERENCES stock_batches(id),
  record_id        UUID NOT NULL REFERENCES monitoring_records(id),
  movement         VARCHAR(10) NOT NULL CHECK (movement IN ('COUNT', 'ISSUE')),
  quantity_before  NUMERIC(14,3) NOT NULL,
  quantity_after   NUMERIC(14,3) NOT NULL,
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_stock_movements_batch ON stock_movements (stock_batch_id, created_at DESC);
CREATE TRIGGER trg_stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['items', 'stock_batches', 'stock_movements'] LOOP
    EXECUTE format('CREATE INDEX ix_%1$s_tenant ON %1$I (tenant_id)', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR tenant_id = app_tenant()) WITH CHECK (app_bypass() OR tenant_id = app_tenant())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['items', 'stock_batches'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', t);
  END LOOP;
END $$;

-- ---------- Periodic monitoring: maximum gap between two readings (e.g. every 2 h, alert after 2 h 30) ----------
ALTER TABLE form_catalog   ADD COLUMN max_gap_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (max_gap_minutes BETWEEN 0 AND 1440);
ALTER TABLE form_templates ADD COLUMN max_gap_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (max_gap_minutes BETWEEN 0 AND 1440);

-- ---------- Built-in library forms can be upgraded safely (only when not edited by the platform admin) ----------
ALTER TABLE form_catalog
  ADD COLUMN builtin_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN builtin_synced_version INTEGER NOT NULL DEFAULT 1;

-- ---------- NCR raised from a form (e.g. a rejected shipment) ----------
ALTER TABLE incidents ADD COLUMN record_id UUID REFERENCES monitoring_records(id);
CREATE INDEX ix_incidents_record ON incidents (record_id) WHERE record_id IS NOT NULL;

-- ---------- Reverse traceability (recall) by batch / lot number across all forms ----------
CREATE INDEX ix_records_batch_number ON monitoring_records (tenant_id, UPPER(data ->> 'batch_number')) WHERE data ? 'batch_number';
CREATE INDEX ix_records_batch_no ON monitoring_records (tenant_id, UPPER(batch_no)) WHERE batch_no IS NOT NULL;
