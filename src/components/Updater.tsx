import { useEffect, useRef, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import logo from "../assets/logo.png";
import Icon from "./Icon";
import { CHANGELOG } from "./WhatsNew";

type Phase = "download" | "install" | "restart" | "error";
type State = { version: string; done: number; total: number; phase: Phase; speed: number; error?: string };

const mb = (b: number) => (b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1);

/** What's new in the update: our own list if this launcher knows it, otherwise the release notes. */
function notesFor(update: Update): string[] {
  const own = CHANGELOG.find((c) => c.version === update.version);
  if (own) return own.items.map(([, title, text]) => `${title}: ${text}`);
  return String(update.body || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*+]\s/.test(l))
    .map((l) => l.replace(/^[-*+]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1"))
    .slice(0, 5);
}

// On every start: is there a newer launcher on GitHub? Then it downloads, installs and restarts by itself.
export default function Updater({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const update = useRef<Update | null>(null);
  const started = useRef(false);

  async function run(u: Update) {
    let done = 0;
    let total = 0;
    const samples: [number, number][] = [];
    setState({ version: u.version, done: 0, total: 0, phase: "download", speed: 0 });
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          const now = performance.now();
          samples.push([now, done]);
          while (samples.length > 2 && now - samples[0][0] > 2500) samples.shift();
          const [t0, d0] = samples[0];
          const speed = now - t0 > 300 ? ((done - d0) / (now - t0)) * 1000 : 0;
          setState({ version: u.version, done, total, phase: "download", speed });
        }
        if (ev.event === "Finished") setState({ version: u.version, done: total || done, total: total || done, phase: "install", speed: 0 });
      });
      setState((s) => (s ? { ...s, phase: "restart" } : s));
      await new Promise((r) => setTimeout(r, 600));
      await relaunch();
    } catch (e) {
      setState({ version: u.version, done, total, phase: "error", speed: 0, error: String(e) });
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const u = await check({ timeout: 5000 });
        if (!u) return onDone();
        update.current = u;
        setNotes(notesFor(u));
        run(u);
      } catch (e) {
        // offline, GitHub down or no release yet: just start
        console.warn("update check failed", e);
        onDone();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;
  const pct = state.total > 0 ? Math.min(100, (state.done / state.total) * 100) : 0;
  const left = state.speed > 0 && state.total > 0 ? Math.max(0, (state.total - state.done) / state.speed) : null;
  const steps: [Phase, string][] = [
    ["download", "Download"],
    ["install", "Install"],
    ["restart", "Restart"],
  ];
  const at = steps.findIndex(([p]) => p === state.phase);
  const ring = 2 * Math.PI * 54;
  const shown = state.phase === "download" ? (state.total ? pct : 8) : 100;

  return (
    <div className="updater">
      <div className="upd-card">
        <div className={"upd-ring" + (state.phase === "download" && !state.total ? " spin" : "")}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" className="track" />
            <circle cx="60" cy="60" r="54" className="fill" strokeDasharray={ring} strokeDashoffset={ring * (1 - shown / 100)} />
          </svg>
          <img src={logo} alt="" />
        </div>

        <span className="upd-eyebrow">{state.phase === "error" ? "Update failed" : "Updating"}</span>
        <h2>Com Client {state.version}</h2>

        {state.phase === "error" ? (
          <>
            <p className="upd-error">{state.error?.slice(0, 160) || "Something went wrong."}</p>
            <div className="upd-actions">
              <button className="btn primary" onClick={() => update.current && run(update.current)}>
                <Icon name="refresh" size={14} /> Try again
              </button>
              <button className="btn" onClick={onDone}>
                Start without updating
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="upd-steps">
              {steps.map(([p, label], i) => (
                <span key={p} className={i < at ? "done" : i === at ? "now" : ""}>
                  <i>{i < at ? <Icon name="check" size={10} /> : i + 1}</i>
                  {label}
                </span>
              ))}
            </div>
            <div className="upd-numbers">
              {state.phase === "download" ? (
                <>
                  <b>{state.total ? Math.round(pct) + "%" : "Starting…"}</b>
                  <span>
                    {state.total ? `${mb(state.done)} / ${mb(state.total)} MB` : ""}
                    {state.speed > 0 ? ` · ${mb(state.speed)} MB/s` : ""}
                    {left !== null && left > 1 ? ` · ${Math.ceil(left)} s left` : ""}
                  </span>
                </>
              ) : (
                <b>{state.phase === "install" ? "Installing…" : "Restarting…"}</b>
              )}
            </div>
          </>
        )}

        {notes.length > 0 && (
          <div className="upd-notes">
            <span>What's new</span>
            <ul>
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
