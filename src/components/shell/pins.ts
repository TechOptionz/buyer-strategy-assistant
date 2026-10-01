"use client";

/**
 * Pinned cases are a per-viewer convenience kept in this browser only. Storage can be unavailable
 * (private windows, blocked site data), so every access is guarded and the UI works without it.
 */
const KEY = "bsa-pinned-cases";
const listeners = new Set<() => void>();
const EMPTY: string[] = [];
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: string[]) {
  cache = ids;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: keep the in-memory value for this session.
  }
  listeners.forEach((l) => l());
}

export const pinStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: read,
  server: () => EMPTY,
  toggle(id: string) {
    const cur = read();
    write(cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, 8));
  },
};
