import { requireOwner } from "@/lib/auth/guard";
import {
  readBackfillProgress,
  runBackfill,
} from "@/widgets/music/server/backfill";

export const maxDuration = 60;

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    return Response.json(await readBackfillProgress(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("backfill-read-failed", error);
    return Response.json(
      { error: "backfill-read-failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let restart = false;
  try {
    const body = (await request.json()) as { restart?: unknown } | null;
    restart = body?.restart === true;
  } catch {
  }

  try {
    return Response.json(await runBackfill({ restart }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("backfill-failed", error);
    return Response.json(
      { error: "backfill-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
