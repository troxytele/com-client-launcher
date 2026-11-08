import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, fmtBytes, fmtNum, Hit, Installed, Kind, msg, on, Update } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import ImportDialog from "../components/ImportDialog";
import { markUpdated, useUpdates } from "../updates";
import { Empty, Spinner, Switch } from "../components/Ui";

const KINDS: { id: Kind; label: string; icon: string; folder: string }[] = [
  { id: "mod", label: "Mods", icon: "cube", folder: "mods" },
  { id: "resourcepack", label: "Resource Packs", icon: "image", folder: "resourcepacks" },
  { id: "shader", label: "Shaders", icon: "sun", folder: "shaderpacks" },
  { id: "modpack", label: "Modpacks", icon: "box", folder: "" },
];

const SORTS = [
  { id: "relevance", label: "Relevance" },
  { id: "downloads", label: "Downloads" },
  { id: "follows", label: "Popular" },
  { id: "newest", label: "Newest" },
  { id: "updated", label: "Updated" },
];

export default function Mods({ profileName, running, onModpack }: { profileName: string; running: boolean; onModpack: (id: string) => void }) {
  const [importing, setImporting] = useState(false);
  const [kind, setKind] = useState<Kind>("mod");
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const k = KINDS.find((x) => x.id === kind)!;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Mods & Packs</h1>
          <p className="muted">
            For the profile <b>{profileName}</b>. Com Client and Fabric API are built in and don't show here.
          </p>
        </div>
        {k.folder && (
          <button className="btn" onClick={() => api.openFolder(k.folder)}>
            <Icon name="folder" size={15} /> Open folder
          </button>
        )}
      </div>
      <div className="toolbar">
        <div className="seg">
          {KINDS.map((x) => (
            <button key={x.id} className={x.id === kind ? "on" : ""} onClick={() => setKind(x.id)}>
              <Icon name={x.icon} size={15} /> {x.label}
            </button>
          ))}
        </div>
        {kind !== "modpack" && <div className="seg">
          <button className={tab === "installed" ? "on" : ""} onClick={() => setTab("installed")}>
            Installed
          </button>
          <button className={tab === "browse" ? "on" : ""} onClick={() => setTab("browse")}>
            <Icon name="search" size={14} /> Discover
          </button>
        </div>}
      </div>
      {kind === "shader" && (
        <p className="hint">
          <Icon name="sparkle" size={14} /> Shaders need the Iris mod: find it under Mods → Discover.
        </p>
      )}
      {kind === "modpack" && (
        <p className="hint hint-row">
          <span>
            <Icon name="box" size={14} /> A modpack installs as a new profile of its own (your other profiles stay as they are).
          </span>
          <button className="btn small" onClick={() => setImporting(true)}>
            <Icon name="download" size={13} /> Import a file or link
          </button>
        </p>
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={(id) => {
            setImporting(false);
            toast("Imported as a new profile", "ok");
            onModpack(id);
          }}
        />
      )}
      {kind === "modpack" ? (
        <Browse kind={kind} onModpack={onModpack} />
      ) : tab === "installed" ? (
        <InstalledList kind={kind} running={running} onBrowse={() => setTab("browse")} />
      ) : (
        <Browse kind={kind} />
      )}
    </div>
  );
}

