import { vi } from "vitest";
import type { OpenWidgetApi } from "./useOpenWidget";

/**
 * A stand-in for the open-widget store.
 *
 * The store's own behaviour is covered by `useOpenWidget.test.ts`; the grid
 * tests only need to render a given state and see what the grid does with it.
 */
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
