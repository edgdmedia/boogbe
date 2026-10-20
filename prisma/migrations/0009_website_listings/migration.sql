-- 0009 Website listings (WL): listing pages, slug history, photos, the unit link and
-- org_settings.site_version. The raw section below adds the domain CHECKs, the deferrable
-- cover FK, RLS and public_site_lookup() — same patterns as 0003_inventory and 0008_public_booking.

-- AlterTable
ALTER TABLE "org_settings" ADD COLUMN     "site_version" BIGINT NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "unit" ADD COLUMN     "listing_id" TEXT,
ADD COLUMN     "listing_label" TEXT;

-- CreateTable
CREATE TABLE "listing" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "area" TEXT,
    "highlight" TEXT,
    "intro" TEXT,
    "description" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "house_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bathrooms_label" TEXT,
    "layout_label" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "cover_photo_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_slug_history" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "replaced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_photo" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "variants" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "variants_ready" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "source_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_org_id_sort_order_idx" ON "listing"("org_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "listing_org_id_slug_key" ON "listing"("org_id", "slug");

-- CreateIndex
CREATE INDEX "listing_slug_history_org_id_listing_id_idx" ON "listing_slug_history"("org_id", "listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_slug_history_org_id_slug_key" ON "listing_slug_history"("org_id", "slug");

-- CreateIndex
CREATE INDEX "listing_photo_org_id_listing_id_idx" ON "listing_photo"("org_id", "listing_id");

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_listing_fk" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_cover_photo_fk" FOREIGN KEY ("cover_photo_id") REFERENCES "listing_photo"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "listing_slug_history" ADD CONSTRAINT "listing_slug_history_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "listing_slug_history" ADD CONSTRAINT "listing_slug_history_listing_fk" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "listing_photo" ADD CONSTRAINT "listing_photo_org_fk" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "listing_photo" ADD CONSTRAINT "listing_photo_listing_fk" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ── Boogbe: raw SQL Prisma cannot model ──

-- Domain checks (plan: Global Constraints).
ALTER TABLE listing ADD CONSTRAINT listing_slug_chk CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60);
ALTER TABLE listing_slug_history ADD CONSTRAINT listing_slug_history_slug_chk CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60);
ALTER TABLE listing_photo ADD CONSTRAINT listing_photo_category_chk CHECK (category IN (
  'Living spaces','Bedrooms','Kitchen & dining','Bathrooms','Outdoor spaces','Building & shared spaces','Cinema & leisure','Design details'
));

-- Setting a cover before the photo row exists (attach + cover in one transaction) needs a deferrable FK.
ALTER TABLE listing DROP CONSTRAINT listing_cover_photo_fk;
ALTER TABLE listing ADD CONSTRAINT listing_cover_photo_fk FOREIGN KEY (cover_photo_id)
  REFERENCES listing_photo(id) ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

-- RLS — one org's listings, photos and slug history are invisible to another org.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listing','listing_slug_history','listing_photo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Public /site routes have no org context; this is their only cross-org read, and it needs only an
-- ACTIVE org — unlike public_org_lookup it ignores public_enabled, so switching online booking off
-- never takes the apartment pages down (plan deviation 4). Ownership and grants follow public_org_lookup.
CREATE OR REPLACE FUNCTION public_site_lookup(p_slug text)
RETURNS TABLE (org_id text, timezone text, public_enabled boolean, public_origins text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.timezone, s.public_enabled, s.public_origins
  FROM organization o JOIN org_settings s ON s.org_id = o.id
  WHERE o.slug = p_slug AND o.status = 'active'
$$;
ALTER FUNCTION public_site_lookup(text) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION public_site_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_site_lookup(text) TO boogbe_app;

