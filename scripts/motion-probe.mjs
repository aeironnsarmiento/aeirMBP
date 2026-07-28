/**
 * Cross-engine probe for the shell's expansion motion and focus ring.
 *
 * Emits one JSON object on stdout: per engine, per interaction, the geometry
 * and blending of every view-transition group sampled *while the transition is
 * running*. Every number is a pixel, an opacity, or a count — no composite
 * scores, so a regression is always attributable to one group.
 *
 * Run: node scripts/motion-probe.mjs [--port P] [--engines a,b] [--headed] [--out DIR]
 * Requires a production build (`npm run build`).
 *
 * Four consecutive fixes to the transparency defect passed verification and
 * were all still broken in a real browser — each checked either after
 * `finished` resolved, when the settled state always looks correct, or in a
 * tab reporting `document.hidden`, where the spec skips the transition and
 * there is nothing to see. So this asserts the document is visible, samples
 * strictly inside `ready`, and exits non-zero on zero animations.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const PORT = Number(flag("port", process.env.PORT ?? 3101));
const HEADED = args.includes("--headed");
const OUT = flag("out", ".motion-probe");
const ENGINES = String(flag("engines", "chromium,firefox,webkit"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/*
 * Long enough that a sample lands unambiguously mid-flight rather than racing
 * the end of a 420ms animation, and that a screenshot captures a state the eye
 * would never otherwise hold still. The fade is the short one (~90ms), so the
 * sample point has to sit inside it in *scaled* time: at a 4s duration the fade
 * finishes proportionally later, and 900ms is comfortably inside every pseudo's
 * active interval.
 */
const SLOW_MS = 4000;
const SAMPLE_AT_MS = 900;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["next", "start", "--port", String(PORT)], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(
      () => reject(new Error("server start timeout")),
      60_000,
    );
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

/*
 * Installed before any app script runs. `useOpenWidget` reads
 * `document.startViewTransition` off the document at call time, so replacing
 * the property is enough to capture the transition object — and it has to be
 * in place before the first expansion, not after.
 */
const INSTRUMENT = () => {
  const w = window;
  w.__probe = { transition: null, oldRects: null, newRects: null };

  /*
   * A snapshot's intrinsic size is its element's border box at capture time,
   * and nothing exposes it afterwards. Recording rects at the two capture
   * moments is the only way to know how much of a group box each image paints
   * — `block-size: 100%` makes both pseudo *elements* fill it regardless.
   */
  const nameRects = () => {
    const out = {};
    for (const element of document.querySelectorAll("*")) {
      const name = getComputedStyle(element).viewTransitionName;
      if (!name || name === "none") continue;
      const rect = element.getBoundingClientRect();
      out[name] = { w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) };
    }
    out.root = {
      w: document.documentElement.clientWidth,
      h: document.documentElement.clientHeight,
    };
    return out;
  };

  const native = document.startViewTransition?.bind(document);
  if (!native) {
    w.__probe.unsupported = true;
    return;
  }
  document.startViewTransition = (callback) => {
    // The shell applies the swap rename before calling in, so this already
    // sees `expanded-slot` rather than the per-widget names it replaces.
    w.__probe.oldRects = nameRects();
    w.__probe.newRects = null;
    const transition = native(() => {
      callback();
      // `callback` is a flushSync, so layout here is the new capture's layout.
      w.__probe.newRects = nameRects();
    });
    w.__probe.transition = transition;
    return transition;
  };
};

/* Slows every transition pseudo so a sample can land inside the active
   interval. `!important` because the sheet already sets these durations. */
const SLOWDOWN_CSS = `
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: ${SLOW_MS}ms !important;
  }
`;

/**
 * Freezes the running transition and reads every group's geometry.
 *
 * Returns `error` rather than throwing so one bad interaction does not lose the
 * other engines' data — the caller decides the exit code.
 */
