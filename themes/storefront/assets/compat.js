// SPDX-License-Identifier: Apache-2.0
/*
 * Storefront theme — Bootstrap JavaScript compatibility shim.
 *
 * The Storefront theme ships no Bootstrap/Popper. The SPA modules (app.js,
 * auth.js, search.js, chat.js) however still drive a handful of interactive
 * widgets through the Bootstrap 5 JS API (`window.bootstrap.{Modal,Collapse,
 * Tooltip}`) and through declarative `data-bs-*` attributes (dropdown, modal,
 * collapse, offcanvas). This file provides a tiny, dependency-free
 * re-implementation of exactly that surface so the unmodified modules keep
 * working. The matching visual states (`.show`, `.modal-backdrop`,
 * `.offcanvas-backdrop`, `.dropdown-menu.show`, …) are styled in styles.css.
 *
 * Loaded as a classic `defer` script BEFORE the app.js module so
 * `window.bootstrap` exists by the time the modules run (parity with the
 * popper.min.js + bootstrap.min.js load order in the reference theme).
 *
 * No `innerHTML` with dynamic data is used here (XSS-safety parity with the
 * rest of the theme).
 */
(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ utils */
  function resolveTarget(trigger) {
    // data-bs-target wins; fall back to href="#id" (collapse links use href).
    var sel = trigger.getAttribute("data-bs-target");
    if (!sel) {
      var href = trigger.getAttribute("href");
      if (href && href.charAt(0) === "#") sel = href;
    }
    if (!sel || sel === "#") return null;
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function instanceStore(key) {
    // Per-element instance cache keyed by a private symbol-ish property.
    return function get(el, factory) {
      if (!el) return null;
      var bag = el.__df_bs || (el.__df_bs = {});
      if (!bag[key]) bag[key] = factory(el);
      return bag[key];
    };
  }

  /* ----------------------------------------------------------------- backdrop */
  function makeBackdrop(className, onClick) {
    var bd = document.createElement("div");
    bd.className = className;
    document.body.appendChild(bd);
    // Force reflow so the fade-in transition runs.
    // eslint-disable-next-line no-unused-expressions
    bd.offsetHeight;
    bd.classList.add("show");
    if (onClick) bd.addEventListener("click", onClick);
    return bd;
  }

  function removeBackdrop(bd) {
    if (!bd) return;
    bd.classList.remove("show");
    var done = function () { if (bd.parentNode) bd.parentNode.removeChild(bd); };
    if (prefersReducedMotion) done();
    else setTimeout(done, 200);
  }

  function anyOpen(selector) {
    return document.querySelector(selector + ".show") != null;
  }

  /* -------------------------------------------------------------------- Modal */
  function Modal(el) {
    this._el = el;
    this._backdrop = null;
  }
  Modal.prototype.show = function () {
    var el = this._el;
    if (!el || el.classList.contains("show")) return;
    var self = this;
    el.style.display = "block";
    // reflow for fade
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;
    el.classList.add("show");
    el.removeAttribute("aria-hidden");
    el.setAttribute("aria-modal", "true");
    document.body.classList.add("modal-open");
    this._backdrop = makeBackdrop("modal-backdrop fade", function () { self.hide(); });
    // Focus the first focusable control inside the dialog.
    var focusable = el.querySelector(
      "input:not([type=hidden]):not([disabled]), select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
    if (focusable) { try { focusable.focus(); } catch (e) { /* ignore */ } }
  };
  Modal.prototype.hide = function () {
    var el = this._el;
    if (!el || !el.classList.contains("show")) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    el.removeAttribute("aria-modal");
    var done = function () { el.style.display = "none"; };
    if (prefersReducedMotion) done();
    else setTimeout(done, 200);
    removeBackdrop(this._backdrop);
    this._backdrop = null;
    if (!anyOpen(".modal")) document.body.classList.remove("modal-open");
  };
  var modalStore = instanceStore("modal");
  Modal.getOrCreateInstance = function (el) {
    return modalStore(el, function (e) { return new Modal(e); });
  };

  /* ----------------------------------------------------------------- Collapse */
  function Collapse(el, opts) {
    this._el = el;
    if (opts && opts.toggle) this.toggle();
  }
  function syncCollapseTriggers(target, expanded) {
    var triggers = document.querySelectorAll('[data-bs-toggle="collapse"]');
    for (var i = 0; i < triggers.length; i++) {
      if (resolveTarget(triggers[i]) === target) {
        triggers[i].setAttribute("aria-expanded", expanded ? "true" : "false");
        triggers[i].classList.toggle("collapsed", !expanded);
      }
    }
  }
  Collapse.prototype.show = function () {
    if (!this._el || this._el.classList.contains("show")) return;
    this._el.classList.add("show");
    syncCollapseTriggers(this._el, true);
  };
  Collapse.prototype.hide = function () {
    if (!this._el || !this._el.classList.contains("show")) return;
    this._el.classList.remove("show");
    syncCollapseTriggers(this._el, false);
  };
  Collapse.prototype.toggle = function () {
    if (this._el.classList.contains("show")) this.hide();
    else this.show();
  };
  var collapseStore = instanceStore("collapse");
  Collapse.getOrCreateInstance = function (el, opts) {
    return collapseStore(el, function (e) { return new Collapse(e, opts); });
  };

  /* ----------------------------------------------------------------- Dropdown */
  function Dropdown(el) { this._toggle = el; }
  function dropdownMenuFor(toggle) {
    var root = toggle.closest(".dropdown") || toggle.parentElement;
    return root ? root.querySelector(".dropdown-menu") : null;
  }
  Dropdown.prototype.show = function () {
    var menu = dropdownMenuFor(this._toggle);
    if (!menu || menu.classList.contains("show")) return;
    closeAllDropdowns();
    menu.classList.add("show");
    this._toggle.setAttribute("aria-expanded", "true");
  };
  Dropdown.prototype.hide = function () {
    var menu = dropdownMenuFor(this._toggle);
    if (!menu || !menu.classList.contains("show")) return;
    menu.classList.remove("show");
    this._toggle.setAttribute("aria-expanded", "false");
  };
  Dropdown.prototype.toggle = function () {
    var menu = dropdownMenuFor(this._toggle);
    if (menu && menu.classList.contains("show")) this.hide();
    else this.show();
  };
  var dropdownStore = instanceStore("dropdown");
  Dropdown.getOrCreateInstance = function (el) {
    return dropdownStore(el, function (e) { return new Dropdown(e); });
  };
  function closeAllDropdowns() {
    var open = document.querySelectorAll(".dropdown-menu.show");
    for (var i = 0; i < open.length; i++) {
      open[i].classList.remove("show");
      var root = open[i].closest(".dropdown");
      var t = root && root.querySelector('[data-bs-toggle="dropdown"]');
      if (t) t.setAttribute("aria-expanded", "false");
    }
  }

  /* ---------------------------------------------------------------- Offcanvas */
  function Offcanvas(el) { this._el = el; this._backdrop = null; }
  Offcanvas.prototype.show = function () {
    var el = this._el;
    if (!el || el.classList.contains("show")) return;
    var self = this;
    el.classList.add("show");
    el.removeAttribute("aria-hidden");
    this._backdrop = makeBackdrop("offcanvas-backdrop fade", function () { self.hide(); });
  };
  Offcanvas.prototype.hide = function () {
    var el = this._el;
    if (!el || !el.classList.contains("show")) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    removeBackdrop(this._backdrop);
    this._backdrop = null;
  };
  Offcanvas.prototype.toggle = function () {
    if (this._el.classList.contains("show")) this.hide();
    else this.show();
  };
  var offcanvasStore = instanceStore("offcanvas");
  Offcanvas.getOrCreateInstance = function (el) {
    return offcanvasStore(el, function (e) { return new Offcanvas(e); });
  };

  /* ------------------------------------------------------------------ Tooltip */
  var activeTip = null;
  function hideTip() {
    if (activeTip && activeTip.parentNode) activeTip.parentNode.removeChild(activeTip);
    activeTip = null;
  }
  function Tooltip(el) {
    this._el = el;
    // Move the native title into data so the browser's own tooltip doesn't
    // double up with ours (Bootstrap does the same).
    var title = el.getAttribute("data-bs-title") || el.getAttribute("title") || "";
    if (el.hasAttribute("title")) {
      el.setAttribute("data-bs-original-title", title);
      el.removeAttribute("title");
    }
    this._title = title;
    this._placement = el.getAttribute("data-bs-placement") || "top";
    var self = this;
    el.addEventListener("mouseenter", function () { self._render(); });
    el.addEventListener("focus", function () { self._render(); });
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("blur", hideTip);
  }
  Tooltip.prototype._render = function () {
    if (!this._title) return;
    hideTip();
    var tip = document.createElement("div");
    tip.className = "df-tooltip df-tooltip-" + this._placement;
    tip.setAttribute("role", "tooltip");
    tip.textContent = this._title;
    document.body.appendChild(tip);
    activeTip = tip;
    var r = this._el.getBoundingClientRect();
    var tr = tip.getBoundingClientRect();
    var sx = window.pageXOffset, sy = window.pageYOffset;
    var top, left;
    switch (this._placement) {
      case "left":
        top = sy + r.top + (r.height - tr.height) / 2;
        left = sx + r.left - tr.width - 8;
        break;
      case "right":
        top = sy + r.top + (r.height - tr.height) / 2;
        left = sx + r.right + 8;
        break;
      case "bottom":
        top = sy + r.bottom + 8;
        left = sx + r.left + (r.width - tr.width) / 2;
        break;
      default: // top
        top = sy + r.top - tr.height - 8;
        left = sx + r.left + (r.width - tr.width) / 2;
    }
    tip.style.top = Math.max(0, Math.round(top)) + "px";
    tip.style.left = Math.max(0, Math.round(left)) + "px";
    tip.classList.add("show");
  };
  var tooltipStore = instanceStore("tooltip");
  Tooltip.getOrCreateInstance = function (el) {
    return tooltipStore(el, function (e) { return new Tooltip(e); });
  };

  /* ------------------------------------------------- declarative delegation */
  document.addEventListener("click", function (ev) {
    var t = ev.target;

    // data-bs-dismiss handlers (close buttons inside modal/offcanvas).
    var dismiss = t.closest && t.closest("[data-bs-dismiss]");
    if (dismiss) {
      var kind = dismiss.getAttribute("data-bs-dismiss");
      if (kind === "modal") {
        var m = dismiss.closest(".modal");
        if (m) { Modal.getOrCreateInstance(m).hide(); ev.preventDefault(); return; }
      } else if (kind === "offcanvas") {
        var oc = dismiss.closest(".offcanvas");
        if (oc) { Offcanvas.getOrCreateInstance(oc).hide(); ev.preventDefault(); return; }
      }
    }

    var toggle = t.closest && t.closest("[data-bs-toggle]");
    if (toggle) {
      var type = toggle.getAttribute("data-bs-toggle");
      if (type === "dropdown") {
        ev.preventDefault();
        Dropdown.getOrCreateInstance(toggle).toggle();
        return;
      }
      if (type === "collapse") {
        ev.preventDefault();
        var ct = resolveTarget(toggle);
        if (ct) Collapse.getOrCreateInstance(ct, { toggle: false }).toggle();
        return;
      }
      if (type === "modal") {
        ev.preventDefault();
        var mt = resolveTarget(toggle);
        if (mt) Modal.getOrCreateInstance(mt).show();
        return;
      }
      if (type === "offcanvas") {
        ev.preventDefault();
        var ot = resolveTarget(toggle);
        if (ot) Offcanvas.getOrCreateInstance(ot).toggle();
        return;
      }
    }

    // Click on a dropdown item closes its menu (after the item's own handler).
    var item = t.closest && t.closest(".dropdown-menu .dropdown-item");
    if (item) { closeAllDropdowns(); return; }

    // Outside click closes any open dropdown.
    if (!(t.closest && t.closest(".dropdown"))) closeAllDropdowns();
  }, false);

  // ESC closes the topmost transient layer (dropdown → offcanvas → modal).
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" && ev.keyCode !== 27) return;
    if (document.querySelector(".dropdown-menu.show")) { closeAllDropdowns(); return; }
    var oc = document.querySelector(".offcanvas.show");
    if (oc) { Offcanvas.getOrCreateInstance(oc).hide(); return; }
    var m = document.querySelector(".modal.show");
    if (m) { Modal.getOrCreateInstance(m).hide(); }
  }, false);

  window.bootstrap = {
    Modal: Modal,
    Collapse: Collapse,
    Dropdown: Dropdown,
    Offcanvas: Offcanvas,
    Tooltip: Tooltip,
  };
})();
