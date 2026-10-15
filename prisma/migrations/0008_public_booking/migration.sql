-- 0008 Public booking requests (Stage 1 of online booking): per-org switch and settings,
-- per-unit listing flag, the `website` booking source, and the slug lookup public routes use.

ALTER TABLE unit ADD COLUMN public_listed boolean NOT NULL DEFAULT false;

ALTER TABLE org_settings
  ADD COLUMN public_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN public_hold_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN public_origins      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN public_site_url     text,
  ADD COLUMN notify_emails       text[]  NOT NULL DEFAULT '{}';
ALTER TABLE org_settings ADD CONSTRAINT org_settings_public_hold_chk CHECK (public_hold_minutes BETWEEN 15 AND 1440);

ALTER TABLE booking DROP CONSTRAINT booking_source_chk;
ALTER TABLE booking ADD CONSTRAINT booking_source_chk
  CHECK (source IN ('whatsapp','phone','walk_in','direct','airbnb','booking_com','website','other'));

-- Public routes have no org context yet; this is the only cross-org read they make (same pattern as ical_export_lookup).
CREATE OR REPLACE FUNCTION public_org_lookup(p_slug text)
RETURNS TABLE (org_id text, timezone text, public_origins text[], public_hold_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.timezone, s.public_origins, s.public_hold_minutes
  FROM organization o JOIN org_settings s ON s.org_id = o.id
  WHERE o.slug = p_slug AND o.status = 'active' AND s.public_enabled
$$;
ALTER FUNCTION public_org_lookup(text) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION public_org_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_org_lookup(text) TO boogbe_app;
