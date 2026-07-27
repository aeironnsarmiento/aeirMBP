/**
 * Perf harness for the shell: payload, load timings, and interaction smoothness.
 *
 * Emits one JSON object on stdout. Every number is either bytes, milliseconds,
 * or a count — no composite scores, so a regression is always attributable to
 * something specific.
 *
 * Run: node scripts/perf-measure.mjs [--runs N] [--port P] [--headed]
 * Requires a production build (`npm run build`) and Playwright's chromium.
 *
 * Why a script and not a Vitest file: this measures the *built* artifact in a
 * real engine. jsdom runs no cascade, no compositor, and no network — every
 * number below would be a fabrication there.
 */

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const RUNS = Number(flag("runs", 3));
const PORT = Number(flag("port", process.env.PORT ?? 3100));
const HEADED = args.includes("--headed");
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** Bytes of built JS and CSS a visitor could be asked to download. */
function bundleBytes() {
  const dir = ".next/static/chunks";
  let js = 0;
  let css = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      // `dev` holds turbopack's dev-only output; it is not shipped.
      if (entry.isDirectory()) {
        if (entry.name !== "dev") walk(path);
        continue;
      }
      const size = statSync(path).size;
      if (entry.name.endsWith(".js")) js += size;
      else if (entry.name.endsWith(".css")) css += size;
    }
  };
  walk(dir);
  return { built_js_kb: +(js / 1024).toFixed(1), built_css_kb: +(css / 1024).toFixed(1) };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["next", "start", "--port", String(PORT)], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("server start timeout")), 60_000);
    const onData = (buf) => {
      if (/Ready|started server|Local:/i.test(String(buf))) {
        clearTimeout(timer);
        resolve(proc);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
  });
}

/**
 * Installed before any app script runs, so nothing is missed between navigation
 * and the observer being wired up.
 *
 * Long Animation Frame is the metric that matches the complaint: it reports how
 * long the main thread was busy enough to delay a frame, which is what "clunky"
 * describes. rAF deltas are kept beside it because they also catch a stall in
 * the compositor — a heavy backdrop-filter never touches the main thread and so
 * never appears in LoAF at all.
 */
const INSTRUMENT = () => {
  const w = window;
  w.__perf = { loaf: [], frames: [], marks: {} };

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__perf.loaf.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: entry.blockingDuration ?? 0,
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {
    w.__perf.loafUnsupported = true;
  }

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      w.__perf.lcp = entries[entries.length - 1]?.startTime ?? null;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* not every engine ships LCP; it stays null */
  }

  let last = null;
  const tick = (now) => {
    if (last !== null) w.__perf.frames.push(now - last);
    last = now;
    w.__perf.raf = requestAnimationFrame(tick);
  };
  w.__perf.raf = requestAnimationFrame(tick);
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1);
};
const median = (values) => percentile(values, 0.5);

