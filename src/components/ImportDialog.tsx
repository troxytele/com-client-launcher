import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, fmtBytes, fmtNum, ModrinthPack, msg, on, PackInfo } from "../api";
import Icon from "./Icon";
import { Modal, Spinner } from "./Ui";

// One place to bring things in: a Modrinth modpack (a link, or a downloaded .mrpack) or a Com Client profile
// someone exported (.ccprofile). Drop the file, pick it, or paste a link or a path; check what it is; then import.

type Found = { file: string; info: PackInfo } | { pack: ModrinthPack };

export default function ImportDialog({ onClose, onDone, onBrowse }: { onClose: () => void; onDone: (profileId: string) => void; onBrowse?: () => void }) {
  const [found, setFound] = useState<Found | null>(null);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: string; done: number; total: number } | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  async function check(input: string) {
    const v = input.trim().replace(/^"(.*)"$/, "$1");
    if (!v) return;
    setError("");
    setChecking(true);
    try {
      // a link or a name goes to Modrinth, anything that looks like a file is read from disk
      const isFile = /[\\/]/.test(v) && !/^https?:\/\//i.test(v);
      if (isFile || /\.(mrpack|ccprofile|zip)$/i.test(v)) setFound({ file: v, info: await api.packInspect(v) });
      else setFound({ pack: await api.modpackLookup(v) });
    } catch (e) {
      setError(msg(e));
    } finally {
      setChecking(false);
    }
  }

  // files dragged onto the launcher window
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (busyRef.current) return;
      const t = e.payload.type;
      if (t === "enter" || t === "over") setOver(true);
      else if (t === "leave") setOver(false);
      else if (t === "drop") {
        setOver(false);
        const f = e.payload.paths[0];
        if (f) check(f);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const un = on.modpackProgress((p) => setStage(p));
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function choose() {
    const f = await open({ title: "Import a modpack or profile", filters: [{ name: "Modpack or Com Client profile", extensions: ["mrpack", "ccprofile", "zip"] }] });
    if (typeof f === "string") check(f);
  }

  async function install() {
    if (!found) return;
    setBusy(true);
    setError("");
    try {
      let id: string;
      if ("pack" in found) id = await api.modpackInstall(found.pack.id, found.pack.title, found.pack.icon);
      else if (found.info.kind === "mrpack") id = await api.modpackInstallFile(found.file);
      else {
        const list = await api.profileImport(found.file);
        id = list[list.length - 1].id;
      }
      onDone(id);
    } catch (e) {
      setError(msg(e));
      setBusy(false);
      setStage(null);
    }
  }

  const problem = found ? ("pack" in found ? found.pack.problem : found.info.problem) : "";
  const pct = stage && stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : null;

  return (
    <Modal title="Import" onClose={() => !busy && onClose()} width={560}>
      {!found ? (
        <>
          <div className={"imp-drop" + (over ? " over" : "")} onClick={choose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && choose()}>
            <span className="imp-drop-icon">
              <Icon name="download" size={22} />
            </span>
            <b>{over ? "Drop it to check it" : "Drop a file here, or click to choose one"}</b>
            <span className="muted small">A Modrinth modpack (.mrpack) or a Com Client profile someone exported (.ccprofile)</span>
          </div>
          <div className="imp-or">
            <span>or paste a Modrinth link or a file path</span>
          </div>
          <form
            className="imp-paste"
            onSubmit={(e) => {
              e.preventDefault();
              check(text);
            }}
          >
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="https://modrinth.com/modpack/…   or   C:\Users\…\pack.mrpack" spellCheck={false} />
            <button className="btn primary" disabled={!text.trim() || checking}>
              {checking ? <Spinner size={13} /> : "Check"}
            </button>
          </form>
          {error && <p className="imp-error">{error}</p>}
          {onBrowse && (
            <button className="imp-browse" onClick={onBrowse}>
              <Icon name="search" size={14} /> Or find a modpack on Modrinth in the launcher
            </button>
          )}
        </>
      ) : (
        <>
          <div className="imp-card">
            {"pack" in found ? (
              found.pack.icon ? <img src={found.pack.icon} alt="" /> : <span className="imp-icon"><Icon name="box" size={26} /></span>
            ) : found.info.icon ? (
              <img src={found.info.icon} alt="" />
            ) : (
              <span className="imp-icon">
                <Icon name={found.info.kind === "mrpack" ? "box" : "layers"} size={26} />
              </span>
            )}
            <div className="imp-main">
              <b>{"pack" in found ? found.pack.title : found.info.name}</b>
              <div className="imp-tags">
                <span>{"pack" in found || found.info.kind === "mrpack" ? "Modrinth modpack" : "Com Client profile"}</span>
                {"pack" in found ? (
                  <>
                    {found.pack.version && <span>{found.pack.version}</span>}
                    <span>{fmtNum(found.pack.downloads)} downloads</span>
                  </>
                ) : (
                  <>
                    {found.info.version && <span>{found.info.version}</span>}
                    {(found.info.loader || found.info.minecraft) && <span>{[found.info.loader, found.info.minecraft].filter(Boolean).join(" ")}</span>}
                    <span>
                      {found.info.mods} mod{found.info.mods === 1 ? "" : "s"}
                    </span>
                    <span>{fmtBytes(found.info.size)}</span>
                  </>
                )}
              </div>
              {"pack" in found && found.pack.description && <p className="muted small">{found.pack.description}</p>}
              {!("pack" in found) && <p className="muted small imp-path">{found.file}</p>}
            </div>
          </div>
          {problem ? (
            <p className="imp-error">
              <Icon name="alert" size={14} /> {problem}
            </p>
          ) : (
            <p className="muted small">It becomes a new profile of its own. Your other profiles stay as they are.</p>
          )}
          {busy && (
            <div className="imp-progress">
              <div className="imp-bar">
                <i style={{ width: pct === null ? "30%" : pct + "%" }} className={pct === null ? "indeterminate" : ""} />
              </div>
              <span className="muted small">{stage ? stage.stage + (pct !== null ? ` · ${pct}%` : "") : "Importing…"}</span>
            </div>
          )}
          {error && <p className="imp-error">{error}</p>}
          <div className="modal-actions">
            <button className="btn" disabled={busy} onClick={() => { setFound(null); setError(""); }}>
              Back
            </button>
            <button className="btn primary" disabled={busy || !!problem} onClick={install}>
              {busy ? <Spinner size={13} /> : <Icon name="download" size={14} />} {"pack" in found || found.info.kind === "mrpack" ? "Install as a new profile" : "Import profile"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
