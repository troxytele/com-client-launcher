import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, fmtTime, msg } from "./api";
import { toast } from "./stores";
import Icon from "./components/Icon";
import WindowButtons from "./components/WindowButtons";
import { Toasts } from "./components/Ui";
import logo from "./assets/logo.png";

type Level = "error" | "warn" | "info" | "debug" | "launcher";
type Line = { n: number; text: string; level: Level };
type Stats = { running: boolean; pid: number; profile: string; account: string; started: number; ram_mb: number; cpu: number };

const LEVELS: { id: Level; label: string }[] = [
  { id: "error", label: "Error" },
  { id: "warn", label: "Warn" },
  { id: "info", label: "Info" },
  { id: "debug", label: "Debug" },
  { id: "launcher", label: "Launcher" },
];
const MAX = 8000;

/** "[12:00:01] [Render thread/WARN]: ..." -> warn; stack trace lines follow the line before them. */
function levelOf(text: string, prev: Level): Level {
  if (text.startsWith("[Launcher]")) return "launcher";
  const m = /\/(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\]/.exec(text);
  if (m) return m[1] === "FATAL" || m[1] === "ERROR" ? "error" : m[1] === "WARN" ? "warn" : m[1] === "INFO" ? "info" : "debug";
  if (/^\s+at |^Caused by|^\s*\.\.\. \d+ more|Exception/.test(text)) return prev === "warn" ? "warn" : "error";
  return prev === "launcher" ? "info" : prev;
}

/** Splits "[12:00:01] [thread/INFO]: text" into time and the rest (the thread part is dropped in compact mode). */
function parts(text: string, compact: boolean) {
  const m = /^\[(\d\d:\d\d:\d\d)\] \[([^\]]+)\]: ?(.*)$/.exec(text);
  if (!m) return { time: "", thread: "", body: text };
  return { time: m[1], thread: compact ? "" : m[2], body: m[3] };
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