async function measureOnce(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Transfer size, not resource size — this is what the visitor waits on.
  const transfer = { js: 0, css: 0, img: 0, other: 0, requests: 0 };
  page.on("response", async (response) => {
    try {
      const sizes = await response.request().sizes();
      const bytes = (sizes.responseBodySize ?? 0) + (sizes.responseHeadersSize ?? 0);
      const url = response.url();
      transfer.requests += 1;
      if (/\.js(\?|$)/.test(url)) transfer.js += bytes;
      else if (/\.css(\?|$)/.test(url)) transfer.css += bytes;
      else if (/\.(png|jpe?g|webp|avif|svg|gif)(\?|$)/.test(url)) transfer.img += bytes;
      else transfer.other += bytes;
    } catch {
      /* a response can be gone before sizes() resolves; skip it */
    }
  });

  await page.addInitScript(INSTRUMENT);
  const navStart = Date.now();
  await page.goto(ORIGIN, { waitUntil: "load" });
  const loadMs = Date.now() - navStart;

  // Hydration and the first data fetches land after `load`; measuring the
  // interaction before they settle would score a page that is still building.
  await page.waitForTimeout(2500);

  const boot = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const p = window.__perf;
    return {
      lcp_ms: p.lcp,
      dom_content_loaded_ms: nav?.domContentLoadedEventEnd ?? null,
      dom_nodes: document.querySelectorAll("*").length,
      blur_surfaces: [...document.querySelectorAll("*")].filter((el) => {
        const bf = getComputedStyle(el).backdropFilter;
        return bf && bf !== "none";
      }).length,
      /*
       * Guards against the cheapest way to win on bytes: deleting the things
       * the bytes were buying. A wallpaper that is merely *smaller* still
       * paints something here; one that has been removed does not.
       */
      background_painted: (() => {
        const el = document.querySelector('[class*="background"]');
        if (!el) return false;
        const bg = getComputedStyle(el).backgroundImage;
        return bg !== "none" && bg !== "";
      })(),
      artwork_painted: [...document.images].filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
      // Blocking time before the page was interactive.
      boot_blocking_ms: +p.loaf.reduce((sum, e) => sum + e.blocking, 0).toFixed(1),
      loaf_unsupported: p.loafUnsupported ?? false,
    };
  });

  // --- Interaction: the widget switch the complaint is about ---------------
  await page.evaluate(() => {
    const p = window.__perf;
    p.loaf.length = 0;
    p.frames.length = 0;
    p.marks.start = performance.now();
  });

  // Four switches, spaced so each transition finishes before the next starts —
  // the queue in useOpenWidget would otherwise serialize them and the timing
  // would measure waiting, not working.
  for (const key of ["m", "p", "a", "m"]) {
    await page.evaluate((k) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    }, key);
    await page.waitForTimeout(700);
  }

  const interaction = await page.evaluate(() => {
    const p = window.__perf;
    cancelAnimationFrame(p.raf);
    return { loaf: p.loaf, frames: p.frames };
  });

  const blocking = interaction.loaf.reduce((sum, e) => sum + e.blocking, 0);
  const longFrames = interaction.frames.filter((d) => d > 33).length; // two vsyncs at 60Hz

  await context.close();

  return {
    switch_blocking_ms: +blocking.toFixed(1),
    switch_longest_task_ms: +Math.max(0, ...interaction.loaf.map((e) => e.duration)).toFixed(1),
    switch_long_frames: longFrames,
    switch_p95_frame_ms: percentile(interaction.frames, 0.95),
    transfer_js_kb: +(transfer.js / 1024).toFixed(1),
    transfer_css_kb: +(transfer.css / 1024).toFixed(1),
    transfer_img_kb: +(transfer.img / 1024).toFixed(1),
    transfer_total_kb: +((transfer.js + transfer.css + transfer.img + transfer.other) / 1024).toFixed(1),
    requests: transfer.requests,
    load_ms: loadMs,
    ...boot,
  };
}

const { chromium } = require("playwright");

let server;
try {
  server = await startServer();
  const browser = await chromium.launch({ headless: !HEADED });
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser));
  await browser.close();

  // Median across runs: one slow run should not decide whether a change landed.
  const keys = Object.keys(runs[0]).filter((k) => typeof runs[0][k] === "number");
  const out = {};
  for (const key of keys) out[key] = median(runs.map((r) => r[key]));
  out.runs = RUNS;
  out.loaf_unsupported = runs[0].loaf_unsupported;
  // Booleans do not have a median; a gate must hold on every run to count.
  out.background_painted = runs.every((r) => r.background_painted);
  Object.assign(out, bundleBytes());

  /*
   * Frame cadence is reported but must not be gated on from a headless run.
   * Headless Chromium composites without a display's vsync, so its frame
   * deltas are synthetic: this harness measured 26 long frames headless
   * against 4 headed on the same build. Payload and main-thread numbers are
   * engine-honest either way; run with --headed when judging smoothness.
   */
  out.frame_metrics_trustworthy = HEADED;

  console.log(JSON.stringify(out, null, 2));
} finally {
  server?.kill();
}
