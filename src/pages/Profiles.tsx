import { getLang } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import PlayTime from "../components/PlayTime";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ago, api, fmtTime, Info, msg, PinnedServer, Profile } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import ImportDialog from "../components/ImportDialog";
import Optimise from "../components/Optimise";
import ProfileIcon, { iconUrl } from "../components/ProfileIcon";
import logoUrl from "../assets/logo.png";
import { Modal, Spinner, Switch } from "../components/Ui";
import { ImportBlock } from "./Settings";

// Versions a profile can use. 1.21.11 runs Com Client on Fabric; 1.8.9 runs Legacy Fabric (Com Client for 1.8.9 is
// on its way: until its release is out, a 1.8.9 profile starts with just Legacy Fabric and the mods you add).
const VERSIONS = [
  { id: "1.21.11", ready: true, note: "Com Client", icon: "item:mace", blurb: "The full client: modules, cosmetics, emotes, knives. Newest Minecraft with Fabric." },
  { id: "1.8.9", ready: true, note: "Legacy Fabric · PvP", icon: "item:diamond_sword", blurb: "Classic 1.8 PvP: old combat, no attack cooldown. Com Client on Legacy Fabric." },
];

const POPULAR = [
  "block:grass_block", "item:diamond_sword", "item:netherite_sword", "item:mace", "item:totem_of_undying", "item:ender_pearl",
  "item:end_crystal", "item:golden_apple", "item:enchanted_golden_apple", "item:bow", "item:crossbow", "item:trident",
  "item:diamond_pickaxe", "item:elytra", "item:firework_rocket", "item:nether_star", "item:compass_00", "item:clock_00",
  "block:diamond_block", "block:emerald_block", "block:netherite_block", "block:tnt_side", "block:obsidian", "block:crying_obsidian",
  "block:respawn_anchor_side4", "block:beacon", "block:crafting_table_front", "block:oak_log", "block:cherry_leaves", "block:amethyst_block",
  "block:sculk", "block:end_stone", "block:purpur_block", "block:netherrack", "block:glowstone", "block:sea_lantern",
];

