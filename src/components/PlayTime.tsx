import { getLang } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { api, LogEntry, Profile } from "../api";

/** Seconds played on each local day / week, from the play log (sessions that pass midnight are split). */
function perDay(log: LogEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of log) {
    let t = s.start * 1000;
    let left = s.secs * 1000;
    while (left > 0) {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      const dayStart = d.getTime();
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const part = Math.min(left, next.getTime() - t);
      out.set(dayStart, (out.get(dayStart) || 0) + part / 1000);
      left -= part;
      t += part;
    }
  }
  return out;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};
/** Monday of the week (local). */
const startOfWeek = (t: number) => {
  const d = startOfDay(t);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

export function hm(secs: number) {
  const m = Math.round(secs / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
}

/** Play time per day (last 14 days) or per week (last 12 weeks), for all profiles or one. */
export default function PlayTime({ profiles, version }: { profiles: Profile[]; version: number }) {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [mode, setMode] = useState<"days" | "weeks">("days");
  const [who, setWho] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    api.playLog().then(setLog).catch(() => setLog([]));
  }, [version]);

  const bars = useMemo(() => {
    const days = perDay((log || []).filter((s) => !who || s.profile === who));
    const out: { label: string; title: string; secs: number; now: boolean }[] = [];
    const now = Date.now();
    if (mode === "days") {
      const today = startOfDay(now);
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        out.push({
          label: i === 0 ? "Today" : d.toLocaleDateString(getLang(), { weekday: "short" }),
          title: d.toLocaleDateString(getLang(), { weekday: "long", day: "numeric", month: "short" }),
          secs: days.get(d.getTime()) || 0,
          now: i === 0,
        });
      }
    } else {
      const week = startOfWeek(now);
      for (let i = 11; i >= 0; i--) {
        const from = new Date(week);
        from.setDate(week.getDate() - i * 7);
        let secs = 0;
        for (let k = 0; k < 7; k++) {
          const d = new Date(from);
          d.setDate(from.getDate() + k);
          secs += days.get(d.getTime()) || 0;
        }
        out.push({
          label: i === 0 ? "This wk" : from.toLocaleDateString(getLang(), { day: "numeric", month: "short" }),
          title: "Week of " + from.toLocaleDateString(getLang(), { day: "numeric", month: "long" }),
          secs,
          now: i === 0,
        });
      }
    }
    return out;
  }, [log, mode, who]);

  const max = Math.max(1, ...bars.map((b) => b.secs));
  const total = bars.reduce((n, b) => n + b.secs, 0);
  const played = bars.filter((b) => b.secs > 0).length;
  const shown = hover !== null ? bars[hover] : null;

  return (
    <div className="playtime glass">
      <div className="pt-head">
        <div>
          <b>Play time</b>
          <span className="muted small">
            {shown
              ? `${shown.title}: ${hm(shown.secs)}`
              : `${hm(total)} in the last ${mode === "days" ? "14 days" : "12 weeks"} · ${hm(played ? total / played : 0)} on average when you played`}
          </span>
        </div>
        <div className="row-gap">
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="seg">
            <button className={mode === "days" ? "on" : ""} onClick={() => setMode("days")}>
              Days
            </button>
            <button className={mode === "weeks" ? "on" : ""} onClick={() => setMode("weeks")}>
              Weeks
            </button>
          </div>
        </div>
      </div>
      {log === null ? (
        <div className="pt-bars" />
      ) : (
        <div className="pt-bars" onMouseLeave={() => setHover(null)}>
          {bars.map((b, i) => (
            <div key={i} className={"pt-bar" + (b.now ? " now" : "") + (hover === i ? " hover" : "")} onMouseEnter={() => setHover(i)}>
              <span className="pt-val">{b.secs >= 60 ? hm(b.secs) : ""}</span>
              <i style={{ height: Math.max(2, (b.secs / max) * 100) + "%" }} className={b.secs ? "" : "zero"} />
              <span className="pt-label">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
