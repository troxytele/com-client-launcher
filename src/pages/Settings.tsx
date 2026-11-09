import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, Info, msg, Settings as S } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import { Spinner, Switch } from "../components/Ui";
import { getLook, isHex, Look, onLook, setLook, THEMES } from "../theme";
import { getSounds, setSounds, sfx, SoundPrefs } from "../sounds";
import { ImportProgress, ImportSource, ago } from "../api";
import { listen } from "@tauri-apps/api/event";

export default function Settings({ info, reload, running }: { info: Info; reload: () => void; running: boolean }) {
  const [s, setS] = useState<S>(info.settings);
  const [repairing, setRepairing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [look, setLookState] = useState<Look>(getLook());
  useEffect(() => onLook(setLookState), []);

  useEffect(() => setS(info.settings), [info.settings]);
  const [snd, setSnd] = useState<SoundPrefs>(getSounds());
  function sound(next: SoundPrefs) {
    setSnd(next);
    setSounds(next);
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


  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">How the launcher looks, sounds and behaves.</p>
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
          <label className={"theme-swatch custom" + (look.theme === "custom" ? " on" : "")} onClick={() => look.theme !== "custom" && setLook({ ...look, theme: "custom" })}>
            <i style={{ background: look.custom }}>
              {look.theme === "custom" ? <Icon name="check" size={16} /> : <Icon name="edit" size={14} />}
              <input type="color" value={look.custom} onChange={(e) => setLook({ ...look, theme: "custom", custom: e.target.value })} />
            </i>
            Custom
          </label>
        </div>
        {look.theme === "custom" && (
          <div className="setting">
            <div>
              <b>Your colour</b>
              <span>Click the Custom square for the colour picker, or type a hex code.</span>
            </div>
            <div className="row-gap hexrow">
              <span className="hexdot" style={{ background: look.custom }} />
              <HexInput value={look.custom} onChange={(v) => setLook({ ...look, theme: "custom", custom: v })} />
            </div>
          </div>
        )}
        <div className="setting">
          <div>
            <b>Moving background</b>
            <span>Specks of light drifting slowly behind everything. Turn off for a still background.</span>
          </div>
          <Switch on={look.stars} onChange={(v) => setLook({ ...look, stars: v })} />
        </div>
        <div className="setting">
          <div>
            <b>Christmas look</b>
            <span>Falling snow, fairy lights along the top and a Santa hat on the logo. On by default until January 6.</span>
          </div>
          <Switch on={look.festive} onChange={(v) => setLook({ ...look, festive: v })} />
        </div>
        <div className="setting">
          <div>
            <b>Sounds</b>
            <span>A soft click and hover sound on buttons, the same ones as in the game.</span>
          </div>
          <div className="row-gap">
            {snd.on && (
              <input
                type="range"
                className="vol"
                min={0}
                max={1}
                step={0.05}
                value={snd.volume}
                onChange={(e) => sound({ ...snd, volume: Number(e.target.value) })}
                onPointerUp={() => sfx.click()}
              />
            )}
            <Switch on={snd.on} onChange={(v) => sound({ ...snd, on: v })} />
          </div>
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
            <span>Hidden, it waits in the system tray (click the icon to open it) and comes back when you quit the game</span>
          </div>
          <select value={s.after_launch} onChange={(e) => setSetting({ ...s, after_launch: e.target.value as S["after_launch"] })}>
            <option value="hide">Hide to tray, come back after</option>
            <option value="keep">Stay open</option>
            <option value="close">Close</option>
          </select>
        </div>
        <div className="setting">
          <div>
            <b>Logs window</b>
            <span>Opens a separate window with the game's log, its memory and CPU while it starts and runs</span>
          </div>
          <Switch on={s.open_logs} onChange={(v) => setSetting({ ...s, open_logs: v })} />
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

    </div>
  );
}

// Import settings (options.txt: video, sensitivity, keybinds) and the server list from another launcher. Never mods.
function HexInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <input
      className="mono hex"
      value={t}
      maxLength={7}
      onChange={(e) => {
        const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
        setT(v);
        if (isHex(v)) onChange(v.toLowerCase());
      }}
    />
  );
}

export function ImportBlock({ profileId, profileName, running }: { profileId: string; profileName: string; running: boolean }) {
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [what, setWhat] = useState({ settings: true, keybinds: true, servers: true, packs: true });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<ImportProgress | null>(null);

  useEffect(() => {
    const off = listen<ImportProgress>("import-progress", (e) => setProg(e.payload));
    return () => {
      off.then((f) => f());
    };
  }, []);

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
    setProg(null);
    try {
      toast(await api.importApply(pick, profileId, what.settings, what.keybinds, what.servers, what.packs && (chosen?.packs ?? 0) > 0), "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(false);
      setTimeout(() => setProg(null), 1500);
    }
  }
  const pct = prog && prog.total > 0 ? Math.min(100, (prog.done / prog.total) * 100) : 0;
  const mb = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.max(0.1, b / 1e6).toFixed(1) + " MB");

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
        Copies your settings (render distance, mouse sensitivity, FOV, sounds …), keybinds, server list and resource packs from Minecraft Launcher, Lunar,
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
                    {x.keybinds} keybinds{x.servers ? " · server list" : ""}
                    {x.packs > 0 ? ` · ${x.packs} resource pack${x.packs === 1 ? "" : "s"} (${mb(x.packs_bytes)})` : ""} · changed {ago(x.modified)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="import-what">
            {(["settings", "keybinds", "servers", "packs"] as const).map((k) => (
              <label key={k}>
                <Switch on={what[k]} onChange={(v) => setWhat({ ...what, [k]: v })} />
                {k === "settings" ? "Settings" : k === "keybinds" ? "Keybinds" : k === "servers" ? "Server list" : "Resource packs"}
              </label>
            ))}
            <span className="grow" />
            <button
              className="btn primary"
              disabled={!chosen || busy || running || (!what.settings && !what.keybinds && !what.servers && !(what.packs && chosen.packs > 0))}
              onClick={run}
            >
              {busy ? <Spinner size={13} /> : <Icon name="download" size={14} />} Import
            </button>
          </div>
          {busy && what.packs && (chosen?.packs ?? 0) > 0 && (
            <div className="import-progress">
              <div className="progress-text">
                <span>{prog?.name ? "Copying " + prog.name : "Copying resource packs…"}</span>
                <span>
                  {prog ? `${mb(prog.done)} / ${mb(prog.total)} · ${Math.round(pct)}%` : "0%"}
                </span>
              </div>
              <div className="bar">
                <div style={{ width: pct + "%" }} />
              </div>
            </div>
          )}
          <span className="muted small">Your current settings are kept as options.txt.before-import, just in case. Packs you already have are skipped.</span>
        </>
      )}
    </section>
  );
}
