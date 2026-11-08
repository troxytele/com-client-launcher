// Mod / resource pack / shader updates for the selected profile, checked in the background.
import { useEffect, useState } from "react";
import { api, Kind, msg, Update } from "./api";

export type Updates = Record<Exclude<Kind, "modpack">, Update[]> & { at: number; profile: string; checking: boolean };

const KINDS = ["mod", "resourcepack", "shader"] as const;
let state: Updates = { mod: [], resourcepack: [], shader: [], at: 0, profile: "", checking: false };
const subs = new Set<(u: Updates) => void>();
const set = (next: Partial<Updates>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f(state));
};

export const updateCount = (u: Updates) => u.mod.length + u.resourcepack.length + u.shader.length;

/** Asks Modrinth which installed files have newer versions (quietly; errors only mean "no updates known"). */
export async function checkUpdates(profile: string) {
  if (state.checking) return;
  set({ checking: true, profile });
  const out: Partial<Updates> = {};
  for (const k of KINDS) {
    try {
      out[k] = await api.modsUpdates(k);
    } catch {
      out[k] = [];
    }
  }
  set({ ...out, at: Date.now(), checking: false });
}

/** Updates everything that was found. Returns how many worked. */
export async function updateAll(onStep?: (done: number, total: number, name: string) => void): Promise<{ ok: number; failed: string[] }> {
  const list = KINDS.flatMap((k) => state[k].map((u) => [k, u] as const));
  let ok = 0;
  const failed: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const [k, u] = list[i];
    onStep?.(i, list.length, u.filename);
    try {
      await api.modUpdate(k, u);
      ok++;
      set({ [k]: state[k].filter((x) => x.file !== u.file) } as Partial<Updates>);
    } catch (e) {
      failed.push(u.filename + ": " + msg(e));
    }
  }
  onStep?.(list.length, list.length, "");
  return { ok, failed };
}

/** Removes one entry after it was updated somewhere else (the Mods page). */
export function markUpdated(kind: Exclude<Kind, "modpack">, file: string) {
  set({ [kind]: state[kind].filter((x) => x.file !== file) } as Partial<Updates>);
}

export function useUpdates() {
  const [u, setU] = useState(state);
  useEffect(() => {
    subs.add(setU);
    return () => {
      subs.delete(setU);
    };
  }, []);
  return u;
}
