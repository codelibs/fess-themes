// SPDX-License-Identifier: Apache-2.0
// Recent searches, kept in localStorage (newest first, no duplicates, capped). Storage can
// be missing, blocked or full, and reading the property can throw: every access is guarded
// and a page without storage simply shows no history.

export const RECENT_KEY = "filesearch.recent";
export const RECENT_MAX = 8;

const defaultStorage = () => window.localStorage;

function read(getStorage) {
  try {
    const store = getStorage();
    const raw = store && store.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(v => typeof v === "string" && v !== "") : [];
  } catch {
    return [];
  }
}

function write(list, getStorage) {
  try {
    const store = getStorage();
    if (!store) return false;
    if (list.length === 0 && store.removeItem) store.removeItem(RECENT_KEY);
    else store.setItem(RECENT_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function getRecent(getStorage = defaultStorage) {
  return read(getStorage);
}

/** Remember a query; returns the list as stored (empty when nothing could be stored). */
export function pushRecent(query, getStorage = defaultStorage) {
  const q = String(query == null ? "" : query).trim();
  if (q === "") return read(getStorage);
  const list = [q, ...read(getStorage).filter(v => v !== q)].slice(0, RECENT_MAX);
  return write(list, getStorage) ? list : [];
}

export function removeRecent(query, getStorage = defaultStorage) {
  write(read(getStorage).filter(v => v !== query), getStorage);
}

export function clearRecent(getStorage = defaultStorage) {
  write([], getStorage);
}
