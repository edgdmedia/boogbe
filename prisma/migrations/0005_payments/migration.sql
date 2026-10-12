-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "reference" TEXT,
    "external_ref" TEXT,
    "note" TEXT,
    "receipt_no" TEXT,
    "voids_payment_id" TEXT,
    "recorded_by_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_org_id_booking_id_created_at_idx" ON "payment"("org_id", "booking_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_org_id_received_on_idx" ON "payment"("org_id", "received_on");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_voids_fk" FOREIGN KEY ("voids_payment_id") REFERENCES "payment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ── Boogbe: raw SQL Prisma cannot model ──
-- (payment_org_fk and payment_voids_fk are declared in schema.prisma and generated above.)
ALTER TABLE payment ADD CONSTRAINT payment_amount_chk CHECK (amount_kobo > 0);
ALTER TABLE payment ADD CONSTRAINT payment_kind_chk CHECK (kind IN ('payment','refund','deposit_received','deposit_returned','deposit_withheld','void'));
ALTER TABLE payment ADD CONSTRAINT payment_method_chk CHECK (method IN ('bank_transfer','cash','pos','card','paystack','other'));
ALTER TABLE payment ADD CONSTRAINT payment_void_target_chk CHECK ((kind = 'void') = (voids_payment_id IS NOT NULL));
CREATE UNIQUE INDEX payment_one_void_per_entry ON payment (voids_payment_id) WHERE kind = 'void';
CREATE UNIQUE INDEX payment_receipt_no ON payment (org_id, receipt_no) WHERE receipt_no IS NOT NULL;

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON payment USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
-- Money is append-only (PAY-04): corrections are void rows, never edits.
REVOKE UPDATE, DELETE ON payment FROM boogbe_app;

-- Views run with the caller's rights so RLS still applies.
CREATE VIEW payment_effective WITH (security_invoker = true) AS
  SELECT p.* FROM payment p
  WHERE p.kind <> 'void' AND NOT EXISTS (SELECT 1 FROM payment v WHERE v.kind = 'void' AND v.voids_payment_id = p.id);

CREATE VIEW booking_money WITH (security_invoker = true) AS
  SELECT b.id AS booking_id, b.org_id, b.status, b.final_total_kobo,
    COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'payment'), 0)::bigint AS paid_kobo,
    COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'refund'), 0)::bigint AS refunded_kobo,
    (COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'deposit_received'), 0)
      - COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind IN ('deposit_returned','deposit_withheld')), 0))::bigint AS deposit_held_kobo,
    CASE WHEN b.status = 'cancelled' THEN 0
         ELSE b.final_total_kobo - COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'payment'), 0) + COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'refund'), 0)
    END::bigint AS balance_kobo
  FROM booking b LEFT JOIN payment_effective e ON e.booking_id = b.id
  GROUP BY b.id;
GRANT SELECT ON payment_effective, booking_money TO boogbe_app;
