import { requireOwner } from "@/lib/auth/guard";
import {
  APPEARANCES,
  BACKGROUND_SLOT_FIELDS,
  BACKGROUND_SLOT_PATH_FIELDS,
  SettingsValidationError,
  readSiteSettings,
  writeSiteSettings,
  type Appearance,
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
  backgroundKind,
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
  // An unlisted field is dropped before validation ever sees it.
  "backgroundLightId",
  "backgroundDarkId",
  "themeSwitchoverAt",
  "themeSwitchoverTo",
] as const;

/** Absent means the single background — what every request meant before the
 *  pair existed, so both upload paths stay one code path. */
function slotOf(request: Request): Appearance | null {
  const slot = new URL(request.url).searchParams.get("slot");
  return slot === "light" || slot === "dark" ? slot : null;
}

/** Presets are all stills, so only an upload can be a video. */
function slotMediaKind(
  id: string | null,
  path: string | null,
): "image" | "video" | null {
  if (id === null) return null;
  if (id !== CUSTOM_BACKGROUND_ID) return "image";
  return path ? backgroundKind(path) : null;
}

/**
 * Refuses a video in either half of a pair (R8): a pair swaps by custom
 * property, and a property cannot swap a `<video>` for a `<div>` — including
 * two videos. Judged against the merged state, since assigning one slot only
 * makes sense against what the other holds.
 */
function checkPairMediaKinds(next: SiteSettings): void {
  for (const appearance of APPEARANCES) {
    const kind = slotMediaKind(
      next[BACKGROUND_SLOT_FIELDS[appearance]],
      next[BACKGROUND_SLOT_PATH_FIELDS[appearance]],
    );
    if (kind !== "video") continue;

    throw new SettingsValidationError(
      BACKGROUND_SLOT_FIELDS[appearance],
      "A background pair must be two still images. An animated background can only be used as a single background for both appearances.",
    );
  }
}

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

    const slot = slotOf(request);

    // Both fields in one patch: the write layer is transactional per patch.
    const patch: Partial<SiteSettings> =
      slot === null
        ? { backgroundPath: body.path, backgroundId: CUSTOM_BACKGROUND_ID }
        : {
            [BACKGROUND_SLOT_PATH_FIELDS[slot]]: body.path,
            [BACKGROUND_SLOT_FIELDS[slot]]: CUSTOM_BACKGROUND_ID,
          };

    if (slot !== null) {
      checkPairMediaKinds({ ...(await readSiteSettings()), ...patch });
    }

    const settings = await writeSiteSettings(patch);

    return Response.json(settings, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Every stored background path a settings state still points at. */
function referencedBackgroundPaths(settings: SiteSettings): string[] {
  return [
    settings.backgroundPath,
    settings.backgroundLightPath,
    settings.backgroundDarkPath,
  ].filter((path): path is string => typeof path === "string");
}

/**
 * Discards one background and returns that slot to a preset (R8).
 * `?slot=light|dark` clears one member of the pair; no slot clears the single
 * background. The stored object goes too — paths carry a timestamp, so an
 * orphan is unreachable — but only when nothing else points at it, since two
 * slots may name the same image (AE3).
 *
 * Settings are written first and references counted from the state after: the
 * reverse order can delete bytes and leave the site pointing at them.
 */
export async function handleBackgroundDelete(
  request: Request,
): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const slot = slotOf(request);
    const before = await readSiteSettings();

    const path =
      slot === null
        ? before.backgroundPath
        : before[BACKGROUND_SLOT_PATH_FIELDS[slot]];

    const settings = await writeSiteSettings(
      slot === null
        ? { backgroundPath: null, backgroundId: DEFAULT_BACKGROUND_ID }
        : {
            [BACKGROUND_SLOT_PATH_FIELDS[slot]]: null,
            // Null, not a preset id — an empty slot is what falls back.
            [BACKGROUND_SLOT_FIELDS[slot]]: null,
          },
    );

    const stillReferenced = referencedBackgroundPaths(settings).includes(
      path ?? "",
    );

    if (path && !stillReferenced && isAssetPath("background", path)) {
      await deleteAsset(path);
    }

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

    const touchesBackground =
      patch.backgroundId === CUSTOM_BACKGROUND_ID ||
      APPEARANCES.some(
        (appearance) => patch[BACKGROUND_SLOT_FIELDS[appearance]] !== undefined,
      );

    if (touchesBackground) {
      const current = await readSiteSettings();

      // Selecting `custom` with nothing uploaded would strand the site on a
      // missing image. Each slot has its own upload, so each is asked.
      const selectable: Array<{ field: keyof SiteSettings; path: string | null }> = [
        { field: "backgroundId", path: current.backgroundPath },
        ...APPEARANCES.map((appearance) => ({
          field: BACKGROUND_SLOT_FIELDS[appearance] as keyof SiteSettings,
          path: current[BACKGROUND_SLOT_PATH_FIELDS[appearance]],
        })),
      ];

      for (const { field, path } of selectable) {
        if (patch[field] === CUSTOM_BACKGROUND_ID && !path) {
          return Response.json(
            {
              error: "Upload a background image before selecting it.",
              field,
            },
            { status: 422 },
          );
        }
      }

      checkPairMediaKinds({ ...current, ...patch });
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