async function sampleTransition(page, label) {
  return page.evaluate(
    async ({ label, sampleAt }) => {
      const probe = window.__probe;
      if (probe?.unsupported) {
        return { label, error: "startViewTransition is not available" };
      }
      const transition = probe?.transition;
      if (!transition) return { label, error: "no transition was started" };

      // A skipped transition rejects `ready`. Swallow it here so the zero-
      // animation branch below reports the useful message instead.
      await Promise.resolve(transition.ready).catch(() => {});

      const isVT = (a) => a.effect?.pseudoElement?.includes("view-transition");
      const animations = document.getAnimations().filter(isVT);
      if (animations.length === 0) {
        return {
          label,
          error: "zero view-transition animations",
          document_hidden: document.hidden,
          visibility_state: document.visibilityState,
        };
      }

      // Pause every pseudo at the same point so the numbers below describe one
      // instant. Reading them while they animate would mix frames.
      for (const animation of animations) {
        animation.currentTime = sampleAt;
        animation.pause();
      }

      // Which pseudos exist per name is the diagnostic, not an implementation
      // detail: a group with only one side has no partner to hold coverage
      // under plus-lighter, and getComputedStyle on an absent pseudo reports
      // plausible defaults that would otherwise read as a healthy group.
      const sides = new Map();
      for (const animation of animations) {
        const match = /::view-transition-(group|old|new|image-pair)\((.+)\)/.exec(
          animation.effect.pseudoElement,
        );
        if (!match) continue;
        const [, part, name] = match;
        if (!sides.has(name)) sides.set(name, new Set());
        sides.get(name).add(part);
      }

      const root = document.documentElement;
      const px = (value) =>
        typeof value === "string" && value.endsWith("px")
          ? +(+value.slice(0, -2)).toFixed(1)
          : null;
      const num = (value) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? +parsed.toFixed(3) : null;
      };

      const oldRects = probe.oldRects ?? {};
      const newRects = probe.newRects ?? {};

      /*
       * Does this side's image paint the whole group box at this instant?
       *
       * `cover` scales the image to fill the box by definition, so it always
       * does. At `none` the image paints at capture size anchored top-left, so
       * it only fills a box no larger than itself — and a box mid-growth is
       * larger than the compact snapshot that started it.
       */
      const coversBox = (objectFit, image, boxW, boxH) => {
        if (objectFit === "cover" || objectFit === "fill") return true;
        if (!image) return null;
        return image.w >= boxW - 0.5 && image.h >= boxH - 0.5;
      };

      const groups = [...sides.entries()].map(([name, parts]) => {
        const read = (part) =>
          getComputedStyle(root, `::view-transition-${part}(${name})`);
        const group = read("group");
        const entry = {
          name,
          has_old: parts.has("old"),
          has_new: parts.has("new"),
          group_w: px(group.width),
          group_h: px(group.height),
          old_image: oldRects[name] ?? null,
          new_image: newRects[name] ?? null,
        };
        if (entry.has_old) {
          const old = read("old");
          entry.old_opacity = num(old.opacity);
          entry.old_blend = old.mixBlendMode;
          entry.old_object_fit = old.objectFit;
          entry.old_covers_box = coversBox(
            old.objectFit,
            entry.old_image,
            entry.group_w,
            entry.group_h,
          );
        }
        if (entry.has_new) {
          const next = read("new");
          entry.new_opacity = num(next.opacity);
          entry.new_blend = next.mixBlendMode;
          entry.new_object_fit = next.objectFit;
          entry.new_covers_box = coversBox(
            next.objectFit,
            entry.new_image,
            entry.group_w,
            entry.group_h,
          );
        }

        /*
         * The number this turns on: lowest total coverage anywhere in the
         * group box. plus-lighter adds both sides, so a region both images
         * paint sums to 1.0; a region only one reaches contributes that side's
         * opacity alone and the wallpaper comes through the difference.
         */
        const contributions = [];
        if (entry.has_old) contributions.push(entry.old_opacity ?? 0);
        if (entry.has_new) contributions.push(entry.new_opacity ?? 0);
        entry.coverage_sum = +contributions
          .reduce((sum, value) => sum + value, 0)
          .toFixed(3);

        const bandContributions = [];
        if (entry.has_old && entry.old_covers_box !== false) {
          bandContributions.push(entry.old_opacity ?? 0);
        }
        if (entry.has_new && entry.new_covers_box !== false) {
          bandContributions.push(entry.new_opacity ?? 0);
        }
        entry.min_coverage = +bandContributions
          .reduce((sum, value) => sum + value, 0)
          .toFixed(3);
        entry.single_sided = !(entry.has_old && entry.has_new);
        /*
         * Single-sided groups excluded: a card that genuinely appears has no
         * partner, and fading in from nothing is the intended motion. 0.99
         * rather than 1.0 because opacity is sampled from a running animation
         * and an exact compare would flag rounding.
         */
        entry.thins = !entry.single_sided && entry.min_coverage < 0.99;
        return entry;
      });

      return {
        label,
        document_hidden: document.hidden,
        animations: animations.length,
        thinning_groups: groups.filter((g) => g.thins).map((g) => g.name),
        groups: groups.sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    { label, sampleAt: SAMPLE_AT_MS },
  );
}

/** Releases the frozen pseudos so the DOM settles before the next interaction. */
async function releaseTransition(page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (!animation.effect?.pseudoElement?.includes("view-transition")) continue;
      try {
        animation.finish();
      } catch {
        /* an already-finished animation throws; nothing to release */
      }
    }
  });
  await page.waitForTimeout(250);
}

