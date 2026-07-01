// SPDX-License-Identifier: Apache-2.0
//
// Mosaic home hero — the decorative "shared embedding space" band.
//
// Two independent effects, both scoped to #home-view and both fully paused
// while the home view is not on screen (to save CPU) and disabled/frozen when
// the user prefers reduced motion:
//
//   1. A multimodal-convergence <canvas>: short text-token chips stream in
//      from the LEFT and small image tiles stream in from the RIGHT, both
//      drifting toward a central glowing "shared embedding" node — visualizing
//      text and images living together in one CLIP-style embedding space.
//      Colors are read from the theme's existing source-of-match custom
//      properties (--sl-keyword for text, --sl-semantic for images,
//      --sl-hybrid for the shared node) so the hero stays visually consistent
//      with the keyword/visual/blend badges used elsewhere in the theme.
//      requestAnimationFrame loop; a single static frame under
//      prefers-reduced-motion (no RAF loop at all).
//   2. A typewriter that animates ONLY the #contentQuery `placeholder`
//      attribute (never .value — that would corrupt the real search input),
//      cycling home.example_1..4. It yields to the user the moment they TYPE
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
/* Multimodal-convergence canvas                                       */
/* ------------------------------------------------------------------ */

// Fallback hues mirror the theme's default --sl-keyword / --sl-semantic /
// --sl-hybrid custom properties (amber / violet / teal) in case they can't
// be resolved from computed style.
const FALLBACK_TEXT_COLOR = "#D97706";  // text tokens   (keyword hue)
const FALLBACK_IMAGE_COLOR = "#7C3AED"; // image tiles   (visual hue)
const FALLBACK_NODE_COLOR = "#0D9488";  // shared node   (blend hue)

let canvas = null;
let ctx = null;
let dpr = 1;
let cw = 0;
let ch = 0;
let textTokens = [];
let imageTiles = [];
let textColor = FALLBACK_TEXT_COLOR;
let imageColor = FALLBACK_IMAGE_COLOR;
let nodeColor = FALLBACK_NODE_COLOR;
let rafId = 0;
let clock = 0; // advances once per frame; drives the shared-node pulse

/** Read the three source-of-match hues from CSS custom properties (fallback to literals). */
function readColors() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fb) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fb;
    };
    textColor = pick("--sl-keyword", FALLBACK_TEXT_COLOR);
    imageColor = pick("--sl-semantic", FALLBACK_IMAGE_COLOR);
    nodeColor = pick("--sl-hybrid", FALLBACK_NODE_COLOR);
  } catch {
    textColor = FALLBACK_TEXT_COLOR;
    imageColor = FALLBACK_IMAGE_COLOR;
    nodeColor = FALLBACK_NODE_COLOR;
  }
}

/** Size the canvas backing store to the hero box and (re)seed the particle streams. */
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
  seedParticles();
  return true;
}

/** Build one stream particle (text token or image tile) at a given stream phase. */
function makeParticle(t0) {
  return {
    t: t0,                                   // 0 (spawn edge) .. 1 (merged into node)
    speed: 0.0026 + Math.random() * 0.0026,  // progress per frame
    y0: ch * (0.14 + Math.random() * 0.72),  // spawn-side vertical position
    size: 0,                                 // set below, per kind
    wobble: Math.random() * Math.PI * 2,
    wobbleAmp: 4 + Math.random() * 8,
  };
}

/** Populate the two particle streams, scaled to the current hero area. */
function seedParticles() {
  const target = Math.round((cw * ch) / 30000);
  const total = Math.min(64, Math.max(20, target));
  const textCount = Math.ceil(total / 2);
  const tileCount = total - textCount;

  textTokens = new Array(textCount);
  for (let i = 0; i < textCount; i++) {
    const p = makeParticle(i / textCount);
    p.w = 16 + Math.random() * 20; // pill "line of text" width
    p.h = 5 + Math.random() * 2;
    textTokens[i] = p;
  }

  imageTiles = new Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    const p = makeParticle(i / tileCount);
    p.w = 12 + Math.random() * 10; // small square-ish "photo" tile
    p.h = p.w * (0.75 + Math.random() * 0.25);
    imageTiles[i] = p;
  }
}

