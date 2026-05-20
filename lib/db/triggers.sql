-- Postgres triggers + functions managed by the application.
-- Applied by lib/db/migrate.ts AFTER drizzle migrations succeed.
-- Idempotent — safe to run on every deploy (CREATE OR REPLACE / DROP IF EXISTS).
--
-- Purpose: BUMP version + updated_at AT THE DATABASE LEVEL on every UPDATE.
-- Application code cannot accidentally forget to bump version — the DB enforces it.
-- Lineage: golf-bd silent overwrites when two users edited the same row.

CREATE OR REPLACE FUNCTION update_version_and_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users table
DROP TRIGGER IF EXISTS users_version_trigger ON users;
CREATE TRIGGER users_version_trigger
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_version_and_timestamp();

-- Future editable tables: add a trigger here as they land.
-- DROP TRIGGER IF EXISTS notes_version_trigger ON notes;
-- CREATE TRIGGER notes_version_trigger
--   BEFORE UPDATE ON notes
--   FOR EACH ROW EXECUTE FUNCTION update_version_and_timestamp();
--
-- DROP TRIGGER IF EXISTS tags_version_trigger ON tags;
-- CREATE TRIGGER tags_version_trigger
--   BEFORE UPDATE ON tags
--   FOR EACH ROW EXECUTE FUNCTION update_version_and_timestamp();

-- Sanity comment so anyone reading the DB knows where to look:
COMMENT ON FUNCTION update_version_and_timestamp() IS
  'Bumps version + updated_at on every UPDATE. Applied to all editable tables. Managed in lib/db/triggers.sql.';
