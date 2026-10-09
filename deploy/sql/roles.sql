-- Local/CI passwords only; production passwords are set per docs/RUNBOOK.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boogbe_migrator') THEN
    CREATE ROLE boogbe_migrator LOGIN PASSWORD 'migrator' CREATEDB BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boogbe_app') THEN
    CREATE ROLE boogbe_app LOGIN PASSWORD 'app' NOBYPASSRLS NOSUPERUSER;
  END IF;
END $$;
