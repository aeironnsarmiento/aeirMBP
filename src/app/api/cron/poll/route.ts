import { requireCronSecret } from "@/lib/auth/guard";
import { runPoll } from "@/widgets/music/server/poll";

export const maxDuration = 60;

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
    console.error("poll-failed", error);
    // The heartbeat write already happened inside runPoll, so a failed run
    // still counts as database activity and the project stays awake.
    return Response.json(
      { ok: false, error: "poll-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
