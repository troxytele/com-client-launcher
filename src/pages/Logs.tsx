import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { clearLog, toast, useLog } from "../stores";
import Icon from "../components/Icon";

// Live game console: filter, follow, copy, open logs / crash reports.
export default function Logs() {
  const lines = useLog();
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<"all" | "warn" | "error">("all");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return lines.filter((l) => {
      if (f && !l.toLowerCase().includes(f)) return false;
      if (level === "error") return /ERROR|FATAL|Exception|\tat /.test(l);
      if (level === "warn") return /WARN|ERROR|FATAL|Exception/.test(l);
      return true;
    });
  }, [lines, filter, level]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);

  return (
    <div className="page logs-page">
      <div className="page-head">
        <div>
          <h1>Logs</h1>
          <p className="muted">What the game prints while it starts and runs.</p>
        </div>
        <div className="row-gap">
          <button className="btn" onClick={() => api.openFolder("logs")}>
            <Icon name="folder" size={14} /> Log files
          </button>
          <button className="btn" onClick={() => api.openFolder("crash")}>
            <Icon name="alert" size={14} /> Crash reports
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="search small">
          <Icon name="search" size={15} />
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="row-gap">
          <div className="seg">
            {(["all", "warn", "error"] as const).map((l) => (
              <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>
                {l === "all" ? "All" : l === "warn" ? "Warnings" : "Errors"}
              </button>
            ))}
          </div>
          <button className={"btn small" + (follow ? " primary" : "")} onClick={() => setFollow(!follow)}>
            Follow
          </button>
          <button
            className="btn small"
            onClick={() => navigator.clipboard.writeText(shown.join("\n")).then(() => toast("Copied " + shown.length + " lines", "ok"))}
          >
            <Icon name="copy" size={14} /> Copy
          </button>
          <button className="btn small" onClick={clearLog}>
            <Icon name="trash" size={14} /> Clear
          </button>
        </div>
      </div>
      <div
        className="console glass"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {shown.length === 0 && <div className="muted">Nothing yet. Start the game and its log shows up here.</div>}
        {shown.map((l, i) => (
          <div key={i} className={/ERROR|FATAL|Exception|\tat /.test(l) ? "l-err" : /WARN/.test(l) ? "l-warn" : l.startsWith("[Launcher]") ? "l-launcher" : ""}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
