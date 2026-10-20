-- 0010 Listing-photo claim (WL T-WL-05): the worker leases unprocessed photos across orgs,
-- the same shape as claim_outbound (0007) — SKIP LOCKED so two ticks never race the same row,
-- and attempts is counted at claim time so a crash still burns one of the three tries.

CREATE OR REPLACE FUNCTION claim_listing_photos(p_limit int)
RETURNS TABLE (id text, org_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE listing_photo m SET attempts = m.attempts + 1
  WHERE m.id IN (
    SELECT o.id FROM listing_photo o
    WHERE o.variants_ready = false AND o.attempts < 3
    ORDER BY o.created_at LIMIT p_limit FOR UPDATE OF o SKIP LOCKED)
  RETURNING m.id, m.org_id
$$;
ALTER FUNCTION claim_listing_photos(int) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION claim_listing_photos(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_listing_photos(int) TO boogbe_app;
