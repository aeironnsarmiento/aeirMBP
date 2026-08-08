import type { SiteSettings } from "@/lib/site/schema";
import { failureMessage } from "./rejection";

export type SettingsPatch = Partial<
  Pick<
    SiteSettings,
    | "backgroundId"
    | "backgroundLightId"
    | "backgroundDarkId"
    | "frameOpacity"
    | "paneOpacity"
    | "themeSwitchoverAt"
    | "themeSwitchoverTo"
  >
>;

export async function postSettingsPatch(
  patch: SettingsPatch,
): Promise<void> {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
}