/*
 * Three, because the defect does not present the same way in each. A swap
 * pairs both panes into one stationary group; collapse and expand are morphs
 * whose boxes change shape, where snapshot sizing decides coverage.
 */
const INTERACTIONS = [
  {
    label: "swap",
    run: async (page) => {
      await page.click('[data-widget="music"][data-state="compact"]');
    },
  },
  {
    label: "collapse",
    run: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    label: "expand",
    run: async (page) => {
      await page.click('[data-widget="about"][data-state="compact"]');
    },
  },
];

/**
 * Whether the focus ring appears when the reader navigated by keyboard, and
 * stays away when they did not.
 *
 * jsdom runs no cascade, so `:focus-visible` cannot be asserted in the unit
 * suite at all — this is the only place the rule is actually exercised.
 */
async function checkFocusRing(page) {
  const ringHere = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return { focused: null };
      const style = getComputedStyle(element);
      return {
        focused:
          element.getAttribute("data-widget") ??
          element.getAttribute("aria-label") ??
          element.tagName.toLowerCase(),
        tabindex: element.getAttribute("tabindex"),
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });

  // Pointer first, then an unrelated hotkey. This is the reported sequence:
  // the click focuses a card without a ring, and the keypress used to
  // re-qualify that focus as keyboard focus and light it up.
  await page.click('[data-widget="music"][data-state="compact"]');
  await page.waitForTimeout(700);
  await page.keyboard.press("p");
  await page.waitForTimeout(700);
  const afterPointerThenHotkey = await ringHere();
  const clickedCardRing = await page.evaluate(() => {
    const card = document.querySelector('[data-widget="music"]');
    const style = getComputedStyle(card);
    return {
      is_focused: document.activeElement === card,
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
    };
  });

  // Keyboard navigation must still be visible; suppressing the ring outright
  // would trade one defect for a worse one.
  let afterTab = null;
  // Recorded rather than discarded: a null result has two very different
  // causes — no ring on a card that was reached, or a harness whose Tab never
  // reaches a card at all — and only the walk distinguishes them.
  const tabWalk = [];
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press("Tab");
    const here = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return { at: "body" };
      const style = getComputedStyle(element);
      const label =
        element.getAttribute("data-widget") ??
        element.getAttribute("aria-label") ??
        element.textContent?.trim().slice(0, 18) ??
        "";
      return {
        at: `${element.tagName.toLowerCase()}:${label || "?"}`,
        is_card: element.matches('[data-widget][tabindex="0"]'),
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });
    tabWalk.push(here.at);
    if (here.is_card) {
      afterTab = { widget: here.at, outline: here.outline };
      break;
    }
  }

  /*
   * The tab walk depends on the engine advancing focus, and Playwright's
   * Firefox parks on the first link. This exercises the same cascade rule
   * without that dependency: a keypress establishes keyboard modality, and a
   * card focused under it is what `:focus-visible` is defined to match.
   */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const modalityRing = await page.evaluate(() => {
    const card = document.querySelector('[data-widget="about"][tabindex="0"]');
    if (!card) return { error: "no compact card to focus" };
    card.focus();
    const style = getComputedStyle(card);
    return {
      matches_focus_visible: card.matches(":focus-visible"),
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
    };
  });

  return {
    focus_after_pointer_then_hotkey: afterPointerThenHotkey,
    clicked_card: clickedCardRing,
    tab_walk: tabWalk,
    tab_walk_stalled:
      tabWalk.length > 3 && new Set(tabWalk.slice(1)).size === 1,
    keyboard_modality_ring: modalityRing,
    tabbed_card: afterTab,
    ring_suppressed_after_pointer:
      clickedCardRing.outline.startsWith("none") ||
      clickedCardRing.outline.endsWith("0px"),
    ring_shown_after_tab: Boolean(
      afterTab && !afterTab.outline.startsWith("none") &&
        !afterTab.outline.endsWith("0px"),
    ),
  };
}

