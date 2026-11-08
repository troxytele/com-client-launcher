import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ago, api, fmtTime, CurrentSkin, Info, msg, NewsItem, Progress, Social } from "../api";
import Icon from "../components/Icon";
import { updateAll, updateCount, useUpdates } from "../updates";
import { toast } from "../stores";
import SkinModel from "../components/SkinModel";
import { Spinner } from "../components/Ui";
import logo from "../assets/logo.png";
import ProfileIcon from "../components/ProfileIcon";
import { ServerIcon } from "./Profiles";

type Props = {
  info: Info;
  phase: "idle" | "preparing" | "running";
  progress: Progress | null;
  error: string | null;
  onPlay: (server?: string) => void;
  onProfiles: () => void;
  onStop: () => void;
  onProfile: (id: string) => void;
  onAccounts: () => void;
  onLogs: () => void;
  onSkins: () => void;
  onMods: () => void;
  skinKey: number;
};

// The Play page: a big banner with the latest news and your player, more news below, and the launch bar at the
// bottom (profile, friends online, progress, PLAY).
export default function Home({ info, phase, progress, error, onPlay, onProfiles, onStop, onProfile, onAccounts, onLogs, onSkins, onMods, skinKey }: Props) {
  const updates = useUpdates();
  const nUpdates = updates.profile === info.settings.active_profile ? updateCount(updates) : 0;
  const [updating, setUpdating] = useState<string | null>(null);
  async function runUpdates() {
    setUpdating("Updating…");
    const r = await updateAll((done, total) => setUpdating(`Updating ${Math.min(done + 1, total)} of ${total}…`));
    setUpdating(null);
    if (r.failed.length) toast(`${r.ok} updated, ${r.failed.length} failed: ${r.failed[0]}`, "error");
    else toast(`${r.ok} update${r.ok === 1 ? "" : "s"} installed`, "ok");
  }
  const [news, setNews] = useState<NewsItem[]>([]);
  const [social, setSocial] = useState<Social | null>(null);
  const [skin, setSkin] = useState<CurrentSkin | null>(null);
  const [pickProfile, setPickProfile] = useState(false);
  const active = info.accounts.find((a) => a.active);
  const profile = info.profiles.find((p) => p.id === info.settings.active_profile) ?? info.profiles[0];

  useEffect(() => {
    let live = true;
    api
      .skinCurrent()
      .then((c) => live && setSkin(c))
      .catch(() => live && setSkin({ data: "", variant: "classic", name: "" }));
    return () => {
      live = false;
    };
  }, [active?.uuid, skinKey]);

  useEffect(() => {
    api.news().then(setNews).catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = () =>
      api
        .social()
        .then((s) => !stop && setSocial(s))
        .catch((e) => !stop && console.warn(msg(e)));
    load();
    const t = setInterval(load, 45_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active?.uuid]);

  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null;
  const online = social?.friends.filter((f) => f.online) ?? [];
  const lead = news[0];
  const rest = news.slice(1, 4);

  return (
    <div className="home">
      {/* ------------------------------------------------ banner */}
      <section className="banner">
        <div className="banner-art">
          <div className="banner-grid" />
          <div className="banner-glow" />
          <img className="banner-mark" src={logo} alt="" />
        </div>
        <div className="banner-text">
          {lead ? (
            <>
              <span className="banner-tag">
                {lead.tag || "News"}
                {lead.date && <i> · {lead.date}</i>}
              </span>
              <h1>{lead.title}</h1>
              <p>{lead.body}</p>
              {lead.url && (
                <button className="btn small ghost-light" onClick={() => openUrl(lead.url!)}>
                  Read more <Icon name="arrowRight" size={13} />
                </button>
              )}
            </>
          ) : (
            <>
              <span className="banner-tag">Com Client</span>
              <h1>Welcome back{active ? ", " + active.name : ""}</h1>
              <p>Minecraft {info.mc_version} with Com Client, ready when you are.</p>
            </>
          )}
        </div>
        <div className="banner-model">
          <button className="banner-name" onClick={onAccounts}>
            {active?.name ?? "Sign in"}
          </button>
          {skin ? (
            <SkinModel skin={skin.data} slim={skin.variant === "slim"} animate className="banner-canvas" zoom={0.74} />
          ) : (
            <div className="banner-canvas center">
              <Spinner />
            </div>
          )}
          <button className="banner-skin" onClick={onSkins} title="Change skin">
            <Icon name="shirt" size={14} />
          </button>
        </div>
      </section>

      {/* ------------------------------------------------ more news */}
      {rest.length > 0 && (
        <section className="news-row">
          {rest.map((n, i) => (
            <article key={i} className={"news-card" + (n.url ? " link" : "")} onClick={() => n.url && openUrl(n.url)}>
              <span className="news-tag">{n.tag || "News"}</span>
              <b>{n.title}</b>
              <p>{n.body}</p>
              {n.date && <small>{n.date}</small>}
            </article>
          ))}
        </section>
      )}

      {/* ------------------------------------------------ launch bar */}
      <footer className="launchbar">
        <div className="lb-profile">
          <button className="lb-profile-btn" disabled={phase !== "idle"} onClick={() => setPickProfile(!pickProfile)}>
            <ProfileIcon icon={profile?.icon ?? ""} size={40} className="lb-icon" />
            <span className="lb-text">
              <b>{profile?.name}</b>
              <small>
                {profile?.version || info.mc_version} · {fmtTime(profile?.playtime_secs || 0)} played
              </small>
            </span>
            <Icon name="chevronDown" size={15} className={pickProfile ? "flip" : ""} />
          </button>
          {pickProfile && (
            <div className="dropdown up" onMouseLeave={() => setPickProfile(false)}>
              {info.profiles.map((p) => (
                <button
                  key={p.id}
                  className={p.id === profile?.id ? "on" : ""}
                  onClick={() => {
                    setPickProfile(false);
                    onProfile(p.id);
                  }}
                >
                  <ProfileIcon icon={p.icon} size={28} />
                  <span className="dd-text">
                    <b>
                      {p.name} {p.id === profile?.id && <Icon name="check" size={12} />}
                    </b>
                    <span>
                      {fmtTime(p.playtime_secs || 0)} · {p.last_played ? "played " + ago(p.last_played) : "never played"}
                    </span>
                  </span>
                </button>
              ))}
              <button
                className="dd-manage"
                onClick={() => {
                  setPickProfile(false);
                  onProfiles();
                }}
              >
                <Icon name="layers" size={14} /> Manage profiles
              </button>
            </div>
          )}
        </div>

        <div className="lb-middle">
          {phase === "preparing" && progress ? (
            <div className="lb-progress">
              <div className="progress-text">
                <span>{progress.stage}</span>
                {pct !== null && <span>{Math.round(pct)}%</span>}
              </div>
              <div className="bar">
                <div className={pct === null ? "indeterminate" : ""} style={{ width: (pct ?? 35) + "%" }} />
              </div>
            </div>
          ) : phase === "idle" && error ? (
            <button className="lb-error" onClick={onLogs}>
              <Icon name="alert" size={14} /> <span>{error}</span>
            </button>
          ) : phase === "idle" && (nUpdates > 0 || updating) ? (
            <div className="lb-updates">
              <button className="lb-updates-text" onClick={onMods} title="See them under Mods">
                <Icon name="refresh" size={14} />
                <span>{updating ?? `${nUpdates} update${nUpdates === 1 ? "" : "s"} for your mods and packs`}</span>
              </button>
              {!updating && (
                <button className="btn small primary" onClick={runUpdates}>
                  Update all
                </button>
              )}
            </div>
          ) : online.length > 0 ? (
            <div className="lb-friends" title={online.map((f) => f.name).join(", ")}>
              <div className="faces">
                {online.slice(0, 5).map((f) => (
                  <img
                    key={f.uuid}
                    src={`https://mc-heads.net/avatar/${f.uuid.replace(/-/g, "")}/32`}
                    alt=""
                    onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                  />
                ))}
              </div>
              <span>
                <i /> {online.length} friend{online.length === 1 ? "" : "s"} online
              </span>
            </div>
          ) : (
            <span className="lb-hint">
              {active ? (profile?.last_played ? "Last played " + ago(profile.last_played) : "Ready for your first game") : "Sign in with Microsoft to play"}
            </span>
          )}
        </div>

        {phase === "idle" && active && (profile?.servers?.length ?? 0) > 0 && (
          <div className="lb-servers">
            {profile!.servers.slice(0, 3).map((srv) => (
              <button key={srv.address} className="lb-server" title={"Play and join " + srv.address} onClick={() => onPlay(srv.address)}>
                <ServerIcon address={srv.address} size={26} />
                <span>
                  <b>{srv.name}</b>
                  <small>Quick join</small>
                </span>
              </button>
            ))}
          </div>
        )}

        {phase === "running" ? (
          <button className="play-btn running" onClick={onStop}>
            <Icon name="stop" size={16} fill /> STOP
          </button>
        ) : (
          <button className={"play-btn" + (phase === "preparing" ? " busy" : "")} onClick={() => onPlay()} disabled={phase === "preparing"}>
            {phase === "preparing" && <span className="play-fill" style={{ width: (pct ?? 0) + "%" }} />}
            {phase === "preparing" ? <Spinner size={16} /> : <Icon name="play" size={18} fill />}
            <span>{phase === "preparing" ? "STARTING" : active ? "PLAY" : "SIGN IN"}</span>
          </button>
        )}
      </footer>
    </div>
  );
}
