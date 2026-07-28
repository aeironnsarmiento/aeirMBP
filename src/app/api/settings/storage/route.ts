import {
  handleStorageCheck,
  handleStorageRepair,
} from "@/widgets/settings/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin mount. Logic and query layer live inside the widget (KTD2, R15).
 *
 * GET reports whether storage is usable; POST fixes what it reported, for the
 * faults a bucket setting can fix.
 */
export const GET = handleStorageCheck;
export const POST = handleStorageRepair;
