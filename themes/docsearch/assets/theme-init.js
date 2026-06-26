/* theme-init.js — classic, synchronous, same-origin (CSP script-src 'self').
   Runs in <head> BEFORE styles.css so dark users get no flash. */
(function () {
  try {
    var t = localStorage.getItem("ds-theme");
    if (t !== "light" && t !== "dark") {
      t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
