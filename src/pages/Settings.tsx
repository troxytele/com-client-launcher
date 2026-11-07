import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, Info, msg, Profile, Settings as S } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import { Modal, Spinner, Switch } from "../components/Ui";
import { getLook, Look, onLook, setLook, THEMES } from "../theme";
import { ImportSource, ago } from "../api";

export default function Settings({ info, reload, running }: { info: Info; reload: () => void; running: boolean }) {
  const [profileId, setProfileId] = useState(info.settings.active_profile);
  const profile = info.profiles.find((p) => p.id === profileId) ?? info.profiles[0];
  const [p, setP] = useState<Profile>(profile);
  const [s, setS] = useState<S>(info.settings);
  const [newOpen, setNewOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [look, setLookState] = useState<Look>(getLook());
  useEffect(() => onLook(setLookState), []);

  useEffect(() => setP(profile), [profile.id]);
  useEffect(() => setS(info.settings), [info.settings]);

  const dirty = JSON.stringify(p) !== JSON.stringify(profile);

  async function saveProfile() {
    try {
      await api.saveProfile(p);
      reload();
      toast("Profile saved", "ok");
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  async function setSetting(next: S) {
    setS(next);
    try {
      await api.saveSettings(next);
      reload();
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  const maxRam = Math.max(2048, Math.floor(info.total_ram / 512) * 512 - 1024);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Profiles keep their own worlds, mods and options.</p>
        </div>
      </div>

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="sparkle" size={17} /> Appearance
          </h2>
        </div>
        <div className="themes">
          {THEMES.map((t) => (
            <button key={t.id} className={"theme-swatch" + (look.theme === t.id ? " on" : "")} onClick={() => setLook({ ...look, theme: t.id })}>
              <i style={{ background: `linear-gradient(135deg, ${t.hi}, ${t.accent} 55%, ${t.accent2})` }}>
                {look.theme === t.id && <Icon name="check" size={16} />}
              </i>
              {t.name}
            </button>
          ))}
        </div>
        <div className="setting">
          <div>
            <b>Moving background</b>
            <span>Specks of light drifting slowly behind everything. Turn off for a still background.</span>
          </div>
          <Switch on={look.stars} onChange={(v) => setLook({ ...look, stars: v })} />
        </div>
      </section>

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="cube" size={17} /> Profile
          </h2>
          <div className="row-gap">
            <select value={profile.id} onChange={(e) => setProfileId(e.target.value)}>
              {info.profiles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.id === info.settings.active_profile ? " (selected)" : ""}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={14} /> New
            </button>
          </div>
        </div>

        <div className="field">
          <label>Name</label>
          <input value={p.name} maxLength={32} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </div>

        <div className="field">
          <label>
            Memory <span className="accent">{(p.ram_mb / 1024).toFixed(1)} GB</span>
          </label>
          <input
            type="range"
            min={1024}
            max={maxRam}
            step={256}
            value={Math.min(p.ram_mb, maxRam)}
            onChange={(e) => setP({ ...p, ram_mb: Number(e.target.value) })}
          />
          <span className="muted small">
            Your PC has {(info.total_ram / 1024).toFixed(1)} GB. 3–6 GB is plenty for Com Client; more can make it slower.
          </span>
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
          <span className="muted small">Leave empty to keep this profile separate from your normal .minecraft.</span>
        </div>

        <div className="setting">
          <div>
            <b>ReplayMod</b>
            <span>Record your games and watch them back from any angle. Installed and updated for you, hidden from your mods folder.</span>
          </div>
          <Switch on={!!p.replay_mod} onChange={(v) => setP({ ...p, replay_mod: v })} />
        </div>

        <div className="field">
          <label>Java arguments</label>
          <input value={p.java_args} placeholder="e.g. -XX:+UseZGC (optional)" onChange={(e) => setP({ ...p, java_args: e.target.value })} />
        </div>

        <div className="block-foot">
          {info.profiles.length > 1 && (
            <button
              className="btn ghost danger"
              disabled={running}
              onClick={() =>
                api
                  .deleteProfile(profile.id)
                  .then(() => {
                    reload();
                    setProfileId(info.profiles.find((x) => x.id !== profile.id)!.id);
                    toast("Profile deleted (its folder was kept)");
                  })
                  .catch((e) => toast(msg(e), "error"))
              }
            >
              <Icon name="trash" size={14} /> Delete profile
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={() => api.openFolder("game")}>
            <Icon name="folder" size={14} /> Open game folder
          </button>
          <button className="btn primary" disabled={!dirty} onClick={saveProfile}>
            <Icon name="check" size={14} /> Save
          </button>
        </div>
      </section>

      <ImportBlock profileId={p.id} profileName={p.name} running={running} />

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="gear" size={17} /> Launcher
          </h2>
        </div>
        <div className="setting">
          <div>
            <b>When the game starts</b>
            <span>What the launcher does while you play</span>
          </div>
          <select value={s.after_launch} onChange={(e) => setSetting({ ...s, after_launch: e.target.value as S["after_launch"] })}>
            <option value="hide">Hide, come back after</option>
            <option value="keep">Stay open</option>
            <option value="close">Close</option>
          </select>
        </div>
        <div className="setting">
          <div>
            <b>Discord Rich Presence</b>
            <span>Shows "In the launcher" on your Discord profile while the launcher is open</span>
          </div>
          <Switch on={s.discord_rpc} onChange={(v) => setSetting({ ...s, discord_rpc: v })} />
        </div>
        <div className="setting">
          <div>
            <b>Repair game files</b>
            <span>Checks every file and downloads broken ones again the next time you play</span>
          </div>
          <button
            className="btn small"
            disabled={repairing || running}
            onClick={async () => {
              setRepairing(true);
              try {
                const n = await api.repair();
                toast(n ? `Removed ${n} broken files. They download again when you play.` : "Everything looks fine", "ok");
              } catch (e) {
                toast(msg(e), "error");
              } finally {
                setRepairing(false);
              }
            }}
          >
            {repairing ? <Spinner size={12} /> : <Icon name="wrench" size={14} />} Repair
          </button>
        </div>
        <div className="setting">
          <div>
            <b>Launcher updates</b>
            <span>Version {info.version}. The launcher updates itself when it starts.</span>
          </div>
          <button
            className="btn small"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                const u = await check();
                if (!u) toast("You have the newest launcher", "ok");
                else {
                  toast("Downloading " + u.version + "…");
                  await u.downloadAndInstall();
                  await relaunch();
                }
              } catch (e) {
                toast("Couldn't check for updates: " + msg(e), "error");
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? <Spinner size={12} /> : <Icon name="refresh" size={14} />} Check now
          </button>
        </div>
        <div className="setting">
          <div>
            <b>Launcher folder</b>
            <span className="mono">{info.data_dir}</span>
          </div>
          <button className="btn small" onClick={() => api.openFolder("launcher")}>
            <Icon name="folder" size={14} /> Open
          </button>
        </div>
      </section>

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="wrench" size={17} /> Developer
          </h2>
        </div>
        <div className="field">
          <label>Test jar</label>
          <div className="row-gap">
            <input
              value={s.custom_client_jar}
              placeholder={info.client_repo_set ? "Empty = newest Com Client release from GitHub" : "Pick your built com-client jar (build/libs)"}
              onChange={(e) => setS({ ...s, custom_client_jar: e.target.value })}
              onBlur={() => setSetting(s)}
            />
            <button
              className="btn small"
              onClick={async () => {
                const f = await open({ title: "Choose the Com Client jar", filters: [{ name: "Mod jar", extensions: ["jar"] }] });
                if (typeof f === "string") setSetting({ ...s, custom_client_jar: f });
              }}
            >
              <Icon name="folder" size={14} /> Choose
            </button>
            {s.custom_client_jar && (
              <button className="icon-btn" title="Clear" onClick={() => setSetting({ ...s, custom_client_jar: "" })}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          <span className="muted small">Starts this jar instead of the published release. Handy to try a new build.</span>
        </div>
        <div className="about muted small">
          Installed: Com Client {info.client.client_version || "–"} · Fabric API {info.client.fabric_api_version || "–"} · Minecraft {info.mc_version}
        </div>
      </section>

      {newOpen && <NewProfile onClose={() => setNewOpen(false)} onCreated={(id) => (reload(), setProfileId(id))} />}
    </div>
  );
}

function NewProfile({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal title="New profile" onClose={onClose} width={380}>
      <p className="muted small">A profile has its own worlds, mods, resource packs and options.</p>
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} maxLength={32} placeholder="e.g. PvP" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="block-foot">
        <span className="grow" />
        <button
          className="btn primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const list = await api.saveProfile({
                id: "",
                name: name.trim(),
                game_dir: "",
                ram_mb: 4096,
                java_args: "",
                width: 1280,
                height: 720,
                fullscreen: false,
                created: 0,
                last_played: 0,
                replay_mod: false,
              });
              const created = list[list.length - 1];
              onCreated(created.id);
              onClose();
            } catch (e) {
              toast(msg(e), "error");
            }
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}

// Import settings (options.txt: video, sensitivity, keybinds) and the server list from another launcher. Never mods.
function ImportBlock({ profileId, profileName, running }: { profileId: string; profileName: string; running: boolean }) {
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [what, setWhat] = useState({ settings: true, keybinds: true, servers: true });
  const [busy, setBusy] = useState(false);

  async function scan() {
    setScanning(true);
    try {
      const list = await api.importScan();
      setSources(list);
      setPick(list[0]?.dir ?? "");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setScanning(false);
    }
  }

  async function run() {
    setBusy(true);
    try {
      toast(await api.importApply(pick, profileId, what.settings, what.keybinds, what.servers), "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const chosen = sources?.find((x) => x.dir === pick);
  return (
    <section className="settings-block glass">
      <div className="block-head">
        <h2>
          <Icon name="download" size={17} /> Import from another launcher
        </h2>
        <button className="btn small" onClick={scan} disabled={scanning}>
          {scanning ? <Spinner size={13} /> : <Icon name="search" size={14} />} {sources ? "Scan again" : "Find my launchers"}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>
        Copies your settings (render distance, mouse sensitivity, FOV, sounds …), keybinds and server list from Minecraft Launcher, Lunar,
        Modrinth, NoRisk, Prism, CurseForge and others into <b>{profileName}</b>. Mods are never copied.
      </p>
      {sources && sources.length === 0 && <p className="muted small">No other Minecraft installs found on this PC.</p>}
      {sources && sources.length > 0 && (
        <>
          <div className="import-list">
            {sources.map((x) => (
              <button key={x.dir} className={"import-row" + (x.dir === pick ? " on" : "")} onClick={() => setPick(x.dir)}>
                <span className="radio">{x.dir === pick && <i />}</span>
                <span className="import-text">
                  <b>
                    {x.launcher}
                    {x.name && x.name !== ".minecraft" && x.name !== x.launcher ? " · " + x.name : ""}
                  </b>
                  <small>
                    {x.keybinds} keybinds{x.servers ? " · server list" : ""} · changed {ago(x.modified)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="import-what">
            {(["settings", "keybinds", "servers"] as const).map((k) => (
              <label key={k}>
                <Switch on={what[k]} onChange={(v) => setWhat({ ...what, [k]: v })} />
                {k === "settings" ? "Settings" : k === "keybinds" ? "Keybinds" : "Server list"}
              </label>
            ))}
            <span className="grow" />
            <button
              className="btn primary"
              disabled={!chosen || busy || running || (!what.settings && !what.keybinds && !what.servers) || (what.servers && !what.settings && !what.keybinds && !chosen?.servers)}
              onClick={run}
            >
              {busy ? <Spinner size={13} /> : <Icon name="download" size={14} />} Import
            </button>
          </div>
          <span className="muted small">Your current settings are kept as options.txt.before-import, just in case.</span>
        </>
      )}
    </section>
  );
}
