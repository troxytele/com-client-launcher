import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { api, fmtBytes, fmtNum, ImportParts, ImportProgress, ImportSource, ModrinthPack, msg, on, PackInfo } from "../api";
import Icon from "./Icon";
import { Modal, Spinner } from "./Ui";

// One place to bring things in: a Modrinth modpack (a link, or a downloaded .mrpack), a Com Client profile someone
// exported (.ccprofile), or a whole instance from another launcher (Modrinth App, Prism, CurseForge, Lunar, NoRisk ...).

type Found = { file: string; info: PackInfo } | { pack: ModrinthPack };

export default function ImportDialog({ onClose, onDone, onBrowse }: { onClose: () => void; onDone: (profileId: string) => void; onBrowse?: () => void }) {
  const [tab, setTab] = useState<"file" | "launchers">("file");
  const [found, setFound] = useState<Found | null>(null);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [folder, setFolder] = useState<ImportSource | null>(null); // a folder pasted or dropped: an instance to import
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
      const packFile = /\.(mrpack|ccprofile|zip)$/i.test(v);
      if (isFile && !packFile) {
        // a folder (or options.txt): a Minecraft instance from another launcher, not a pack file
        setFolder(await api.importFolder(v));
        setTab("launchers");
      } else if (isFile || packFile) setFound({ file: v, info: await api.packInspect(v) });
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
    <Modal title="Import" onClose={() => !busy && onClose()} width={600}>
      {!found && !busy && (
        <div className="imp-tabs">
          <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
            <Icon name="box" size={14} /> Modpack or profile file
          </button>
          <button className={tab === "launchers" ? "on" : ""} onClick={() => setTab("launchers")}>
            <Icon name="layers" size={14} /> From another launcher
          </button>
        </div>
      )}
      {tab === "launchers" && !found ? (
        <Launchers onDone={onDone} preset={folder} onClearPreset={() => setFolder(null)} />
      ) : !found ? (
        <>
          <div className={"imp-drop" + (over ? " over" : "")} onClick={choose} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && choose()}>
            <span className="imp-drop-icon">
              <Icon name="download" size={22} />
            </span>
            <b>{over ? "Drop it to check it" : "Drop a file here, or click to choose one"}</b>
            <span className="muted small">A Modrinth modpack (.mrpack) or a Com Client profile someone exported (.ccprofile)</span>
          </div>
          <div className="imp-or">
            <span>or paste a Modrinth link, a file path or a Minecraft folder</span>
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

// ---------------------------------------------------------------- other launchers

const TITLES: [keyof ImportParts, string][] = [
  ["settings", "Video, sound and mouse settings"],
  ["keybinds", "Keybinds"],
  ["servers", "Server list"],
  ["packs", "Resource packs"],
  ["shaders", "Shader packs"],
  ["worlds", "Worlds"],
  ["mods", "Mods and their settings"],
];

function Launchers({ onDone, preset, onClearPreset }: { onDone: (profileId: string) => void; preset?: ImportSource | null; onClearPreset?: () => void }) {
  const [list, setList] = useState<ImportSource[] | null>(null);
  const [pick, setPick] = useState<ImportSource | null>(null);
  const [path, setPath] = useState("");
  const [looking, setLooking] = useState(false);
  const [name, setName] = useState("");
  const [parts, setParts] = useState<ImportParts>({ settings: true, keybinds: true, servers: true, packs: true, shaders: true, worlds: false, mods: true });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (preset) choose(preset);
  }, [preset]);

  // a folder the scan didn't find: picked in a folder window or typed in
  async function useFolder(p: string) {
    const v = p.trim().replace(/^"(.*)"$/, "$1");
    if (!v) return;
    setLooking(true);
    setError("");
    try {
      choose(await api.importFolder(v));
    } catch (e) {
      setError(msg(e));
    } finally {
      setLooking(false);
    }
  }
  async function browseFolder() {
    const f = await open({ title: "Choose the Minecraft folder or instance to import", directory: true });
    if (typeof f === "string") useFolder(f);
  }
  const other = (
    <div className="imp-other">
      <span className="muted small">Not in the list? Choose the instance folder (or its .minecraft folder) yourself:</span>
      <form
        className="imp-paste"
        onSubmit={(e) => {
          e.preventDefault();
          useFolder(path);
        }}
      >
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\…\AppData\Roaming\PrismLauncher\instances\My Pack" spellCheck={false} />
        <button type="button" className="btn" onClick={browseFolder} disabled={looking}>
          <Icon name="folder" size={14} /> Choose…
        </button>
        <button className="btn primary" disabled={!path.trim() || looking}>
          {looking ? <Spinner size={13} /> : "Use"}
        </button>
      </form>
      {error && <p className="imp-error">{error}</p>}
    </div>
  );

  useEffect(() => {
    api.importScan().then(setList).catch((e) => {
      setError(msg(e));
      setList([]);
    });
    const off = listen<ImportProgress>("import-progress", (e) => setProg(e.payload));
    return () => {
      off.then((f) => f());
    };
  }, []);

  const ago = (t: number) => {
    const d = Math.floor((Date.now() / 1000 - t) / 86400);
    return t <= 0 ? "" : d < 1 ? "today" : d < 2 ? "yesterday" : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
  };

  function choose(s: ImportSource) {
    setPick(s);
    setName(s.name === s.launcher ? s.launcher : `${s.name}`);
    setParts((p) => ({ ...p, mods: s.mods_ok, worlds: false }));
    setError("");
  }

  async function run() {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      const p = { ...parts, mods: parts.mods && pick.mods_ok };
      onDone(await api.importInstance(pick.dir, name, p));
    } catch (e) {
      setError(msg(e));
      setBusy(false);
    }
  }

  if (!list && !pick) {
    return (
      <>
        <div className="imp-scan">
          <Spinner size={18} /> <span className="muted">Looking for Minecraft launchers on this PC…</span>
        </div>
        {other}
      </>
    );
  }
  if (!pick && list && !list.length)
    return (
      <>
        <p className="muted imp-scan">No other launchers found on this PC (Minecraft Launcher, Modrinth App, Prism, CurseForge, Lunar, NoRisk, Feather …).</p>
        {other}
      </>
    );

  if (!pick && list) {
    return (
      <>
      <div className="imp-list">
        {list.map((s) => (
          <button key={s.dir} className="imp-inst" onClick={() => choose(s)} title={s.dir}>
            <span className="imp-launcher">{s.launcher}</span>
            <b>{s.name}</b>
            <span className="muted small">
              {[s.loader && s.version ? `${s.loader} ${s.version}` : s.loader || s.version, s.mods ? `${s.mods} mods` : "", s.worlds ? `${s.worlds} worlds` : "", s.packs ? `${s.packs} packs` : "", ago(s.modified)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Icon name="chevron" size={14} />
          </button>
        ))}
      </div>
      {other}
      </>
    );
  }
  if (!pick) return null;

  const count = (k: keyof ImportParts) =>
    k === "packs" ? (pick.packs ? `${pick.packs} · ${fmtBytes(pick.packs_bytes)}` : "none")
    : k === "shaders" ? (pick.shaders ? String(pick.shaders) : "none")
    : k === "worlds" ? (pick.worlds ? `${pick.worlds} · ${fmtBytes(pick.worlds_bytes)}` : "none")
    : k === "mods" ? (pick.mods ? String(pick.mods) : "none")
    : k === "servers" ? (pick.servers ? "" : "none")
    : k === "keybinds" ? (pick.keybinds ? String(pick.keybinds) : "none")
    : "";
  const off = (k: keyof ImportParts) => (k === "mods" ? !pick.mods_ok : count(k) === "none");
  const pct = prog && prog.total > 0 ? Math.min(100, Math.round((prog.done / prog.total) * 100)) : null;

  return (
    <>
      <div className="imp-card">
        <span className="imp-icon">
          <Icon name="layers" size={26} />
        </span>
        <div className="imp-main">
          <b>{pick.name}</b>
          <div className="imp-tags">
            <span>{pick.launcher}</span>
            {(pick.loader || pick.version) && <span>{[pick.loader, pick.version].filter(Boolean).join(" ")}</span>}
          </div>
          <p className="muted small imp-path">{pick.dir}</p>
        </div>
      </div>
      <label className="imp-name">
        <span className="muted small">New profile name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <div className="imp-parts">
        {TITLES.map(([k, label]) => (
          <label key={k} className={"imp-part" + (off(k) ? " off" : "")}>
            <input type="checkbox" checked={parts[k] && !off(k)} disabled={off(k) || busy} onChange={(e) => setParts({ ...parts, [k]: e.target.checked })} />
            <span>{label}</span>
            <small>{count(k)}</small>
          </label>
        ))}
      </div>
      {pick.mods > 0 && !pick.mods_ok && (
        <p className="muted small">
          <Icon name="info" size={13} /> Its mods stay behind: they're{" "}
          {pick.loader && pick.loader !== "Fabric" ? `for ${pick.loader}` : pick.version ? `for Minecraft ${pick.version}` : "not Fabric mods for Minecraft 1.21.11"}, and Com Client runs Fabric 1.21.11.
          {pick.launcher.match(/Lunar|NoRisk|Feather|Badlion/) ? " Its own client features don't carry over either." : ""}
        </p>
      )}
      {busy && (
        <div className="imp-progress">
          <div className="imp-bar">
            <i style={{ width: pct === null ? "30%" : pct + "%" }} className={pct === null ? "indeterminate" : ""} />
          </div>
          <span className="muted small">{prog ? `Copying ${prog.name}` + (pct !== null ? ` · ${pct}%` : "") : "Importing…"}</span>
        </div>
      )}
      {error && <p className="imp-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" disabled={busy} onClick={() => { setPick(null); setError(""); onClearPreset?.(); }}>
          Back
        </button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={run}>
          {busy ? <Spinner size={13} /> : <Icon name="download" size={14} />} Import as a new profile
        </button>
      </div>
    </>
  );
}
