import { requireOwner } from "@/lib/auth/guard";
import {
  SettingsValidationError,
  readSiteSettings,
  writeSiteSettings,
  type SiteSettings,
} from "@/lib/site/settings";
import {
  UploadRejected,
  checkStorage,
  deleteAsset,
  isAssetPath,
  repairStorage,
  signAssetUpload,
  uploadAvatar,
} from "@/lib/site/storage";
import {
  CUSTOM_BACKGROUND_ID,
  DEFAULT_BACKGROUND_ID,
} from "@/lib/theme/backgrounds";
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

const EDITABLE_FIELDS = [
  "backgroundId",
  "frameOpacity",
  "paneOpacity",
] as const;

/**
 * Grants permission to upload a background, without the bytes passing through
 * this server (R13).
 *
 * The hosting platform caps a function's request body at 4.5MB, which no
 * usable GIF wallpaper fits under. The client declares what it is about to
 * send, this checks it against the background rules, and the file then travels
 * straight to storage.
 */
export async function handleUploadSign(request: Request): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { type?: unknown; size?: unknown };

    if (typeof body.type !== "string" || typeof body.size !== "number") {
      return Response.json(
        { error: "Describe the file you want to upload: its type and size." },
        { status: 400 },
      );
    }

    const target = await signAssetUpload("background", {
      type: body.type,
      size: body.size,
    });

    return Response.json(target, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Records a background the browser has finished uploading, and selects it.
 *
 * The path is checked against the shape this app mints rather than trusted, so
 * the confirm step cannot be used to point the site at an arbitrary object.
 */
export async function handleUploadConfirm(request: Request): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = (await request.json()) as { path?: unknown };

    if (typeof body.path !== "string" || !isAssetPath("background", body.path)) {
      return Response.json(
        { error: "That is not an upload this site issued." },
        { status: 400 },
      );
    }

    const settings = await writeSiteSettings({
      backgroundPath: body.path,
      backgroundId: CUSTOM_BACKGROUND_ID,
    });

    return Response.json(settings, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Discards the uploaded background and returns the site to a preset.
 *
 * The stored object goes too, not just the reference to it. Leaving the bytes
 * behind would keep the owner paying for storage they believe they cleared,
 * and the bucket has no other way to reach them — paths carry a timestamp, so
 * an orphan is not something a later upload overwrites.
 *
 * The settings row is written first. If the delete then fails the site is
 * already off the custom background, which is what was asked for; the reverse
 * order can delete the bytes and leave the site pointing at them.
 */
export async function handleBackgroundDelete(): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const current = await readSiteSettings();
    const path = current.backgroundPath;

    const settings = await writeSiteSettings({
      backgroundPath: null,
      backgroundId: DEFAULT_BACKGROUND_ID,
    });

    if (path && isAssetPath("background", path)) await deleteAsset(path);

    return Response.json(settings, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Reports whether storage is usable, and what to fix when it is not (R18). */
export async function handleStorageCheck(): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    return Response.json(await checkStorage(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Provisions the bucket the check just reported as wrong (R18).
 *
 * Same response shape as the check, because that is what the panel already
 * renders: the owner presses one button and reads one line either way.
 */
export async function handleStorageRepair(): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    return Response.json(await repairStorage(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

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
    const patch = pickEditable(body);

    // Selecting the custom background with nothing uploaded would strand the
    // site on a missing image, so it is refused rather than resolved silently.
    if (patch.backgroundId === CUSTOM_BACKGROUND_ID) {
      const { backgroundPath } = await readSiteSettings();
      if (!backgroundPath) {
        return Response.json(
          {
            error: "Upload a background image before selecting it.",
            field: "backgroundId",
          },
          { status: 422 },
        );
      }
    }

    const settings = await writeSiteSettings(patch);

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
