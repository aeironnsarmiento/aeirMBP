-- Takes the PostgREST roles off the public schema.
--
-- Migration 0003 enabled RLS, which is necessary but not sufficient. Two holes
-- remain, and both are invisible to the test suite because PGlite has no
-- Supabase roles:
--
--   1. `anon` and `authenticated` held direct table grants — SELECT, INSERT,
--      UPDATE, DELETE and TRUNCATE on every table in `public`. RLS restricts
--      which *rows* a role may touch; it does not withdraw the privilege. A
--      table with RLS on and a grant still standing is one CREATE POLICY away
--      from being readable again, and TRUNCATE ignores RLS entirely.
--
--   2. ALTER DEFAULT PRIVILEGES was re-granting all of the above to every
--      *future* table in `public`. Without clearing it, the next migration's
--      CREATE TABLE would be born exposed and this fix would silently rot.
--
-- The anon key is public by design — it ships to browsers — so these grants
-- were the only thing between an anon-key holder and `TRUNCATE music_scrobble`.
--
-- This application does not use PostgREST. It connects as `postgres` over a
-- direct Postgres socket (lib/db/client.ts), and that role has rolbypassrls,
-- so nothing here changes what the app can do. `npm run db:audit` fails if any
-- of it regresses.
--
-- `service_role` deliberately keeps its grants. It is a server-side secret,
-- never shipped to a browser, and revoking it would break the Supabase
-- dashboard's table editor without shutting any door an anon-key holder could
-- otherwise walk through.
--
-- Every statement is wrapped in a role-existence check: `anon` and
-- `authenticated` are Supabase-provisioned and do not exist in the PGlite
-- instance the tests migrate, where a bare REVOKE would abort the migration
-- and take the whole suite with it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE USAGE ON SCHEMA public FROM anon;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE USAGE ON SCHEMA public FROM authenticated;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END
$$;--> statement-breakpoint

-- Default-privilege entries are attached to the role that created them, so the
-- block above clears only the set `postgres` owns. An identical set owned by
-- `supabase_admin` also grants `anon` every privilege on new tables.
--
-- `postgres` is not a member of `supabase_admin` and cannot alter its default
-- privileges — the attempt fails with "permission denied to change default
-- privileges". That is caught rather than allowed to abort the migration,
-- because the `postgres`-owned set is the one that actually governs this
-- project: every table here is created by Drizzle running as `postgres`, so a
-- new table inherits the defaults cleared above and is born unexposed.
--
-- The residual risk is narrow — a table created in `public` by `supabase_admin`
-- itself would still be granted to `anon`. Clearing that requires running the
-- statements below from the Supabase SQL editor, which connects with more
-- authority than the application's role. `npm run db:audit` reports the
-- remaining entries either way, so this cannot rot unnoticed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Could not clear supabase_admin default privileges (needs a '
                 'superuser connection). The postgres-owned defaults, which '
                 'govern tables this project creates, were cleared. Run this '
                 'block from the Supabase SQL editor to finish the job.';
END
$$;
