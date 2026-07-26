import { requireOwner } from "@/lib/auth/guard";
import {
  readBackfillProgress,
  runBackfill,
} from "@/widgets/music/server/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long enough for a batch of pages plus the rate-limit gaps between them. */
export const maxDuration = 60;

/** Backfill progress, for the Settings widget's status line. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  return Response.json(await readBackfillProgress(), {
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Advances the import by one bounded batch of pages.
 *
 * The owner calls this repeatedly from Settings until `done` is true. Guarded
 * here as well as in middleware so the route fails closed on its own (R34).
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let restart = false;
  try {
    const body = (await request.json()) as { restart?: unknown } | null;
    restart = body?.restart === true;
  } catch {
    // No body is the common case — advance from the stored cursor.
  }

  try {
    return Response.json(await runBackfill({ restart }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "backfill-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
