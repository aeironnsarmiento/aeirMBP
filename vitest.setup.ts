import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * Node 25 exposes an experimental `localStorage` global that is inert unless
 * the process was started with a valid `--localstorage-file`. It is defined
 * before jsdom installs its own, so `window.localStorage` resolves to the
 * broken one and every call throws. Replacing it with an in-memory store keeps
 * the storage-backed paths testable and independent of the Node version.
 */
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
}

function installStorage(name: "localStorage" | "sessionStorage") {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
});

afterEach(() => {
  cleanup();
});
