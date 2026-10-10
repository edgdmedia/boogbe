-- Tenant base tables (see docs/DATA_MODEL.md). Every table gets org_id, RLS enabled+forced,
-- an org_isolation policy and an FK to organization (added in SQL, no Prisma relation).

-- CreateTable
CREATE TABLE "org_settings" (
    "org_id" TEXT NOT NULL,
    "check_in_time" TEXT NOT NULL DEFAULT '14:00',
    "check_out_time" TEXT NOT NULL DEFAULT '12:00',
    "hold_hours" INTEGER NOT NULL DEFAULT 24,
    "auto_confirm_on_payment" BOOLEAN NOT NULL DEFAULT true,
    "owner_sees_guest_names" BOOLEAN NOT NULL DEFAULT false,
    "receipt_prefix" TEXT NOT NULL,
    "statement_prefix" TEXT NOT NULL,
    "booking_prefix" TEXT NOT NULL,
    "logo_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "org_counter" (
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "org_counter_pkey" PRIMARY KEY ("org_id","name")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_member_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_org_id_entity_entity_id_idx" ON "audit_log"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_org_id_at_idx" ON "audit_log"("org_id", "at");

ALTER TABLE org_settings ADD CONSTRAINT org_settings_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE org_counter  ADD CONSTRAINT org_counter_org_fk  FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE audit_log    ADD CONSTRAINT audit_log_org_fk    FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_settings','org_counter','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- audit_log is append-only for the runtime role.
REVOKE UPDATE, DELETE ON audit_log FROM boogbe_app;
