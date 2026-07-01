// SPDX-License-Identifier: Apache-2.0
//
// Mosaic home hero — the decorative "semantic-space" band.
//
// Two independent effects, both scoped to #home-view and both fully paused
// while the home view is not on screen (to save CPU) and disabled/frozen when
// the user prefers reduced motion:
//
//   1. A vector-constellation <canvas>: ~30-70 drifting nodes with proximity
//      lines, colored from the source-of-match palette (--sl-keyword /
//      --sl-semantic / --sl-hybrid). requestAnimationFrame loop; a single
//      static frame under prefers-reduced-motion.
//   2. A typewriter that animates ONLY the #contentQuery `placeholder`
//      attribute (never .value — that would corrupt the real search input),
//      cycling home.example_1..4. It yields to the user only when they TYPE
//      (the box becomes non-empty) — mere focus does NOT stop it, so an empty
//      focused box keeps cycling the example placeholder. Resumes on blur-empty.
//
// Public API:
//   init()            — wire refs + listeners once (call after i18n.init()).
//   setActive(bool)   — called by app.js showView(): true on home, false off.

import { t } from "./i18n.js";

/* ------------------------------------------------------------------ */
/* Shared state                                                        */
/* ------------------------------------------------------------------ */

const reduceMotion = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false, addEventListener() {} };

let inited = false;
let active = false; // true while #home-view is the visible route

/* ------------------------------------------------------------------ */
/* Constellation canvas                                                */
/* ------------------------------------------------------------------ */

const FALLBACK_COLORS = ["#0D9488", "#7C3AED", "#D97706"]; // hybrid / semantic / keyword
const LINK_DIST = 128; // px within which two nodes are connected

let canvas = null;
let ctx = null;
let dpr = 1;
let cw = 0;
let ch = 0;
let nodes = [];
let colors = FALLBACK_COLORS.slice();
let rafId = 0;

/** Read the three source-of-match hues from CSS custom properties (fallback to literals). */
function readColors() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fb) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fb;
    };
    colors = [
      pick("--sl-hybrid", FALLBACK_COLORS[0]),
      pick("--sl-semantic", FALLBACK_COLORS[1]),
      pick("--sl-keyword", FALLBACK_COLORS[2]),
    ];
  } catch {
    colors = FALLBACK_COLORS.slice();
  }
}

/** Size the canvas backing store to the hero box and (re)seed the node field. */
function resizeCanvas() {
  if (!canvas || !ctx) return false;
  const host = canvas.parentElement;
  const rect = host ? host.getBoundingClientRect() : { width: 0, height: 0 };
  cw = Math.round(rect.width);
  ch = Math.round(rect.height);
  if (cw <= 0 || ch <= 0) return false; // hidden / not laid out yet
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seedNodes();
  return true;
}

/** Populate `nodes` scaled to the current hero area, clamped to [28, 70]. */
function seedNodes() {
  const target = Math.round((cw * ch) / 16000);
  const count = Math.min(70, Math.max(28, target));
  nodes = new Array(count);
  for (let i = 0; i < count; i++) {
    nodes[i] = {
      x: Math.random() * cw,
      y: Math.random() * ch,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      c: colors[(Math.random() * colors.length) | 0],
    };
  }
}

/** Draw one frame of the current node field (used by both the loop and static mode). */
function drawFrame() {
  if (!ctx) return;
  ctx.clearRect(0, 0, cw, ch);
  // proximity links
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < LINK_DIST) {
        ctx.globalAlpha = (1 - d / LINK_DIST) * 0.32;
        ctx.strokeStyle = a.c;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  // nodes
  for (const p of nodes) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Advance node positions with edge bounce. */
function stepNodes() {
  for (const p of nodes) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > cw) p.vx *= -1;
    if (p.y < 0 || p.y > ch) p.vy *= -1;
  }
}

function loop() {
  stepNodes();
  drawFrame();
  rafId = window.requestAnimationFrame(loop);
}

function startCanvas() {
  if (!canvas || !ctx) return;
  if (!resizeCanvas()) return; // not laid out yet
  if (reduceMotion.matches) {
    drawFrame(); // single static frame, no loop
    return;
  }
  if (rafId) return;
  rafId = window.requestAnimationFrame(loop);
}

