import { vi } from "vitest";
import type { OpenWidgetApi } from "./useOpenWidget";

export function closedStore(
  overrides: Partial<OpenWidgetApi> = {},
): OpenWidgetApi {
  return {
    state: { widgetId: null, subView: null, params: {} },
    open: vi.fn(),
    close: vi.fn(),
    setSubView: vi.fn(),
    setParam: vi.fn(),
    ...overrides,
  };
}

export function storeOpenOn(
  widgetId: string,
  { subView = null }: { subView?: string | null } = {},
  overrides: Partial<OpenWidgetApi> = {},
): OpenWidgetApi {
  return closedStore({
    state: { widgetId, subView, params: {} },
    ...overrides,
  });
}
