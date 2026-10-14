-- CreateTable
CREATE TABLE "message_template" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "email_subject" TEXT NOT NULL,
    "email_body" TEXT NOT NULL,
    "whatsapp_body" TEXT NOT NULL,
    "auto_email" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_message" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "payment_id" TEXT,
    "template_key" TEXT,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "reply_to" TEXT,
    "from_name" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "provider_id" TEXT,
    "error" TEXT,
    "dedupe_key" TEXT,
    "actor_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "outbound_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_template_org_id_key_key" ON "message_template"("org_id", "key");

-- CreateIndex
CREATE INDEX "outbound_message_status_next_attempt_at_idx" ON "outbound_message"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbound_message_org_id_booking_id_created_at_idx" ON "outbound_message"("org_id", "booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_message_org_id_dedupe_key_key" ON "outbound_message"("org_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_booking_fk" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;



-- ── Boogbe: raw SQL Prisma cannot model ──
-- (The three FKs above are declared as relations in schema.prisma so the drift guard stays green.)
ALTER TABLE outbound_message ADD CONSTRAINT outbound_message_channel_chk CHECK (channel IN ('email','whatsapp'));
-- skipped_no_mailer: an email that was never handed to a provider because no real mailer is configured.
-- It must never be recorded as 'sent' (owner, 2026-10-14).
ALTER TABLE outbound_message ADD CONSTRAINT outbound_message_status_chk
  CHECK (status IN ('queued','sent','failed','whatsapp_opened','skipped_no_mailer'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_template','outbound_message'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Dispatcher claim (T-M5-04; here because schema changes belong to schema tasks). Leases due, queued messages of
-- active orgs for 10 minutes and returns ids only; the send then reads the row under that org's RLS context.
-- SKIP LOCKED: two overlapping worker ticks never claim the same message.
-- Runs as its owner boogbe_migrator (BYPASSRLS), so it can see every org's queue.
CREATE OR REPLACE FUNCTION claim_outbound(p_limit int)
RETURNS TABLE (id text, org_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbound_message m SET attempts = m.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE m.id IN (
    SELECT o.id FROM outbound_message o JOIN organization g ON g.id = o.org_id
    WHERE o.status = 'queued' AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now()) AND g.status = 'active'
    ORDER BY o.created_at LIMIT p_limit FOR UPDATE OF o SKIP LOCKED)
  RETURNING m.id, m.org_id
$$;
ALTER FUNCTION claim_outbound(int) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION claim_outbound(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbound(int) TO boogbe_app;
