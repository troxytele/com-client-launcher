// Small shared stores (logs, toasts) that any component can read.
import { useSyncExternalStore } from "react";

function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      subs.forEach((s) => s());
    },
    subscribe: (s: () => void) => {
      subs.add(s);
      return () => subs.delete(s);
    },
  };
}

// ---------------------------------------------------------------- game log (last 5000 lines)

const MAX_LINES = 5000;
const logStore = store<string[]>([]);
let pending: string[] = [];
let flushQueued = false;

export function pushLog(line: string) {
  pending.push(line);
  if (!flushQueued) {
    flushQueued = true;
    // lines come in bursts: render at most ~10 times a second
    setTimeout(() => {
      const next = logStore.get().concat(pending);
      pending = [];
      flushQueued = false;
      logStore.set(next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next);
    }, 100);
  }
}

export function clearLog() {
  logStore.set([]);
}

export function useLog() {
  return useSyncExternalStore(logStore.subscribe, logStore.get);
}

export function getLog() {
  return logStore.get();
}

// ---------------------------------------------------------------- toasts

export type Toast = { id: number; text: string; kind: "info" | "error" | "ok" };
const toastStore = store<Toast[]>([]);
let nextId = 1;

export function toast(text: string, kind: Toast["kind"] = "info") {
  const t = { id: nextId++, text, kind };
  toastStore.set([...toastStore.get(), t].slice(-4));
  setTimeout(() => toastStore.set(toastStore.get().filter((x) => x.id !== t.id)), kind === "error" ? 7000 : 3800);
}

export function useToasts() {
  return useSyncExternalStore(toastStore.subscribe, toastStore.get);
}
