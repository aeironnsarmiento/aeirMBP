-- Drops the About content rows. Their values now live in source.
--
-- The site's written identity — bio copy, display name, handle, location and
-- links — moved to `src/lib/site/profile.ts` as Committed Content. Nothing
-- reads these keys anymore: `SETTING_KEYS` no longer lists them, so
-- `readSiteSettings` filters them out of its `WHERE key IN (...)` and they
-- would sit here inert rather than wrong.
--
-- They are deleted rather than left because an orphan row that no reader can
-- see is worse than no row: the next person to add an `about.*` key would
-- silently inherit a stale value written before this change.
--
-- Hand-written rather than generated. `drizzle-kit generate` derives
-- migrations from the schema, and no table shape changed here — only data.
--
-- APPLYING THIS: `npm run db:migrate` exits clean against this database
-- without applying anything (confirmed on drizzle-kit 0.31.10 / drizzle-orm
-- 0.45.2; it left 0003 and 0004 unapplied while reporting nothing wrong). Run
-- the statement directly, then insert the `drizzle.__drizzle_migrations` row
-- yourself: `hash` is the sha256 of this whole file, `created_at` is this
-- entry's `when` value from `drizzle/meta/_journal.json`. Verify by querying,
-- not by the command's exit code.
--
-- THIS IS THE ONLY OTHER COPY. Before running it, confirm the five values are
-- committed in source and recorded in the commit body — after this there is
-- no way back to them from the database.

DELETE FROM "site_setting"
WHERE "key" IN (
  'about.copy',
  'about.name',
  'about.handle',
  'about.location',
  'about.links'
);
