import { useEffect, useMemo, useState } from "react";
import { ago, api, CrashFile, msg } from "../api";
import { analyze, important } from "../crash";
import { toast } from "../stores";
import Icon from "../components/Icon";
import { Empty, Spinner } from "../components/Ui";

// Crash Log Viewer + Analyzer: every crash report / Java crash / latest log of every profile, with an explanation of
// what most likely went wrong and the lines that matter highlighted.
export default function Crashes({ initial }: { initial?: string | null }) {
  const [files, setFiles] = useState<CrashFile[] | null>(null);
  const [sel, setSel] = useState<string | null>(initial ?? null);
  const [text, setText] = useState<string | null>(null);
  const [onlyImportant, setOnlyImportant] = useState(true);

  useEffect(() => {
    api
      .crashes()
      .then((f) => {
        setFiles(f);
        const norm = (x: string) => x.replace(/\\/g, "/").toLowerCase();
        const hit = sel ? f.find((x) => norm(x.path) === norm(sel)) : undefined;
        if (hit) setSel(hit.path);
        else if (f.length) setSel((f.find((x) => x.kind !== "log") ?? f[0]).path);
        else setSel(null);
      })
      .catch((e) => {
        setFiles([]);
        toast(msg(e), "error");
      });
  }, []);

  useEffect(() => {
    if (!sel || !files) return;
    setText(null);
    api
      .crashRead(sel)
      .then(setText)
      .catch((e) => {
        setText("");
        toast(msg(e), "error");
      });
  }, [sel, files]);

  const result = useMemo(() => (text ? analyze(text) : null), [text]);
  const lines = useMemo(() => {
    if (!text) return [];
    const all = text.split(/\r?\n/);
    if (!onlyImportant) return all.slice(-1500).map((l) => ({ l, k: important(l) }));
    const out: { l: string; k: ReturnType<typeof important> }[] = [];
    all.forEach((l, i) => {
      const k = important(l);
      if (k) {
        out.push({ l, k });
        // a few stack frames under each error
        for (let j = i + 1; j < Math.min(all.length, i + 4) && /^\s+at /.test(all[j]); j++) out.push({ l: all[j], k: null });
      }
    });
    return out.slice(-400);
  }, [text, onlyImportant]);
  const current = files?.find((f) => f.path === sel);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Crashes</h1>
          <p className="muted">Crash reports from all your profiles, with what most likely went wrong.</p>
        </div>
        {current && (
          <button className="btn" onClick={() => api.openFile(current.path)}>
            <Icon name="file" size={14} /> Open file
          </button>
        )}
      </div>
      {!files ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <Empty icon="check" title="No crashes" text="Nothing has crashed yet. If the game ever does, the report shows up here." />
      ) : (
        <div className="crash-layout">
          <div className="crash-list">
            {files.map((f) => (
              <button key={f.path} className={"crash-item" + (f.path === sel ? " on" : "")} onClick={() => setSel(f.path)}>
                <i className={"kind " + f.kind} />
                <span>
                  <b>{f.kind === "crash" ? "Crash report" : f.kind === "jvm" ? "Java crash" : "Latest log"}</b>
                  <small>
                    {f.profile} · {ago(f.modified)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="crash-main">
            {!text && text !== "" ? (
              <div className="center pad">
                <Spinner />
              </div>
            ) : (
              <>
                {result?.description && <div className="crash-desc">“{result.description}”</div>}
                <div className="findings">
                  {result?.findings.map((f, i) => (
                    <div key={i} className={"finding " + f.level}>
                      <Icon name={f.level === "fix" ? "wrench" : "info"} size={16} />
                      <div>
                        <b>{f.title}</b>
                        <p>{f.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="viewer-head">
                  <span>{current?.name}</span>
                  <label>
                    <input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.target.checked)} /> Only the important
                    lines
                  </label>
                </div>
                <pre className="crash-view">
                  {lines.map((x, i) => (
                    <div key={i} className={x.k ?? undefined}>
                      {x.l || " "}
                    </div>
                  ))}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
