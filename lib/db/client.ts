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
 * `prepare: false` is required for Supabase's transaction-mode pooler, which
 * does not support prepared statements.
 */
export function getDb(): Database {
  if (cached) return cached.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 });
  const db = drizzle(sql, { schema });
  cached = { sql, db };
  return db;
}

/** Closes the pooled connection. Used by scripts and tests, not by request paths. */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.sql.end();
  cached = undefined;
}
