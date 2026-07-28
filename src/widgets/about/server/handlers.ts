import { requireOwner } from "@/lib/auth/guard";
import {
  SettingsValidationError,
  readSiteSettings,
  writeSiteSettings,
  type SiteSettings,
} from "@/lib/site/settings";

/**
 * About mutation handlers (R17).
 *
 * Mounted at `app/api/about/route.ts` (KTD2). Both entry points call
 * requireOwner even though middleware already covers the path, so the route
 * fails closed on its own (R34).
 *
 * Scope is the About widget's own content — copy, name, handle, location and
 * links. The avatar is site chrome shared with the sidebar, so it is written
 * through the Settings handler instead; this route never touches it.
 *
 * There is no public read handler: About content is rendered server-side from
 * the site query layer, so a visitor never needs this route.
 */

const EDITABLE_FIELDS = [
  "aboutCopy",
  "name",
  "handle",
  "location",
  "links",
] as const;

function pickEditable(body: Record<string, unknown>): Partial<SiteSettings> {
  const patch: Partial<SiteSettings> = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = body[field];
    }
  }
  return patch;
}

export async function handleAboutUpdate(request: Request): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const settings = await writeSiteSettings(pickEditable(body));

    return Response.json(settings, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof SettingsValidationError) {
    return Response.json(
      { error: error.message, field: error.field },
      { status: 422 },
    );
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "about-update-failed" },
    { status: 500 },
  );
}

/** Owner-only read, used by the editing form to load current values. */
export async function handleAboutRead(): Promise<Response> {
  const denied = await requireOwner();
  if (denied) return denied;

  return Response.json(await readSiteSettings(), {
    headers: { "cache-control": "no-store" },
  });
}