// The logs window: opens next to the game, shows its log live with filters, plus memory / CPU of the game.
export default function LogsWindow() {
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [off, setOff] = useState<Set<Level>>(new Set(["debug"]));
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [compact, setCompact] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const [now, setNow] = useState(Date.now() / 1000);
  const box = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const prevLevel = useRef<Level>("info");

  // the backlog, then every new line (batched, the game prints in bursts)
  useEffect(() => {
    let pending: string[] = [];
    let timer: number | null = null;
    const add = (texts: string[]) => {
      const out: Line[] = [];
      for (const t of texts) {
        const level = levelOf(t, prevLevel.current);
        prevLevel.current = level;
        out.push({ n: ++counter.current, text: t, level });
      }
      setLines((cur) => {
        const next = cur.concat(out);
        return next.length > MAX ? next.slice(next.length - MAX) : next;
      });
    };
    invoke<string[]>("log_backlog").then(add).catch(() => {});
    const un = listen<string>("game-log", (e) => {
      pending.push(e.payload);
      if (timer === null)
        timer = window.setTimeout(() => {
          add(pending);
          pending = [];
          timer = null;
        }, 80);
    });
    return () => {
      un.then((f) => f());
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // memory + CPU of the game
  useEffect(() => {
    const tick = () =>
      invoke<Stats>("game_stats")
        .then((s) => {
          setStats(s);
          setNow(Date.now() / 1000);
          if (s.running) setHistory((h) => [...h.slice(-59), s.ram_mb]);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, []);

  const q = query.trim().toLowerCase();
  const counts = useMemo(() => {
    const c: Record<Level, number> = { error: 0, warn: 0, info: 0, debug: 0, launcher: 0 };
    for (const l of lines) c[l.level]++;
    return c;
  }, [lines]);
  const shown = useMemo(() => lines.filter((l) => !off.has(l.level) && (!q || l.text.toLowerCase().includes(q))), [lines, off, q]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);

  function toggle(l: Level) {
    const next = new Set(off);
    next.has(l) ? next.delete(l) : next.add(l);
    setOff(next);
  }

  async function upload() {
    setUploading(true);
    try {
      const url = await invoke<string>("upload_log", { text: lines.map((l) => l.text).join("\n") });
      await navigator.clipboard.writeText(url).catch(() => {});
      toast("Uploaded, link copied: " + url, "ok");
      openUrl(url);
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setUploading(false);
    }
  }

  const running = !!stats?.running;
  const maxRam = Math.max(1, ...history);
  return (
    <div className="lw">
      <div className="lw-top" data-tauri-drag-region>
        <img src={logo} alt="" data-tauri-drag-region />
        <b data-tauri-drag-region>Game Logs</b>
        <span className={"lw-state" + (running ? " on" : "")} data-tauri-drag-region>
          <i /> {running ? "Running" : "Not running"}
        </span>
        <span className="grow" data-tauri-drag-region />
        <WindowButtons />
      </div>
      <div className="lw-body">
        <div className="lw-main">
          <div className="lw-bar">
            <div className="search small">
              <Icon name="search" size={14} />
              <input placeholder="Search the log…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {q && <span className="muted small">{shown.length}</span>}
            </div>
            <div className="lw-levels">
              {LEVELS.map((l) => (
                <button key={l.id} className={"lv " + l.id + (off.has(l.id) ? "" : " on")} onClick={() => toggle(l.id)}>
                  {l.label}
                  <em>{counts[l.id]}</em>
                </button>
              ))}
            </div>
          </div>
          <div
            ref={box}
            className={"lw-console" + (wrap ? " wrap" : "")}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              if (atBottom !== follow) setFollow(atBottom);
            }}
          >
            {shown.length === 0 && <div className="lw-empty">{lines.length ? "Nothing matches the filters." : "Waiting for the game…"}</div>}
            {shown.map((l) => {
              const p = parts(l.text, compact);
              return (
                <div key={l.n} className={"ll " + l.level}>
                  {p.time && <span className="ll-time">{p.time}</span>}
                  {p.thread && <span className="ll-thread">{p.thread}</span>}
                  <span className="ll-text">
                    <Highlight text={p.body} q={q} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="lw-foot">
            <span className="muted small">
              {lines.length} lines{shown.length !== lines.length ? ` · ${shown.length} shown` : ""}
            </span>
            <button className={"lw-chip" + (follow ? " on" : "")} onClick={() => setFollow(!follow)}>
              <Icon name="chevronDown" size={13} /> Follow
            </button>
            <button className={"lw-chip" + (wrap ? " on" : "")} onClick={() => setWrap(!wrap)}>
              Wrap
            </button>
            <button className={"lw-chip" + (compact ? " on" : "")} onClick={() => setCompact(!compact)} title="Hide the thread names">
              Compact
            </button>
            <span className="grow" />
            <button className="lw-chip" onClick={() => navigator.clipboard.writeText(shown.map((l) => l.text).join("\n")).then(() => toast("Copied " + shown.length + " lines", "ok"))}>
              <Icon name="copy" size={13} /> Copy
            </button>
            <button
              className="lw-chip"
              onClick={() => {
                setLines([]);
                invoke("log_clear");
              }}
            >
              <Icon name="trash" size={13} /> Clear
            </button>
            <button className="lw-chip accent" disabled={uploading || !lines.length} onClick={upload} title="Share the log with a link (mclo.gs hides your IP)">
              <Icon name="external" size={13} /> {uploading ? "Uploading…" : "Upload to mclo.gs"}
            </button>
          </div>
        </div>
        <aside className="lw-side">
          <div className="lw-card">
            <span className="lw-label">Instance</span>
            {running && stats ? (
              <>
                <b className="lw-profile">{stats.profile}</b>
                <span className="muted small">
                  {stats.account} · {fmtTime(Math.max(0, Math.floor(now - stats.started)))}
                </span>
              </>
            ) : (
              <span className="muted small">The game isn't running.</span>
            )}
          </div>
          <div className="lw-card">
            <span className="lw-label">Memory</span>
            <b className="lw-big">{running && stats ? (stats.ram_mb >= 1024 ? (stats.ram_mb / 1024).toFixed(2) + " GB" : stats.ram_mb + " MB") : "–"}</b>
            <div className="lw-spark">
              {history.map((v, i) => (
                <i key={i} style={{ height: `${Math.max(4, (v / maxRam) * 100)}%` }} />
              ))}
            </div>
          </div>
          <div className="lw-card">
            <span className="lw-label">CPU</span>
            <b className="lw-big">{running && stats ? stats.cpu.toFixed(0) + "%" : "–"}</b>
            <div className="lw-meter">
              <i style={{ width: `${running && stats ? Math.min(100, stats.cpu) : 0}%` }} />
            </div>
          </div>
          <div className="lw-actions">
            <button className="btn danger" disabled={!running} onClick={() => api.kill()}>
              <Icon name="stop" size={13} fill /> Stop game
            </button>
            <div className="row-gap">
              <button className="btn small grow" onClick={() => api.openFolder("logs")} title="Log files">
                <Icon name="folder" size={14} /> Logs
              </button>
              <button className="btn small grow" onClick={() => api.openFolder("crash")} title="Crash reports">
                <Icon name="bug" size={14} /> Crashes
              </button>
            </div>
          </div>
        </aside>
      </div>
      <Toasts />
    </div>
  );
}
