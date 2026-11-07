import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import logo from "../assets/logo.png";

// On every start: is there a newer launcher on GitHub? Then it downloads, installs and restarts by itself.
export default function Updater({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ version: string; done: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check({ timeout: 5000 });
        if (!update || cancelled) return onDone();
        let done = 0;
        let total = 0;
        setState({ version: update.version, done: 0, total: 0 });
        await update.downloadAndInstall((ev) => {
          if (ev.event === "Started") total = ev.data.contentLength ?? 0;
          if (ev.event === "Progress") done += ev.data.chunkLength;
          setState({ version: update.version, done, total });
        });
        await relaunch();
      } catch (e) {
        // offline, GitHub down or no release yet: just start
        console.warn("update check failed", e);
        onDone();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;
  const pct = state.total > 0 ? Math.min(100, (state.done / state.total) * 100) : 0;
  return (
    <div className="updater">
      <img src={logo} className="updater-logo" alt="" />
      <h2>Updating Com Client</h2>
      <p>Version {state.version}</p>
      <div className="bar">
        <div style={{ width: (state.total ? pct : 30) + "%" }} className={state.total ? "" : "indeterminate"} />
      </div>
      <span className="muted small">{state.total ? Math.round(pct) + "%" : "Starting…"}</span>
    </div>
  );
}