function stopCanvas() {
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Placeholder typewriter                                              */
/* ------------------------------------------------------------------ */

let input = null;
let twTimer = 0;
let twState = null; // { si, ci, del }

function examples() {
  return [
    t("home.example_1"),
    t("home.example_2"),
    t("home.example_3"),
    t("home.example_4"),
  ].filter(s => typeof s === "string" && s.length > 0);
}

/** True when the user has actually typed something (the animation yields to typed
 *  input, but NOT to mere focus — an empty focused box still shows the animated
 *  example placeholder, which is the whole point of the effect). */
function userEngaged() {
  return !input || input.value.trim() !== "";
}

function setPlaceholder(text) {
  if (input) input.setAttribute("placeholder", text);
}

function stopTypewriter() {
  if (twTimer) {
    window.clearTimeout(twTimer);
    twTimer = 0;
  }
  twState = null;
}

function tick() {
  twTimer = 0;
  if (!input || !active) return;
  // Yield to the user the moment they engage the box.
  if (userEngaged()) {
    setPlaceholder(t("search.placeholder"));
    return;
  }
  const list = examples();
  if (list.length === 0) return;
  const s = list[twState.si % list.length];
  setPlaceholder(s.slice(0, twState.ci));

  let delay;
  if (!twState.del && twState.ci < s.length) {
    twState.ci++;
    delay = 70;
  } else if (!twState.del && twState.ci >= s.length) {
    twState.del = true;
    delay = 1400; // hold the full phrase
  } else if (twState.del && twState.ci > 0) {
    twState.ci--;
    delay = 32;
  } else {
    twState.del = false;
    twState.si = (twState.si + 1) % list.length;
    delay = 260;
  }
  twTimer = window.setTimeout(tick, delay);
}

function startTypewriter() {
  stopTypewriter();
  if (!input || !active) return;
  // Reduced motion: no animation — show the first example statically.
  if (reduceMotion.matches) {
    setPlaceholder(examples()[0] || t("search.placeholder"));
    return;
  }
  // If the user already engaged the box, keep the plain placeholder.
  if (userEngaged()) {
    setPlaceholder(t("search.placeholder"));
    return;
  }
  twState = { si: 0, ci: 0, del: false };
  tick();
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

function startAll() {
  startCanvas();
  startTypewriter();
}

function stopAll() {
  stopCanvas();
  stopTypewriter();
}

/** Resume/pause everything based on `active` and document visibility. */
function sync() {
  if (active && !document.hidden) startAll();
  else stopAll();
}

/**
 * Wire element refs and one-time listeners. Safe to call multiple times.
 * Call after i18n.init() so t() resolves the example strings.
 */
export function init() {
  if (inited) return;
  canvas = document.getElementById("sl-hero-canvas");
  input = document.getElementById("contentQuery");
  if (canvas && canvas.getContext) {
    ctx = canvas.getContext("2d");
    readColors();
  }

  // Pause when the tab is backgrounded; resume when it returns (if on home).
  document.addEventListener("visibilitychange", sync);

  // Keep the canvas fitted to the hero as it reflows. startCanvas() re-fits and
  // redraws in both modes (re-seeds + keeps the loop in motion mode; resize +
  // one static frame under reduced motion — never leaving a blank cleared canvas).
  const onResize = () => { if (active && !document.hidden) startCanvas(); };
  if (window.ResizeObserver && canvas && canvas.parentElement) {
    new ResizeObserver(onResize).observe(canvas.parentElement);
  } else {
    window.addEventListener("resize", onResize);
  }

  // Typewriter yields to the user: stop when they TYPE (non-empty), resume on
  // blur-empty. Focus alone does NOT stop it — an empty focused box keeps
  // cycling the animated example placeholder (the signature effect on load).
  if (input) {
    input.addEventListener("input", () => {
      if (input.value.trim() !== "") {
        stopTypewriter();
        setPlaceholder(t("search.placeholder"));
      }
    });
    input.addEventListener("blur", () => {
      if (active && !document.hidden) startTypewriter();
    });
  }

  // React to runtime reduced-motion changes: fully stop (cancel any live RAF /
  // typewriter timer) then re-evaluate, so toggling reduced motion ON mid-session
  // reliably drops from the animation loop to a single static frame.
  const onRM = () => { stopAll(); sync(); };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onRM);
  else if (reduceMotion.addListener) reduceMotion.addListener(onRM); // legacy Safari

  inited = true;
}

/**
 * Toggle the hero effects on/off. app.js calls this from showView():
 * setActive(true) when #home-view is shown, setActive(false) otherwise.
 */
export function setActive(on) {
  if (!inited) init();
  const next = !!on;
  if (next === active) {
    // Returning to home while already "active" is a no-op, but a fresh dispatch
    // may have blanked the placeholder — re-assert it when turning on.
    if (next) sync();
    return;
  }
  active = next;
  if (!active) setPlaceholder(t("search.placeholder"));
  sync();
}
