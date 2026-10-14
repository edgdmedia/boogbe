-- CreateTable
CREATE TABLE "guest" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "anonymised_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "guest_count" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "hold_until" TIMESTAMP(3),
    "computed_total_kobo" BIGINT NOT NULL,
    "final_total_kobo" BIGINT NOT NULL,
    "deposit_kobo" BIGINT NOT NULL DEFAULT 0,
    "override_reason" TEXT,
    "capacity_override_reason" TEXT,
    "price_stale" BOOLEAN NOT NULL DEFAULT false,
    "ical_warning_ack" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "created_by_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_line" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "fee_kind" TEXT,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_amount_kobo" BIGINT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "refundable" BOOLEAN NOT NULL,
    "recognition" TEXT NOT NULL,

    CONSTRAINT "booking_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_event" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_member_id" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_org_id_phone_e164_idx" ON "guest"("org_id", "phone_e164");

-- CreateIndex
CREATE INDEX "booking_org_id_unit_id_check_in_idx" ON "booking"("org_id", "unit_id", "check_in");

-- CreateIndex
CREATE INDEX "booking_org_id_status_hold_until_idx" ON "booking"("org_id", "status", "hold_until");

-- CreateIndex
CREATE UNIQUE INDEX "booking_org_id_ref_key" ON "booking"("org_id", "ref");

-- CreateIndex
CREATE INDEX "booking_line_org_id_booking_id_idx" ON "booking_line"("org_id", "booking_id");

-- CreateIndex
CREATE INDEX "booking_status_event_org_id_booking_id_at_idx" ON "booking_status_event"("org_id", "booking_id", "at");

-- CreateIndex
CREATE INDEX "notification_org_id_user_id_created_at_idx" ON "notification"("org_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_org_id_user_id_dedupe_key_key" ON "notification"("org_id", "user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "guest" ADD CONSTRAINT "guest_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line" ADD CONSTRAINT "booking_line_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_status_event" ADD CONSTRAINT "booking_status_event_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_event" ADD CONSTRAINT "booking_status_event_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ── Boogbe: raw SQL Prisma cannot model ──
-- (FKs to organization/user are declared in schema.prisma and generated above.)

ALTER TABLE booking ADD CONSTRAINT booking_range_chk CHECK (check_out > check_in);
ALTER TABLE booking ADD CONSTRAINT booking_status_chk CHECK (status IN ('tentative','confirmed','checked_in','checked_out','cancelled','no_show'));
ALTER TABLE booking ADD CONSTRAINT booking_source_chk CHECK (source IN ('whatsapp','phone','walk_in','direct','airbnb','booking_com','other'));
ALTER TABLE booking ADD CONSTRAINT booking_totals_chk CHECK (final_total_kobo >= 0 AND computed_total_kobo >= 0 AND deposit_kobo >= 0);
-- No two active bookings on one unit may share a night (BKG-02). Same-day turnover is allowed: [check_in, check_out).
ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(check_in, check_out, '[)') WITH &&)
  WHERE (status IN ('tentative','confirmed','checked_in'));
ALTER TABLE booking_line ADD CONSTRAINT booking_line_kind_chk CHECK (kind IN ('accommodation','fee','deposit','adjustment'));

CREATE INDEX guest_name_trgm ON guest USING gin (full_name gin_trgm_ops);
CREATE INDEX guest_email_lower ON guest (org_id, lower(email));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guest','booking','booking_line','booking_status_event','notification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Status history is append-only.
REVOKE UPDATE, DELETE ON booking_status_event FROM boogbe_app;
