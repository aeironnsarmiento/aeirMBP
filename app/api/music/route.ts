import { handleMusicRead } from "@/widgets/music/server/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thin mount. The handler and query layer live inside the widget (KTD2, R15). */
export const GET = handleMusicRead;
