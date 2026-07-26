import { requireOwner } from "@/lib/auth/guard";
import {
  SettingsValidationError,
  readSiteSettings,
  writeSiteSettings,
  type SiteSettings,
} from "@/lib/site/settings";
import { UploadRejected, uploadAvatar } from "@/lib/site/storage";
import { readBackfillProgress } from "@/widgets/music/server/backfill";

/**
 * Settings mutation handlers (R8, R33, R34).
 *
 * Scope is site chrome the owner authors: background, glass opacity and the
 * avatar. About copy is edited through the About widget's own surface rather
 * than duplicated here — Settings opens that surface instead of reimplementing
 * it.
 *
 * Every entry point calls requireOwner even though middleware covers the path,
 * so the route fails closed on its own (R34, AE2).
 */

const EDITABLE_FIELDS = ["backgroundId", "glassOpacity"] as const;

function pickEditable(body: Record<string, unknown>): Partial<SiteSettings> {
  const patch: Partial<SiteSettings> = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = body[field];
    }
  }
  return patch;
}

/** Current settings plus job progress, for the Settings panel. */
export async function handleSettingsRead(): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  const [settings, backfill] = await Promise.all([
    readSiteSettings(),
    readBackfillProgress(),
  ]);

  return Response.json(
    { settings, backfill },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function handleSettingsUpdate(request: Request): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      return await handleAvatarUpload(request);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const settings = await writeSiteSettings(pickEditable(body));

    return Response.json(settings, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleAvatarUpload(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get("avatar");

  if (!(file instanceof Blob)) {
    return Response.json({ error: "no-file" }, { status: 400 });
  }

  const path = await uploadAvatar(file as Blob & { type: string; size: number });
  const settings = await writeSiteSettings({ avatarPath: path });

  return Response.json(settings, { headers: { "cache-control": "no-store" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof SettingsValidationError) {
    return Response.json(
      { error: error.message, field: error.field },
      { status: 422 },
    );
  }
  if (error instanceof UploadRejected) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "settings-update-failed" },
    { status: 500 },
  );
}
