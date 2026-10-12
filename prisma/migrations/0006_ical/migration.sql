-- CreateTable
CREATE TABLE "ical_feed" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "last_modified" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_status" TEXT NOT NULL DEFAULT 'never',
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ical_feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ical_export" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "exclude_feed_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMP(3),

    CONSTRAINT "ical_export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflict" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "block_id" TEXT,
    "block_start" DATE NOT NULL,
    "block_end" DATE NOT NULL,
    "block_summary" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_by_member_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ical_feed_org_id_unit_id_idx" ON "ical_feed"("org_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "ical_export_token_key" ON "ical_export"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ical_export_org_id_unit_id_channel_key" ON "ical_export"("org_id", "unit_id", "channel");

-- CreateIndex
CREATE INDEX "sync_conflict_org_id_status_idx" ON "sync_conflict"("org_id", "status");

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_feed_fk" FOREIGN KEY ("feed_id") REFERENCES "ical_feed"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ical_feed" ADD CONSTRAINT "ical_feed_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ical_feed" ADD CONSTRAINT "ical_feed_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ical_export" ADD CONSTRAINT "ical_export_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ical_export" ADD CONSTRAINT "ical_export_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ical_export" ADD CONSTRAINT "ical_export_feed_fk" FOREIGN KEY ("exclude_feed_id") REFERENCES "ical_feed"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_booking_fk" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_block_fk" FOREIGN KEY ("block_id") REFERENCES "block"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- ── Boogbe: raw SQL Prisma cannot model ──
-- (The nine FKs above are declared as relations in schema.prisma so the drift guard stays green.)
CREATE UNIQUE INDEX sync_conflict_open_pair ON sync_conflict (booking_id, block_id) WHERE status = 'open';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ical_feed','ical_export','sync_conflict'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Public export lookup: the only way to read ical_export without an org context. Returns ids only.
-- Runs as its owner boogbe_migrator, which has BYPASSRLS (see M0 roles.sql), so it can read across orgs.
CREATE OR REPLACE FUNCTION ical_export_lookup(p_token text)
RETURNS TABLE (org_id text, unit_id text, export_id text, channel text, exclude_feed_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.org_id, e.unit_id, e.id, e.channel, e.exclude_feed_id
  FROM ical_export e JOIN organization o ON o.id = e.org_id
  WHERE e.token = p_token AND o.status = 'active'
$$;
ALTER FUNCTION ical_export_lookup(text) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION ical_export_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ical_export_lookup(text) TO boogbe_app;
