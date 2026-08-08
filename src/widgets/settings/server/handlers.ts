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

const EDITABLE_FIELDS = [
  "backgroundId",
  "frameOpacity",
  "paneOpacity",
  "backgroundLightId",
  "backgroundDarkId",
  "themeSwitchoverAt",
  "themeSwitchoverTo",
] as const;

function slotOf(request: Request): Appearance | null {
  const slot = new URL(request.url).searchParams.get("slot");
  return slot === "light" || slot === "dark" ? slot : null;
}

function slotMediaKind(
  id: string | null,
  path: string | null,
): "image" | "video" | null {
  if (id === null) return null;
  if (id !== CUSTOM_BACKGROUND_ID) return "image";
  return path ? backgroundKind(path) : null;
}

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

function referencedBackgroundPaths(settings: SiteSettings): string[] {
  return [
    settings.backgroundPath,
    settings.backgroundLightPath,
    settings.backgroundDarkPath,
  ].filter((path): path is string => typeof path === "string");
}

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

export async function handleSettingsRead(): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const [settings, backfill] = await Promise.all([
      readSiteSettings(),
      readBackfillProgress(),
    ]);

    return Response.json(
      { settings, backfill },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("settings-read-failed", error);
    return Response.json(
      { error: "settings-read-failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
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
  console.error("settings-update-failed", error);
  return Response.json(
    { error: "settings-update-failed" },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}
