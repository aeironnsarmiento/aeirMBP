import {
  handleAboutRead,
  handleAboutUpdate,
} from "@/widgets/about/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thin mount. Logic and query layer live inside the widget (KTD2, R15). */
export const GET = handleAboutRead;
export const POST = handleAboutUpdate;
