import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: { sql: postgres.Sql; db: Database } | undefined;

/**
 * Lazily-constructed Drizzle client.
 *
 * Lazy because module-level construction would make `next build` fail on any
 * machine without DATABASE_URL set, and because serverless invocations should
 * only open a socket when a request actually touches the database.
 *
 * `prepare: false` is required by Supabase's transaction-mode pooler, which
 * does not support prepared statements. It is also correct on the session
 * pooler, just unnecessary there — see `assertPoolerPort` for why the
 * distinction is worth a runtime warning rather than a comment.
 *
 * `max: 1` because a serverless invocation handles one request: a larger pool
 * would hold idle server-side connections against a 60-connection ceiling for
 * no gain. It does not serialize concurrent queries — postgres.js pipelines
 * them onto the one connection, which is what lets the read path issue its
 * view and summary queries in a single round trip.
 */
export function getDb(): Database {
  if (cached) return cached.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  assertPoolerPort(connectionString);

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
    // A connection that dies in the pooler is otherwise held until the OS
    // notices. Both bounds are well inside Vercel's 60s maxDuration, so a
    // wedged socket surfaces as a failed request rather than a hung function.
    connect_timeout: 10,
    idle_timeout: 20,
  });
  const db = drizzle(sql, { schema });
  cached = { sql, db };
  return db;
}

/**
 * Warns when the connection string points at the session pooler.
 *
 * Supabase runs two poolers on the same host. Port 6543 is transaction mode:
 * a server connection is held only for the duration of a statement, so a burst
 * of serverless invocations shares a small pool. Port 5432 is session mode,
 * where every client connection holds a server connection for its whole life —
 * on Vercel that means one per warm lambda, against a ceiling of 60.
 *
 * This is a warning rather than a thrown error because session mode works
 * fine at this deployment's traffic; it fails only under concurrency, which is
 * exactly when a hard failure at connect time would be least welcome.
 */
function assertPoolerPort(connectionString: string): void {
  let port: string;
  try {
    port = new URL(connectionString).port;
  } catch {
    return; // Not our business to validate the URL; postgres() will complain.
  }

  if (port === "5432" && connectionString.includes("pooler.supabase.com")) {
    console.warn(
      "[db] DATABASE_URL uses the session pooler (port 5432). Serverless " +
        "deployments should use the transaction pooler on port 6543, which " +
        "does not hold a server connection per warm function instance.",
    );
  }
}

/** Closes the pooled connection. Used by scripts and tests, not by request paths. */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.sql.end();
  cached = undefined;
}
