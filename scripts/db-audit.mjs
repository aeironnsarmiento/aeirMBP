#!/usr/bin/env node
/**
 * Database safety and performance audit.
 *
 * Two jobs, in this order of importance:
 *
 * 1. **Safety gates.** The app connects as `postgres`, which carries
 *    `rolbypassrls` — so RLS is invisible to it and a regression here is
 *    silent. Nothing in the test suite can catch a migration that hands
 *    `anon` write access to a new table, because the tests run against PGlite
 *    where Supabase's roles do not exist. This script is the only thing that
 *    looks. Any non-zero gate exits 1.
 *
 * 2. **Read-path timing.** The statements below mirror what
 *    `widgets/music/queries/aggregations.ts` issues for one `/api/music`
 *    request. They are a model, not the code path itself — `read-path.test.ts`
 *    is what holds the model honest by asserting the real query layer issues
 *    the same number of round trips.
 *
 *     npm run db:audit          human-readable, exits 1 on a failed gate
 *     npm run db:audit -- --json    one JSON object on stdout
 */

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

const JSON_MODE = process.argv.includes("--json");
const REPEATS = Number(process.env.AUDIT_REPEATS ?? 5);

/** Tables this application owns. Anything else in `public` is an orphan. */
const OWNED_TABLES = [
  "site_setting",
  "music_scrobble",
  "music_track",
  "music_artist",
  "music_job_state",
];

/** Roles that must never hold a privilege on a table in `public`. */
const FORBIDDEN_GRANTEES = ["anon", "authenticated"];

/**
 * The statements one `/api/music?view=artists` request issues.
 *
 * The handler runs these concurrently, so they are timed that way here too.
 * `read_path_roundtrips` is the array length; the count is pinned by
 * `widgets/music/queries/roundtrips.test.ts`, which is what stops this model
 * from drifting away from the query layer it claims to represent.
 */
const READ_PATH = [
  {
    label: "topArtists",
    sql: `select s.artist_key,
                 mode() within group (order by s.artist_name),
                 coalesce(mode() within group (order by a.picture_url),
                          mode() within group (order by t.artwork_url)),
                 count(*) as plays
          from music_scrobble s
          left join music_track t on t.track_key = s.track_key
          left join music_artist a on a.artist_key = s.artist_key
          where s.played_at >= now() - interval '7 days'
          group by s.artist_key
          order by count(*) desc, s.artist_key
          limit 50`,
  },
  {
    label: "summary",
    sql: `select count(*),
                 count(distinct s.artist_key),
                 count(distinct s.track_key),
                 min(s.played_at), max(s.played_at),
                 count(*) filter (where s.played_at >= now() - interval '7 days'),
                 sum(t.duration_ms),
                 count(*) filter (where t.duration_ms is null)
          from music_scrobble s
          left join music_track t on t.track_key = s.track_key`,
  },
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function audit(sql) {
  const tables = await sql`
    select c.relname as name,
           c.relrowsecurity as rls_enabled,
           pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`;

  const grants = await sql`
    select distinct table_name, grantee
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = any(${FORBIDDEN_GRANTEES})`;

  // The root cause a one-time REVOKE does not fix: without clearing these,
  // the next migration's CREATE TABLE is born readable and writable by anon.
  const defaultPrivs = await sql`
    select defaclacl::text as acl from pg_default_acl
    where defaclnamespace = 'public'::regnamespace`;
  const leakyDefaults = defaultPrivs.filter((row) =>
    FORBIDDEN_GRANTEES.some((role) => row.acl.includes(`${role}=`)),
  );

  const policies = await sql`
    select tablename, policyname from pg_policies where schemaname = 'public'`;

  const indexes = await sql`
    select relname as table, indexrelname as name, idx_scan,
           pg_relation_size(indexrelid) as bytes
    from pg_stat_user_indexes
    where schemaname = 'public'
    order by idx_scan, pg_relation_size(indexrelid) desc`;

  // An index on an owned table that has never once been chosen is pure write
  // amplification on the ingest path. Primary keys are excluded: their scan
  // count says nothing about the uniqueness they enforce.
  const unused = indexes.filter(
    (i) =>
      OWNED_TABLES.includes(i.table) &&
      Number(i.idx_scan) === 0 &&
      !i.name.endsWith("_pkey"),
  );

  const [{ size: dbBytes }] = await sql`
    select pg_database_size(current_database()) as size`;

  // Issued concurrently, matching the handler's Promise.all. postgres.js
  // pipelines them onto the single pooled connection, so the wall clock is one
  // round trip rather than the sum.
  const timings = [];
  for (let run = 0; run < REPEATS; run += 1) {
    const started = performance.now();
    await Promise.all(READ_PATH.map((statement) => sql.unsafe(statement.sql)));
    timings.push(performance.now() - started);
  }

  const orphans = tables
    .map((t) => t.name)
    .filter((name) => !OWNED_TABLES.includes(name));

  return {
    gates: {
      tables_without_rls: tables.filter((t) => !t.rls_enabled).length,
      tables_granted_to_anon: new Set(grants.map((g) => g.table_name)).size,
      default_privs_granting_anon: leakyDefaults.length,
    },
    diagnostics: {
      read_path_p50_ms: Math.round(median(timings) * 100) / 100,
      read_path_roundtrips: READ_PATH.length,
      public_table_count: tables.length,
      orphan_tables: orphans.length,
      policy_count: policies.length,
      unused_index_count: unused.length,
      unused_index_bytes: unused.reduce((sum, i) => sum + Number(i.bytes), 0),
      db_size_bytes: Number(dbBytes),
    },
    detail: {
      tables_without_rls: tables.filter((t) => !t.rls_enabled).map((t) => t.name),
      tables_granted_to_anon: [
        ...new Set(grants.map((g) => `${g.table_name}:${g.grantee}`)),
      ].sort(),
      orphan_tables: orphans,
      unused_indexes: unused.map((i) => `${i.table}.${i.name} (${i.bytes}B)`),
      read_path_timings_ms: timings.map((t) => Math.round(t * 100) / 100),
    },
  };
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Fill in .env.local first.");
  process.exit(2);
}

const sql = postgres(connectionString, { prepare: false, max: 1 });
let report;
try {
  report = await audit(sql);
} finally {
  await sql.end();
}

const failed = Object.entries(report.gates).filter(([, value]) => value !== 0);

if (JSON_MODE) {
  console.log(JSON.stringify({ ...report, ok: failed.length === 0 }, null, 2));
} else {
  console.log("Safety gates");
  for (const [gate, value] of Object.entries(report.gates)) {
    console.log(`  ${value === 0 ? "PASS" : "FAIL"}  ${gate}: ${value}`);
  }
  console.log("\nDiagnostics");
  for (const [key, value] of Object.entries(report.diagnostics)) {
    console.log(`  ${key}: ${value}`);
  }
  for (const [key, value] of Object.entries(report.detail)) {
    if (Array.isArray(value) && value.length > 0) {
      console.log(`\n${key}:`);
      for (const entry of value) console.log(`  - ${entry}`);
    }
  }
}

process.exit(failed.length === 0 ? 0 : 1);
