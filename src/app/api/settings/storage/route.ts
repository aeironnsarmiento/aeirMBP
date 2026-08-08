import {
  handleStorageCheck,
  handleStorageRepair,
} from "@/widgets/settings/server/handlers";

export const GET = handleStorageCheck;
export const POST = handleStorageRepair;
