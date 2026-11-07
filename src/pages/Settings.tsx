import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, Info, msg, Profile, Settings as S } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import { Modal, Spinner, Switch } from "../components/Ui";

export default function Settings({ info, reload, running }: { info: Info; reload: () => void; running: boolean }) {
  const [profileId, setProfileId] = useState(info.settings.active_profile);
  const profile = info.profiles.find((p) => p.id === profileId) ?? info.profiles[0];
  const [p, setP] = useState<Profile>(profile);
  const [s, setS] = useState<S>(info.settings);
  const [newOpen, setNewOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [checking, setChecking] = useState(false);

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
            <span>Shows "In the launcher" on Discord (uses the Discord app ID from Com Client's settings)</span>
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