/** Ease-out curve: fast start, settling in near the shared node. */
function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

/** Fade in on spawn, fade out as the particle merges into the shared node. */
function streamAlpha(t) {
  if (t < 0.12) return t / 0.12;
  if (t > 0.82) return Math.max(0, 1 - (t - 0.82) / 0.18);
  return 1;
}

/** Draw a filled rounded rectangle without relying on ctx.roundRect (compat). */
function roundedRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

/** Compute a particle's current on-canvas position/size/opacity for one side. */
function particlePos(p, fromLeft) {
  const cx = cw / 2;
  const cy = ch / 2;
  const startX = fromLeft ? -p.w : cw + p.w;
  const te = easeOut(p.t);
  const wob = Math.sin(clock * 0.02 + p.wobble) * p.wobbleAmp * (1 - te);
  const x = startX + (cx - startX) * te;
  const y = p.y0 + (cy - p.y0) * (te * 0.55) + wob;
  const scale = 1 - te * 0.55; // shrink slightly as it merges into the node
  return { x, y, alpha: streamAlpha(p.t) * 0.92, scale };
}

/** Draw one text-token chip (a short "line of text" pill). */
function drawTextToken(p) {
  const { x, y, alpha, scale } = particlePos(p, true);
  if (alpha <= 0) return;
  const w = p.w * scale;
  const h = p.h * scale;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = textColor;
  roundedRect(x - w / 2, y - h / 2, w, h, h / 2);
}

/** Draw one image-tile chip (a small rounded "photo" square with a corner highlight). */
function drawImageTile(p) {
  const { x, y, alpha, scale } = particlePos(p, false);
  if (alpha <= 0) return;
  const w = p.w * scale;
  const h = p.h * scale;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = imageColor;
  roundedRect(x - w / 2, y - h / 2, w, h, Math.min(3, w / 4));
  // Tiny highlight dot — reads as a lens/aperture glint on the "photo".
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.beginPath();
  ctx.arc(x - w / 4, y - h / 4, Math.max(0.6, w * 0.09), 0, Math.PI * 2);
  ctx.fill();
}

/** Draw the central shared-embedding node (glow + solid core). */
function drawNode(pulse) {
  const cx = cw / 2;
  const cy = ch / 2;
  const r = 10 + pulse * 5;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4.2);
  glow.addColorStop(0, hexToRgba(nodeColor, 0.55));
  glow.addColorStop(1, hexToRgba(nodeColor, 0));
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 4.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = nodeColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** #RRGGBB (or named/fallback) -> "rgba(r,g,b,a)"; unparsable input is returned opaque. */
function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Draw one frame of the current particle streams (used by both the loop and static mode). */
function drawFrame(pulse) {
  if (!ctx) return;
  ctx.clearRect(0, 0, cw, ch);
  drawNode(pulse);
  for (const p of textTokens) drawTextToken(p);
  for (const p of imageTiles) drawImageTile(p);
  ctx.globalAlpha = 1;
}

/** Advance every particle's stream phase, recycling once it merges into the node. */
function stepParticles() {
  clock++;
  for (const p of textTokens) {
    p.t += p.speed;
    if (p.t >= 1) {
      p.t -= 1;
      p.y0 = ch * (0.14 + Math.random() * 0.72);
      p.wobble = Math.random() * Math.PI * 2;
    }
  }
  for (const p of imageTiles) {
    p.t += p.speed;
    if (p.t >= 1) {
      p.t -= 1;
      p.y0 = ch * (0.14 + Math.random() * 0.72);
      p.wobble = Math.random() * Math.PI * 2;
    }
  }
}

function loop() {
  stepParticles();
  drawFrame(Math.sin(clock * 0.045));
  rafId = window.requestAnimationFrame(loop);
}

function startCanvas() {
  if (!canvas || !ctx) return;
  if (!resizeCanvas()) return; // not laid out yet
  if (reduceMotion.matches) {
    drawFrame(0); // single static frame, no loop, no pulse
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
  canvas = document.getElementById("mosaic-hero-canvas");
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