export default function Profiles({
  info,
  reload,
  running,
  onPlay,
  onMods,
}: {
  info: Info;
  reload: () => void;
  running: boolean;
  onPlay: (server?: string) => void;
  /** Open Mods & Packs for this profile (it becomes the selected one): the search only shows its version's mods. */
  onMods?: (profileId?: string) => void;
}) {
  const [editId, setEditId] = useState(info.settings.active_profile);
  const profile = info.profiles.find((p) => p.id === editId) ?? info.profiles[0];
  const [p, setP] = useState<Profile>(profile);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [picker, setPicker] = useState(false);
  const [optimise, setOptimise] = useState(false);
  const [busy, setBusy] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  async function rename(x: Profile, name: string) {
    setRenaming(null);
    const n = name.trim();
    if (!n || n === x.name) return;
    if (x.id === p.id) {
      setP({ ...p, name: n });
      return;
    }
    try {
      await api.saveProfile({ ...x, name: n });
      reload();
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  useEffect(() => setP(profile), [profile.id]);
  // play time etc. changes underneath us (the launcher writes it): keep those fields fresh
  useEffect(() => setP((cur) => ({ ...cur, playtime_secs: profile.playtime_secs, sessions: profile.sessions, last_played: profile.last_played })), [
    profile.playtime_secs,
    profile.last_played,
  ]);

  const dirty = JSON.stringify(p) !== JSON.stringify(profile);
  async function saveProfile(next = p) {
    setSaved("saving");
    try {
      await api.saveProfile(next);
      reload();
      setSaved("saved");
    } catch (e) {
      setSaved("idle");
      toast(msg(e), "error");
    }
  }
  useEffect(() => {
    if (!dirty || !p.name.trim()) return;
    const t = setTimeout(() => saveProfile(), 600);
    return () => clearTimeout(t);
  }, [p]);

  const total = info.profiles.reduce((n, x) => n + (x.playtime_secs || 0), 0);
  const sessions = info.profiles.reduce((n, x) => n + (x.sessions?.length || 0), 0);
  const maxRam = Math.max(2048, Math.floor(info.total_ram / 512) * 512 - 1024);
  const selected = p.id === info.settings.active_profile;

  async function select(id: string) {
    await api.saveSettings({ ...info.settings, active_profile: id });
    reload();
  }

  const [creating, setCreating] = useState(false);
  async function create(version: string) {
    setCreating(false);
    try {
      const list = await api.saveProfile({
        ...info.profiles[0],
        id: "",
        name: "Profile " + (info.profiles.length + 1),
        game_dir: "",
        icon: POPULAR[(info.profiles.length * 7) % POPULAR.length],
        servers: [],
        playtime_secs: 0,
        sessions: [],
        last_played: 0,
        java_args: "",
        version,
      });
      reload();
      setEditId(list[list.length - 1].id);
      // straight into naming it
      setTimeout(() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }, 120);
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  async function act(kind: string, f: () => Promise<void>) {
    setBusy(kind);
    try {
      await f();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy("");
    }
  }

  const [importing, setImporting] = useState(false);

  return (
    <div className="page profiles-page">
      {creating && (
        <Modal title="New profile: pick a version" onClose={() => setCreating(false)} width={520}>
          <div className="vpick">
            {VERSIONS.map((v) => (
              <button key={v.id} className="vpick-card" disabled={!v.ready} onClick={() => create(v.id)}>
                <ProfileIcon icon={v.icon} size={44} />
                <div className="vpick-text">
                  <b>Minecraft {v.id}</b>
                  <span className="vpick-tag">{v.note}</span>
                  <small className="muted">{v.blurb}</small>
                </div>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
          <p className="muted small">You can change the version later in the profile's settings.</p>
        </Modal>
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={(id) => {
            setImporting(false);
            reload();
            setEditId(id);
            toast("Imported as a new profile", "ok");
          }}
        />
      )}
      <div className="page-head">
        <div>
          <h1>Profiles</h1>
          <p className="muted">Each profile has its own name, icon, worlds, mods, options and servers.</p>
        </div>
        <div className="row-gap">
          <button className="btn" disabled={!!busy} onClick={() => setImporting(true)}>
            <Icon name="download" size={14} /> Import
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New profile
          </button>
        </div>
      </div>

      <div className="pstats">
        <div>
          <small>Total play time</small>
          <b>{fmtTime(total)}</b>
        </div>
        <div>
          <small>Sessions</small>
          <b>{sessions}</b>
        </div>
        <div>
          <small>Profiles</small>
          <b>{info.profiles.length}</b>
        </div>
        <div>
          <small>Most played</small>
          <b>{[...info.profiles].sort((a, b) => (b.playtime_secs || 0) - (a.playtime_secs || 0))[0]?.name ?? "–"}</b>
        </div>
      </div>

      <PlayTime profiles={info.profiles} version={total} />

      <div className="profiles-split">
        <div className="pcards">
          {info.profiles.map((x) => (
            <div key={x.id} className={"pcard" + (x.id === p.id ? " editing" : "")} onClick={() => setEditId(x.id)}>
              <ProfileIcon icon={x.icon} size={42} />
              <div className="pcard-text">
                {renaming === x.id ? (
                  <input
                    className="pcard-rename"
                    autoFocus
                    value={renameText}
                    maxLength={32}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(x, renameText);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => rename(x, renameText)}
                  />
                ) : (
                  <b
                    title="Double-click to rename"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenameText(x.id === p.id ? p.name : x.name);
                      setRenaming(x.id);
                    }}
                  >
                    {x.id === p.id ? p.name || x.name : x.name}
                    {x.id === info.settings.active_profile && <em>Selected</em>}
                  </b>
                )}
                <span>
                  {x.version || info.mc_version} · {fmtTime(x.playtime_secs || 0)} · {x.last_played ? ago(x.last_played) : "never played"}
                </span>
              </div>
              {onMods && (
                <button
                  className="pcard-mods"
                  title={running ? "Close the game first" : `Mods for ${x.name} (Minecraft ${x.version || info.mc_version})`}
                  disabled={running}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMods(x.id);
                  }}
                >
                  <Icon name="cube" size={13} /> Mods
                </button>
              )}
              <Icon name="chevron" size={14} />
            </div>
          ))}
        </div>

        <div className="peditor">
          <section className="settings-block glass">
            <div className="phead">
              <button className="picon-btn" onClick={() => setPicker(true)} title="Change icon">
                <ProfileIcon icon={p.icon} size={64} />
                <span className="badge">
                  <Icon name="edit" size={12} />
                </span>
              </button>
              <div className="phead-fields">
                <label className="pname-wrap" title="Click to rename">
                  <input
                    ref={nameRef}
                    className="pname"
                    value={p.name}
                    maxLength={32}
                    placeholder="Profile name"
                    onChange={(e) => setP({ ...p, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    onBlur={() => !p.name.trim() && setP({ ...p, name: profile.name })}
                  />
                  <Icon name="edit" size={15} />
                </label>
                <div className="row-gap">
                  <select value={p.version || VERSIONS[0].id} onChange={(e) => setP({ ...p, version: e.target.value })}>
                    {VERSIONS.map((v) => (
                      <option key={v.id} value={v.id} disabled={!v.ready}>
                        Minecraft {v.id} · {v.note}
                      </option>
                    ))}
                  </select>
                  <span className={"autosave " + saved}>
                    {dirty || saved === "saving" ? (
                      <>
                        <Spinner size={11} /> Saving…
                      </>
                    ) : saved === "saved" ? (
                      <>
                        <Icon name="check" size={12} /> Saved
                      </>
                    ) : (
                      "Saves automatically"
                    )}
                  </span>
                </div>
              </div>
              <div className="phead-actions">
                {selected ? (
                  <button className="btn primary" disabled={running} onClick={() => onPlay()}>
                    <Icon name="play" size={14} fill /> Play
                  </button>
                ) : (
                  <button className="btn primary" disabled={running} onClick={() => select(p.id)}>
                    <Icon name="check" size={14} /> Use this profile
                  </button>
                )}
              </div>
            </div>
            <div className="pversion">
              <Icon name="cube" size={15} />
              <span>
                <b>Minecraft {p.version || VERSIONS[0].id}</b>
                {(p.version || VERSIONS[0].id) === "1.8.9"
                  ? " · Legacy Fabric. Only mods made for 1.8.9 show up in this profile's mod search."
                  : " · Fabric with Com Client. Only mods made for this version show up in this profile's mod search."}
              </span>
              {onMods && (
                <button className="btn small" disabled={running} onClick={() => onMods(p.id)}>
                  <Icon name="search" size={13} /> Mods for {p.version || VERSIONS[0].id}
                </button>
              )}
            </div>
            <div className="pactions">
              <button className="btn small" disabled={!!busy} onClick={() => act("dup", async () => {
                const list = await api.profileDuplicate(p.id);
                reload();
                setEditId(list[list.length - 1].id);
                toast("Profile duplicated", "ok");
              })}>
                {busy === "dup" ? <Spinner size={12} /> : <Icon name="copy" size={14} />} Duplicate
              </button>
              <button className="btn small" disabled={!!busy} onClick={() => act("export", async () => {
                const dest = await save({
                  title: "Export profile",
                  defaultPath: p.name.replace(/[^\w\- ]+/g, "").trim() + ".ccprofile",
                  filters: [{ name: "Com Client profile", extensions: ["ccprofile"] }],
                });
                if (!dest) return;
                await api.profileExport(p.id, dest);
                toast("Exported (settings, mods, packs and servers; no worlds)", "ok");
              })}>
                {busy === "export" ? <Spinner size={12} /> : <Icon name="external" size={14} />} Export
              </button>
              <button
                className="btn small"
                onClick={() => {
                  nameRef.current?.focus();
                  nameRef.current?.select();
                }}
              >
                <Icon name="edit" size={14} /> Rename
              </button>
              <button className="btn small" onClick={() => api.openFolder("profile:" + p.id)}>
                <Icon name="folder" size={14} /> Folder
              </button>
              <button
                className="btn small"
                disabled={!!busy}
                title="Puts an icon on your desktop that starts this profile straight away"
                onClick={() => act("shortcut", async () => {
                  const png = await iconPng(p.icon).catch(() => undefined);
                  await api.createShortcut(p.id, png);
                  toast(`"${p.name}" is on your desktop now: double-click it to play`, "ok");
                })}
              >
                {busy === "shortcut" ? <Spinner size={12} /> : <Icon name="link" size={14} />} Desktop shortcut
              </button>
              <button className="btn small" disabled={running} onClick={() => setOptimise(true)} title="Checks your PC and picks memory, performance mods and video settings">
                <Icon name="bolt" size={14} /> Auto-optimise
              </button>
              <span className="grow" />
              {info.profiles.length > 1 && (
                <button
                  className="btn small ghost danger"
                  disabled={running}
                  onClick={() =>
                    act("del", async () => {
                      await api.deleteProfile(p.id);
                      reload();
                      setEditId(info.profiles.find((x) => x.id !== p.id)!.id);
                      toast("Profile deleted (its folder was kept)");
                    })
                  }
                >
                  <Icon name="trash" size={14} /> Delete
                </button>
              )}
            </div>
          </section>

          <Servers p={p} setP={setP} onJoin={selected && !running ? (a) => onPlay(a) : undefined} />

          <section className="settings-block glass">
            <div className="block-head">
              <h2>
                <Icon name="clock" size={17} /> Play time
              </h2>
            </div>
            <div className="pstats small">
              <div>
                <small>Total</small>
                <b>{fmtTime(p.playtime_secs || 0)}</b>
              </div>
              <div>
                <small>Sessions</small>
                <b>{p.sessions?.length ?? 0}</b>
              </div>
              <div>
                <small>Average</small>
                <b>{p.sessions?.length ? fmtTime(p.sessions.reduce((n, s) => n + s.secs, 0) / p.sessions.length) : "–"}</b>
              </div>
              <div>
                <small>Last played</small>
                <b>{p.last_played ? ago(p.last_played) : "never"}</b>
              </div>
            </div>
            {p.sessions?.length ? (
              <>
                <Bars sessions={p.sessions} />
                <div className="sessions">
                  {p.sessions.slice(0, 6).map((s, i) => (
                    <div key={i}>
                      <span>{new Date(s.start * 1000).toLocaleString(getLang(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="muted">{s.server || "Singleplayer / menu"}</span>
                      <b>{fmtTime(s.secs)}</b>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted small">Play once and your sessions show up here.</p>
            )}
          </section>

          <section className="settings-block glass">
            <div className="block-head">
              <h2>
                <Icon name="memory" size={17} /> Game
              </h2>
            </div>
            <div className="field">
              <label>
                Memory <span className="accent">{(p.ram_mb / 1024).toFixed(1)} GB</span>
              </label>
              <input type="range" min={1024} max={maxRam} step={256} value={Math.min(p.ram_mb, maxRam)} onChange={(e) => setP({ ...p, ram_mb: Number(e.target.value) })} />
              <span className="muted small">Your PC has {(info.total_ram / 1024).toFixed(1)} GB. 3–6 GB is plenty for Com Client; more can make it slower.</span>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Window size</label>
                <div className="row-gap">
                  <input type="number" value={p.width} min={640} max={7680} disabled={p.fullscreen} onChange={(e) => setP({ ...p, width: Number(e.target.value) })} />
                  <span className="muted">×</span>
                  <input type="number" value={p.height} min={360} max={4320} disabled={p.fullscreen} onChange={(e) => setP({ ...p, height: Number(e.target.value) })} />
                </div>
              </div>
              <div className="field toggle-field">
                <label>Fullscreen</label>
                <Switch on={p.fullscreen} onChange={(v) => setP({ ...p, fullscreen: v })} />
              </div>
            </div>
            <div className="field">
              <label>Game folder</label>
              <div className="row-gap">
                <input value={p.game_dir} placeholder="Launcher folder (recommended)" onChange={(e) => setP({ ...p, game_dir: e.target.value })} />
                <button
                  className="btn small"
                  onClick={async () => {
                    const dir = await open({ directory: true, title: "Choose the game folder" });
                    if (typeof dir === "string") setP({ ...p, game_dir: dir });
                  }}
                >
                  <Icon name="folder" size={14} /> Choose
                </button>
              </div>
            </div>
            <div className="setting">
              <div>
                <b>Performance mods</b>
                <span>Sodium, Lithium, FerriteCore and EntityCulling for a lot more FPS. Hidden from your mods folder.</span>
              </div>
              <Switch on={p.performance_mods !== false} onChange={(v) => setP({ ...p, performance_mods: v })} />
            </div>
            <div className="setting">
              <div>
                <b>ReplayMod</b>
                <span>Record your games and watch them back from any angle.</span>
              </div>
              <Switch on={!!p.replay_mod} onChange={(v) => setP({ ...p, replay_mod: v })} />
            </div>
            <div className="field">
              <label>Java arguments</label>
              <input value={p.java_args} placeholder="e.g. -XX:+UseZGC (optional)" onChange={(e) => setP({ ...p, java_args: e.target.value })} />
            </div>
          </section>

          <ImportBlock profileId={p.id} profileName={p.name} running={running} />
        </div>
      </div>

      {optimise && (
        <Optimise
          profile={p}
          onClose={() => setOptimise(false)}
          onDone={(list) => {
            const u = list.find((x) => x.id === p.id);
            if (u) setP(u);
            reload();
          }}
        />
      )}
      {picker && (
        <IconPicker
          current={p.icon}
          onPick={(icon) => {
            const next = { ...p, icon };
            setP(next);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pinned servers

function Servers({ p, setP, onJoin }: { p: Profile; setP: (p: Profile) => void; onJoin?: (address: string) => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const servers = p.servers ?? [];
  function add() {
    const a = address.trim();
    if (!a) return;
    const s: PinnedServer = { name: name.trim() || a, address: a };
    setP({ ...p, servers: [...servers.filter((x) => x.address !== a), s].slice(0, 8) });
    setName("");
    setAddress("");
  }
  return (
    <section className="settings-block glass">
      <div className="block-head">
        <h2>
          <Icon name="globe" size={17} /> Quick join
        </h2>
        <span className="muted small">Pinned servers show up next to PLAY. One click starts the game and joins.</span>
      </div>
      <div className="pservers">
        {servers.map((s, i) => (
          <div key={s.address} className="pserver">
            <ServerIcon address={s.address} />
            <div>
              <b>{s.name}</b>
              <span className="mono">{s.address}</span>
            </div>
            <span className="grow" />
            {i > 0 && (
              <button className="icon-btn" title="Move up" onClick={() => {
                const next = [...servers];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setP({ ...p, servers: next });
              }}>
                <Icon name="chevronDown" size={14} className="flip" />
              </button>
            )}
            {onJoin && (
              <button className="btn small" onClick={() => onJoin(s.address)}>
                <Icon name="play" size={12} fill /> Join
              </button>
            )}
            <button className="icon-btn" title="Unpin" onClick={() => setP({ ...p, servers: servers.filter((x) => x.address !== s.address) })}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
        <div className="pserver add">
          <input value={name} placeholder="Name (optional)" maxLength={24} onChange={(e) => setName(e.target.value)} />
          <input value={address} placeholder="play.example.net" onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn small" disabled={!address.trim() || servers.length >= 8} onClick={add}>
            <Icon name="plus" size={14} /> Pin
          </button>
        </div>
      </div>
    </section>
  );
}

export function ServerIcon({ address, size = 30 }: { address: string; size?: number }) {
  const [ok, setOk] = useState(true);
  const host = address.trim().toLowerCase();
  return (
    <span className="srv-icon" style={{ width: size, height: size }}>
      {ok ? <img src={`https://api.mcsrvstat.us/icon/${encodeURIComponent(host)}`} alt="" onError={() => setOk(false)} /> : <b>{host.slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}

// ---------------------------------------------------------------- last 14 days

function Bars({ sessions }: { sessions: { start: number; secs: number }[] }) {
  const days = useMemo(() => {
    const out: { label: string; secs: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400_000);
      const from = d.getTime() / 1000;
      const secs = sessions.filter((s) => s.start >= from && s.start < from + 86400).reduce((n, s) => n + s.secs, 0);
      out.push({ label: d.toLocaleDateString(getLang(), { weekday: "narrow" }), secs });
    }
    return out;
  }, [sessions]);
  const max = Math.max(1, ...days.map((d) => d.secs));
  return (
    <div className="pbars" title="Last 14 days">
      {days.map((d, i) => (
        <div key={i} title={fmtTime(d.secs)}>
          <i style={{ height: Math.max(3, (d.secs / max) * 100) + "%" }} className={d.secs ? "" : "zero"} />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- icon picker

function IconTile({ name, on, onPick }: { name: string; on: boolean; onPick: () => void }) {
  const [url, setUrl] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        io.disconnect();
        iconUrl(name).then((u) => live && setUrl(u));
      }
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [name]);
  return (
    <button ref={ref} className={"icon-tile" + (on ? " on" : "")} title={name.split(":")[1].replace(/_/g, " ")} onClick={onPick}>
      {url && <i style={{ backgroundImage: `url(${url})` }} />}
    </button>
  );
}

function IconPicker({ current, onPick, onClose }: { current: string; onPick: (icon: string) => void; onClose: () => void }) {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "item" | "block">("all");
  const [limit, setLimit] = useState(240);

  useEffect(() => {
    api
      .iconNames()
      .then(setNames)
      .catch((e) => setError(msg(e)));
  }, []);

  const list = useMemo(() => {
    if (!names) return [];
    const words = q.toLowerCase().trim().replace(/\s+/g, "_");
    const filtered = names.filter((n) => (kind === "all" || n.startsWith(kind + ":")) && (!words || n.includes(words)));
    if (!words && kind === "all") {
      const set = new Set(names);
      const top = POPULAR.filter((n) => set.has(n));
      return [...top, ...filtered.filter((n) => !top.includes(n))];
    }
    return filtered;
  }, [names, q, kind]);

  async function upload() {
    const f = await open({ title: "Pick a picture", filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
    if (typeof f !== "string") return;
    try {
      onPick(await api.iconUpload(f));
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  return (
    <Modal title="Profile icon" onClose={onClose} width={640}>
      <div className="picker-top">
        <div className="search">
          <Icon name="search" size={14} />
          <input autoFocus value={q} placeholder="Search blocks and items…" onChange={(e) => { setQ(e.target.value); setLimit(240); }} />
        </div>
        <div className="seg">
          {(["all", "item", "block"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setLimit(240); }}>
              {k === "all" ? "All" : k === "item" ? "Items" : "Blocks"}
            </button>
          ))}
        </div>
        <button className="btn small" onClick={upload}>
          <Icon name="image" size={14} /> Upload
        </button>
      </div>
      {error ? (
        <p className="muted">Couldn't load Minecraft's textures: {error}. You can still upload your own picture.</p>
      ) : !names ? (
        <div className="center picker-wait">
          <Spinner /> <span className="muted">Getting Minecraft's textures (only the first time)…</span>
        </div>
      ) : (
        <div
          className="icon-grid"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) setLimit((l) => l + 240);
          }}
        >
          {list.slice(0, limit).map((n) => (
            <IconTile key={n} name={n} on={n === current} onPick={() => onPick(n)} />
          ))}
          {list.length === 0 && <p className="muted">Nothing called “{q}”.</p>}
        </div>
      )}
      <div className="block-foot">
        <button className="btn ghost" onClick={() => onPick("")}>
          Use the Com Client logo
        </button>
        <span className="grow" />
        <span className="muted small">{names ? list.length + " icons" : ""}</span>
      </div>
    </Modal>
  );
}

/** The profile's picture as a 256x256 PNG (for the desktop shortcut's icon): Minecraft items stay sharp. */
async function iconPng(icon: string): Promise<string> {
  const url = (await iconUrl(icon || "")) || logoUrl;
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const pixel = icon.startsWith("item:") || icon.startsWith("block:");
  g.imageSmoothingEnabled = !pixel;
  const s = Math.min(256 / img.width, 256 / img.height);
  const w = img.width * s, h = img.height * s;
  g.drawImage(img, (256 - w) / 2, (256 - h) / 2, w, h);
  return c.toDataURL("image/png");
}
