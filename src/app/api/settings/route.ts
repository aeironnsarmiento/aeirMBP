import {
  handleSettingsRead,
  handleSettingsUpdate,
} from "@/widgets/settings/server/handlers";

export const GET = handleSettingsRead;
export const POST = handleSettingsUpdate;
