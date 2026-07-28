import {
  handleSettingsRead,
  handleSettingsUpdate,
} from "@/widgets/settings/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thin mount. Logic and query layer live inside the widget (KTD2, R15). */
export const GET = handleSettingsRead;
export const POST = handleSettingsUpdate;
