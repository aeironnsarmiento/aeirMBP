import {
  handleUploadConfirm,
  handleUploadSign,
} from "@/widgets/settings/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin mount. Logic and query layer live inside the widget (KTD2, R15).
 *
 * POST grants permission to upload; PUT records the finished object. Covered
 * by the proxy's `/api/settings/:path*` matcher, and each handler calls
 * requireOwner in its own right.
 */
export const POST = handleUploadSign;
export const PUT = handleUploadConfirm;
