import { requireCronSecret } from "@/lib/auth/guard";
import { runPoll } from "@/widgets/music/server/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scheduled incremental poll.
 *
 * Invoked by Vercel Cron once a day — see `vercel.json`. Anything faster fails
 * deployment on the Hobby plan, which is why the poll resumes from the newest
 * stored timestamp rather than assuming it runs often (KTD5).
 *
 * Guarded by a shared secret rather than an owner session: the caller is the
 * scheduler, not a person. Without it, any visitor could drive last.fm traffic
 * from this deployment.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const result = await runPoll();
    return Response.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // The heartbeat write already happened inside runPoll, so a failed run
    // still counts as database activity and the project stays awake.
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "poll-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