function InstalledList({ kind, running, onBrowse }: { kind: Kind; running: boolean; onBrowse: () => void }) {
  const [items, setItems] = useState<Installed[] | null>(null);
  const [updates, setUpdates] = useState<Record<string, Update>>({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    api.modsList(kind).then(setItems).catch((e) => toast(msg(e), "error"));
  }, [kind]);

  const known = useUpdates();
  useEffect(() => {
    setItems(null);
    setUpdates({});
    load();
  }, [load]);
  // what the background check already found
  useEffect(() => {
    if (kind === "modpack") return;
    const list = known[kind as "mod" | "resourcepack" | "shader"] ?? [];
    if (list.length) setUpdates((cur) => ({ ...Object.fromEntries(list.map((x) => [x.file, x])), ...cur }));
  }, [known, kind]);

  async function checkUpdates() {
    setChecking(true);
    try {
      const u = await api.modsUpdates(kind);
      setUpdates(Object.fromEntries(u.map((x) => [x.file, x])));
      toast(u.length ? `${u.length} update${u.length === 1 ? "" : "s"} available` : "Everything is up to date", u.length ? "info" : "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setChecking(false);
    }
  }

  async function updateOne(u: Update) {
    setBusy(u.file);
    try {
      await api.modUpdate(kind, u);
      if (kind !== "modpack") markUpdated(kind as "mod" | "resourcepack" | "shader", u.file);
      const next = { ...updates };
      delete next[u.file];
      setUpdates(next);
      load();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function updateAll() {
    for (const u of Object.values(updates)) await updateOne(u);
    toast("Updated", "ok");
  }

  if (!items)
    return (
      <div className="center pad">
        <Spinner />
      </div>
    );
  const shown = items.filter((i) => (i.name + i.file).toLowerCase().includes(filter.toLowerCase()));
  const nUpdates = Object.keys(updates).length;
  return (
    <>
      <div className="toolbar">
        <div className="search small">
          <Icon name="search" size={15} />
          <input placeholder={`Filter ${items.length} installed`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="row-gap">
          {nUpdates > 0 && (
            <button className="btn primary" onClick={updateAll} disabled={!!busy || running}>
              <Icon name="download" size={15} /> Update all ({nUpdates})
            </button>
          )}
          <button className="btn" onClick={checkUpdates} disabled={checking}>
            {checking ? <Spinner size={13} /> : <Icon name="refresh" size={15} />} Check for updates
          </button>
        </div>
      </div>
      {running && <p className="hint">The game is running: changes apply the next time you start it.</p>}
      {items.length === 0 ? (
        <Empty icon="cube" title="Nothing installed yet" text="Find mods, resource packs and shaders on Modrinth.">
          <button className="btn primary" onClick={onBrowse}>
            <Icon name="search" size={15} /> Discover
          </button>
        </Empty>
      ) : (
        <div className="list">
          {shown.map((m) => {
            const u = updates[m.file];
            return (
              <div key={m.file} className={"item glass" + (m.enabled ? "" : " off")}>
                {m.icon ? <img className="item-icon" src={m.icon} alt="" /> : <div className="item-icon none"><Icon name="cube" /></div>}
                <div className="item-text">
                  <div className="item-title">
                    <b>{m.name}</b>
                    {m.version && <span className="muted small">{m.version}</span>}
                    {u && <span className="tag accent">→ {u.version}</span>}
                  </div>
                  <p>{m.description || m.file}</p>
                  <span className="muted small">
                    {m.authors && <>by {m.authors} · </>}
                    {fmtBytes(m.size)}
                  </span>
                </div>
                <div className="item-actions">
                  {u && (
                    <button className="btn small primary" disabled={busy === m.file} onClick={() => updateOne(u)}>
                      {busy === m.file ? <Spinner size={12} /> : <Icon name="download" size={14} />} Update
                    </button>
                  )}
                  <Switch
                    on={m.enabled}
                    onChange={() =>
                      api
                        .modToggle(kind, m.file)
                        .then(load)
                        .catch((e) => toast(msg(e), "error"))
                    }
                  />
                  <button
                    className="icon-btn danger"
                    title="Delete"
                    onClick={() =>
                      api
                        .modDelete(kind, m.file)
                        .then(() => {
                          toast("Deleted " + m.name);
                          load();
                        })
                        .catch((e) => toast(msg(e), "error"))
                    }
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Browse({ kind, onModpack }: { kind: Kind; onModpack?: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Record<string, "busy" | "done">>({});
  const seq = useRef(0);

  const run = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const r = await api.search(query, kind, query && sort === "relevance" ? "relevance" : sort === "relevance" ? "downloads" : sort, offset);
        if (my !== seq.current) return;
        setHits(offset === 0 ? r.hits : (h) => [...h, ...r.hits]);
        setTotal(r.total);
        setError(null);
      } catch (e) {
        if (my === seq.current) setError(msg(e));
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [query, kind, sort],
  );

  useEffect(() => {
    const t = setTimeout(() => run(0), 300);
    return () => clearTimeout(t);
  }, [run]);

  const [packStage, setPackStage] = useState<string>("");
  useEffect(() => {
    if (kind !== "modpack") return;
    const un = on.modpackProgress((p) =>
      setPackStage(p.total > 0 ? `${p.stage} ${Math.round((p.done / p.total) * 100)}%` : p.stage),
    );
    return () => {
      un.then((f) => f());
    };
  }, [kind]);

  async function install(h: Hit) {
    setInstalling((s) => ({ ...s, [h.id]: "busy" }));
    if (kind === "modpack") {
      try {
        const id = await api.modpackInstall(h.id, h.title, h.icon);
        setInstalling((s) => ({ ...s, [h.id]: "done" }));
        toast(h.title + " is installed as a new profile", "ok");
        onModpack?.(id);
      } catch (e) {
        setInstalling((s) => {
          const n = { ...s };
          delete n[h.id];
          return n;
        });
        toast(msg(e), "error");
      } finally {
        setPackStage("");
      }
      return;
    }
    try {
      const files = await api.install(h.id, kind);
      setInstalling((s) => ({ ...s, [h.id]: "done" }));
      toast(files.length > 1 ? `Installed ${h.title} + ${files.length - 1} needed mod${files.length > 2 ? "s" : ""}` : "Installed " + h.title, "ok");
    } catch (e) {
      setInstalling((s) => {
        const n = { ...s };
        delete n[h.id];
        return n;
      });
      toast(msg(e), "error");
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input autoFocus placeholder={`Search Modrinth`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {loading && <Spinner size={13} />}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="hint error">{error}</p>}
      <div className="grid">
        {hits.map((h) => {
          const st = installing[h.id];
          return (
            <div key={h.id} className="card glass">
              <div className="card-head">
                {h.icon ? <img className="item-icon" src={h.icon} alt="" /> : <div className="item-icon none"><Icon name="cube" /></div>}
                <div>
                  <b className="link" onClick={() => openUrl(`https://modrinth.com/${kind === "resourcepack" ? "resourcepack" : kind}/${h.slug}`)}>
                    {h.title}
                  </b>
                  <span className="muted small">by {h.author}</span>
                </div>
              </div>
              <p>{h.description}</p>
              <div className="card-foot">
                <span className="muted small">
                  <Icon name="download" size={12} /> {fmtNum(h.downloads)}
                </span>
                <button className={"btn small" + (st === "done" ? "" : " primary")} disabled={!!st} onClick={() => install(h)}>
                  {st === "busy" ? <Spinner size={12} /> : st === "done" ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}
                  {st === "done" ? "Installed" : st === "busy" && kind === "modpack" ? packStage || "Installing…" : "Install"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!loading && hits.length === 0 && !error && <Empty icon="search" title="Nothing found" text="Try another search." />}
      {hits.length < total && hits.length > 0 && (
        <div className="center pad">
          <button className="btn" disabled={loading} onClick={() => run(hits.length)}>
            {loading ? <Spinner size={13} /> : null} Load more
          </button>
        </div>
      )}
    </>
  );
}