async function probeEngine(playwright, engine) {
  const launcher = playwright[engine];
  if (!launcher) return { engine, error: `unknown engine "${engine}"` };

  let browser;
  try {
    browser = await launcher.launch({
      headless: !HEADED,
      // Firefox on macOS restricts Tab to links unless full keyboard access
      // is on; `7` is the all-elements value. (Does not fully take in
      // headless — see `tab_walk_stalled` in the output.)
      ...(engine === "firefox"
        ? { firefoxUserPrefs: { "accessibility.tabfocus": 7 } }
        : {}),
    });
  } catch (error) {
    return { engine, error: `launch failed: ${error.message}` };
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "dark",
      // The stylesheet turns every transition off under reduced motion, so an
      // engine defaulting to `reduce` would report zero animations and read as
      // the hidden-document failure. Pin it.
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.addInitScript(INSTRUMENT);
    await page.goto(ORIGIN, { waitUntil: "load" });

    // Hydration owns the hotkey listener and the click handlers; sampling
    // before it lands would measure a page that cannot transition yet.
    await page.waitForTimeout(2500);

    const visibility = await page.evaluate(() => ({
      hidden: document.hidden,
      state: document.visibilityState,
      has_api: typeof document.startViewTransition === "function",
    }));
    if (visibility.hidden) {
      return {
        engine,
        error:
          "document.hidden is true — the spec skips transitions here, so nothing would be measured",
        visibility,
      };
    }

    await page.addStyleTag({ content: SLOWDOWN_CSS });

    /*
     * The one thing numbers cannot answer: whether the frame still renders its
     * backdrop filter once lifted into its own snapshot. Geometry and opacity
     * look perfect on a frame that silently lost its blur, so mid-flight shots
     * are read against this settled reference.
     */
    const settled = join(OUT, `${engine}-settled.png`);
    await page.screenshot({ path: settled });

    const interactions = [];
    for (const interaction of INTERACTIONS) {
      await interaction.run(page);
      const sample = await sampleTransition(page, interaction.label);
      if (!sample.error) {
        const file = join(OUT, `${engine}-${interaction.label}.png`);
        await page.screenshot({ path: file });
        sample.screenshot = file;
      }
      interactions.push(sample);
      await releaseTransition(page);
    }

    /*
     * Last, and after a fresh navigation. The focus checks need real timings
     * and the slowdown above does not survive a reload, so this is cheaper
     * than unwinding it and resetting which widget is open.
     */
    await page.goto(ORIGIN, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const focus = await checkFocusRing(page);

    return { engine, visibility, interactions, focus };
  } catch (error) {
    return { engine, error: error.message };
  } finally {
    await browser.close();
  }
}

/** An engine result is only useful if every interaction actually animated. */
function engineFailures(result) {
  if (result.error) return [`${result.engine}: ${result.error}`];
  return (result.interactions ?? [])
    .filter((i) => i.error)
    .map((i) => `${result.engine}/${i.label}: ${i.error}`);
}

mkdirSync(OUT, { recursive: true });

const playwright = require("playwright");
const server = await startServer();
let results;
try {
  results = [];
  for (const engine of ENGINES) {
    results.push(await probeEngine(playwright, engine));
  }
} finally {
  server.kill();
}

const failures = results.flatMap(engineFailures);
process.stdout.write(
  `${JSON.stringify(
    {
      origin: ORIGIN,
      slow_ms: SLOW_MS,
      sample_at_ms: SAMPLE_AT_MS,
      engines: ENGINES,
      failures,
      results,
    },
    null,
    2,
  )}\n`,
);

// A probe that reports nothing and exits 0 is the exact shape of the four
// verifications that missed this bug. Reporting no animations is a failure.
if (failures.length > 0) process.exit(1);
