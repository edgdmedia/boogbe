-- CreateTable
CREATE TABLE "owner" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "notes" TEXT,
    "user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "area" TEXT,
    "default_owner_id" TEXT,
    "fee_type" TEXT NOT NULL DEFAULT 'none',
    "fee_bps" INTEGER NOT NULL DEFAULT 0,
    "fee_fixed_monthly_kobo" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "max_guests" INTEGER NOT NULL,
    "nightly_rate_kobo" BIGINT NOT NULL,
    "default_assignee_member_id" TEXT,
    "check_in_instructions" TEXT,
    "owner_follows_property" BOOLEAN NOT NULL DEFAULT true,
    "fee_override" BOOLEAN NOT NULL DEFAULT false,
    "fee_type" TEXT NOT NULL DEFAULT 'none',
    "fee_bps" INTEGER NOT NULL DEFAULT 0,
    "fee_fixed_monthly_kobo" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_ownership" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "owner_id" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_fee" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "basis" TEXT NOT NULL,
    "included_guests" INTEGER,
    "refundable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "feed_id" TEXT,
    "external_uid" TEXT,
    "external_summary" TEXT,
    "created_by_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_member_id" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_org_id_name_idx" ON "owner"("org_id", "name");

-- CreateIndex
CREATE INDEX "property_org_id_sort_order_idx" ON "property"("org_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "unit_org_id_property_id_name_key" ON "unit"("org_id", "property_id", "name");

-- CreateIndex
CREATE INDEX "unit_ownership_org_id_unit_id_idx" ON "unit_ownership"("org_id", "unit_id");

-- CreateIndex
CREATE INDEX "unit_fee_org_id_unit_id_idx" ON "unit_fee"("org_id", "unit_id");

-- CreateIndex
CREATE INDEX "block_org_id_unit_id_start_idx" ON "block"("org_id", "unit_id", "start");

-- CreateIndex
CREATE UNIQUE INDEX "file_key_key" ON "file"("key");

-- CreateIndex
CREATE INDEX "file_org_id_kind_idx" ON "file"("org_id", "kind");

-- AddForeignKey
ALTER TABLE "owner" ADD CONSTRAINT "owner_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_default_owner_fk" FOREIGN KEY ("default_owner_id") REFERENCES "owner"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unit_ownership" ADD CONSTRAINT "unit_ownership_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_ownership" ADD CONSTRAINT "unit_ownership_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "owner"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unit_ownership" ADD CONSTRAINT "unit_ownership_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unit_fee" ADD CONSTRAINT "unit_fee_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_fee" ADD CONSTRAINT "unit_fee_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "file" ADD CONSTRAINT "file_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ── Boogbe: raw SQL Prisma cannot model ──
-- (FKs to organization/owner are declared in schema.prisma and generated above.)

-- Domain checks
ALTER TABLE property ADD CONSTRAINT property_fee_type_chk CHECK (fee_type IN ('pct_gross','pct_net','none'));
ALTER TABLE property ADD CONSTRAINT property_fee_bps_chk  CHECK (fee_bps BETWEEN 0 AND 10000);
ALTER TABLE unit     ADD CONSTRAINT unit_fee_type_chk     CHECK (fee_type IN ('pct_gross','pct_net','none'));
ALTER TABLE unit     ADD CONSTRAINT unit_fee_bps_chk      CHECK (fee_bps BETWEEN 0 AND 10000);
ALTER TABLE unit     ADD CONSTRAINT unit_rate_chk         CHECK (nightly_rate_kobo > 0);
ALTER TABLE unit_fee ADD CONSTRAINT unit_fee_kind_chk     CHECK (kind IN ('caution_deposit','cleaning','extra_guest','other'));
ALTER TABLE unit_fee ADD CONSTRAINT unit_fee_basis_chk    CHECK (basis IN ('per_stay','per_night','per_guest_night'));
ALTER TABLE block    ADD CONSTRAINT block_range_chk       CHECK ("end" > start);
ALTER TABLE block    ADD CONSTRAINT block_source_chk      CHECK (source IN ('manual','ical'));
ALTER TABLE unit_ownership ADD CONSTRAINT unit_ownership_range_chk CHECK (effective_to IS NULL OR effective_to > effective_from);

-- No overlapping ownership periods per unit; no overlapping manual blocks per unit.
ALTER TABLE unit_ownership ADD CONSTRAINT unit_ownership_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&);
ALTER TABLE block ADD CONSTRAINT block_manual_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(start, "end", '[)') WITH &&) WHERE (source = 'manual');
CREATE UNIQUE INDEX block_ical_uid ON block (feed_id, external_uid) WHERE source = 'ical';

-- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owner','property','unit','unit_ownership','unit_fee','block','file'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
