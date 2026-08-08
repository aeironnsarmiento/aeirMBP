import type { Registry, WidgetManifest } from "./types";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

const HOTKEY_PATTERN = /^[a-z0-9]$/;

export function assembleRegistry(manifests: readonly WidgetManifest[]): Registry {
  const seenIds = new Set<string>();
  const seenHotkeys = new Map<string, string>();
  let defaultWidget: string | undefined;

  for (const manifest of manifests) {
    if (seenIds.has(manifest.id)) {
      throw new RegistryError(`Duplicate widget id: ${manifest.id}`);
    }
    seenIds.add(manifest.id);

    if (!HOTKEY_PATTERN.test(manifest.hotkey)) {
      throw new RegistryError(
        `Widget ${manifest.id} declares hotkey ${JSON.stringify(
          manifest.hotkey,
        )}; expected a single lowercase letter or digit`,
      );
    }

    const claimedBy = seenHotkeys.get(manifest.hotkey);
    if (claimedBy) {
      throw new RegistryError(
        `Hotkey "${manifest.hotkey}" is claimed by both ${claimedBy} and ${manifest.id}`,
      );
    }
    seenHotkeys.set(manifest.hotkey, manifest.id);

    if (manifest.subViews) {
      const seenSubViews = new Set<string>();
      for (const subView of manifest.subViews) {
        if (seenSubViews.has(subView.id)) {
          throw new RegistryError(
            `Widget ${manifest.id} declares duplicate sub-view: ${subView.id}`,
          );
        }
        seenSubViews.add(subView.id);
      }
    }

    if (manifest.openByDefault) {
      if (defaultWidget) {
        throw new RegistryError(
          `Both ${defaultWidget} and ${manifest.id} are marked openByDefault; exactly one widget may be`,
        );
      }
      defaultWidget = manifest.id;
    }
  }

  const ordered = [...manifests].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );

  return Object.freeze(ordered);
}

export function visibleWidgets(registry: Registry, isOwner: boolean): Registry {
  if (isOwner) return registry;
  return Object.freeze(registry.filter((manifest) => !manifest.adminOnly));
}

export function defaultWidgetId(registry: Registry): string | null {
  return registry.find((manifest) => manifest.openByDefault)?.id ?? null;
}

export function widgetForHotkey(
  registry: Registry,
  key: string,
): WidgetManifest | null {
  const normalized = key.toLowerCase();
  return registry.find((manifest) => manifest.hotkey === normalized) ?? null;
}

export function findWidget(
  registry: Registry,
  id: string | null,
): WidgetManifest | null {
  if (!id) return null;
  return registry.find((manifest) => manifest.id === id) ?? null;
}

export function defaultSubView(manifest: WidgetManifest): string | null {
  const declared = manifest.defaultSubView;
  if (declared && manifest.subViews?.some((view) => view.id === declared)) {
    return declared;
  }
  return manifest.subViews?.[0]?.id ?? null;
}
