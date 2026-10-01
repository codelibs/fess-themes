// SPDX-License-Identifier: Apache-2.0
// Details / compact / tiles: the layout of the result list, remembered across visits.
// localStorage can be missing, blocked or full (private windows, blocked site data), and
// even reading the `localStorage` property can throw, so every access is guarded and the
// page works the same without it.

export const VIEW_MODES = ["details", "compact", "tiles"];
export const DEFAULT_VIEW = "details";
export const VIEW_KEY = "filesearch.view";

const defaultStorage = () => window.localStorage;

/** The saved mode, or the default when nothing valid can be read. */
export function loadViewMode(getStorage = defaultStorage) {
  try {
    const store = getStorage();
    const value = store && store.getItem(VIEW_KEY);
    return VIEW_MODES.includes(value) ? value : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Remember a mode; true when it was stored. */
export function saveViewMode(mode, getStorage = defaultStorage) {
  if (!VIEW_MODES.includes(mode)) return false;
  try {
    const store = getStorage();
    if (!store) return false;
    store.setItem(VIEW_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
