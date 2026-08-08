import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: { sql: postgres.Sql; db: Database } | undefined;

export function getDb(): Database {
  if (cached) return cached.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set.",
    );
  }

  assertPoolerPort(connectionString);

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  const db = drizzle(sql, { schema });
  cached = { sql, db };
  return db;
}

function assertPoolerPort(connectionString: string): void {
  let port: string;
  try {
    port = new URL(connectionString).port;
  } catch {
    return;
  }

  if (port === "5432" && connectionString.includes("pooler.supabase.com")) {
    console.warn(
      "[db] DATABASE_URL uses the session pooler (port 5432). Serverless " +
        "deployments should use the transaction pooler on port 6543, which " +
        "does not hold a server connection per warm function instance.",
    );
  }
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.sql.end();
  cached = undefined;
}
