import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ago, api, CurrentSkin, Info, msg, NewsItem, Progress, Social } from "../api";
import Face from "../components/Face";
import Icon from "../components/Icon";
import { Spinner, Switch } from "../components/Ui";
import SkinModel from "../components/SkinModel";
import logo from "../assets/logo.png";

type Props = {
  info: Info;
  phase: "idle" | "preparing" | "running";
  progress: Progress | null;
  error: string | null;
  onPlay: () => void;
  onStop: () => void;
  onProfile: (id: string) => void;
  onAccounts: () => void;
  onLogs: () => void;
  onSkins: () => void;
  skinKey: number;
};

export default function Home({ info, phase, progress, error, onPlay, onStop, onProfile, onAccounts, onLogs, onSkins, skinKey }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [social, setSocial] = useState<Social | null>(null);
  const [socialErr, setSocialErr] = useState<string | null>(null);
  const [pickProfile, setPickProfile] = useState(false);
  const active = info.accounts.find((a) => a.active);
  const profile = info.profiles.find((p) => p.id === info.settings.active_profile) ?? info.profiles[0];

  const [skin, setSkin] = useState<CurrentSkin | null>(null);
  const [animate, setAnimateState] = useState(() => {
    try {
      return localStorage.getItem("skinAnimation") !== "off";
    } catch {
      return true;
    }
  });
  const setAnimate = (v: boolean) => {
    setAnimateState(v);
    try {
      localStorage.setItem("skinAnimation", v ? "on" : "off");
    } catch {}
  };

  // the player model shows the skin of the signed-in account (blank Steve if none / offline)
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
        .then((s) => !stop && (setSocial(s), setSocialErr(null)))
        .catch((e) => !stop && setSocialErr(msg(e)));
    load();
    const t = setInterval(load, 45_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active?.uuid]);

  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null;
  const online = social?.friends.filter((f) => f.online) ?? [];

  return (
    <div className="home">
      <div className="home-main">
        <section className="stage glass">
          <div className="stage-grid" />
          <div className="stage-glow" />
          <div className="stage-top">
            <div className="stage-brand">
              <img src={logo} alt="" />
              <div>
                <b>Com Client</b>
                <span>
                  Minecraft {info.mc_version} · Fabric
                  {info.client.client_version && <> · {info.client.client_version}</>}
                </span>
              </div>
            </div>
            <div className="stage-tools">
              <label className="stage-toggle" title="Animate the player">
                <span>Skin animation</span>
                <Switch on={animate} onChange={setAnimate} />
              </label>
              <button className="btn small" onClick={onSkins}>
                <Icon name="shirt" size={14} /> Change skin
              </button>
            </div>
          </div>

          <div className="stage-model">
            {active && (
              <div className="nametag">
                <img src={logo} alt="" />
                <span>{active.name}</span>
              </div>
            )}
            {skin ? (
              <SkinModel skin={skin.data} slim={skin.variant === "slim"} animate={animate} className="stage-canvas" zoom={0.78} />
            ) : (
              <div className="stage-canvas center">
                <Spinner />
              </div>
            )}
            <div className="stage-floor" />
          </div>

          <div className="launch">
            {phase === "running" ? (
              <button className="play running" onClick={onStop}>
                <Icon name="stop" size={20} fill />
                <span>
                  <b>Running</b>
                  <small>click to stop</small>
                </span>
              </button>
            ) : (
              <div className={"launch-split" + (pickProfile ? " open" : "")}>
                <button className={"play" + (phase === "preparing" ? " busy" : "")} onClick={onPlay} disabled={phase === "preparing"}>
                  {phase === "preparing" ? <Spinner size={20} /> : <Icon name="play" size={22} fill />}
                  <span>
                    <b>{phase === "preparing" ? "Starting" : active ? "Launch" : "Sign in"}</b>
                    <small>{profile?.name}</small>
                  </span>
                </button>
                <button
                  className="play-more"
                  title="Switch profile"
                  disabled={phase !== "idle"}
                  onClick={() => setPickProfile(!pickProfile)}
                >
                  <Icon name="chevronDown" size={18} />
                </button>
                {pickProfile && (
                  <div className="dropdown glass" onMouseLeave={() => setPickProfile(false)}>
                    <div className="dropdown-title">Profiles</div>
                    {info.profiles.map((p) => (
                      <button
                        key={p.id}
                        className={p.id === profile?.id ? "on" : ""}
                        onClick={() => {
                          setPickProfile(false);
                          onProfile(p.id);
                        }}
                      >
                        <b>
                          {p.name} {p.id === profile?.id && <Icon name="check" size={12} />}
                        </b>
                        <span>{p.last_played ? "played " + ago(p.last_played) : "never played"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {phase === "preparing" && progress && (
              <div className="progress">
                <div className="progress-text">
                  <span>{progress.stage}</span>
                  {pct !== null && <span>{Math.round(pct)}%</span>}
                </div>
                <div className="bar">
                  <div className={pct === null ? "indeterminate" : ""} style={{ width: (pct ?? 35) + "%" }} />
                </div>
              </div>
            )}
            {phase === "idle" && error && (
              <div className="play-error">
                <Icon name="alert" size={15} />
                <span>{error}</span>
                <button className="link" onClick={onLogs}>
                  Logs
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="news">
          <h2>News</h2>
          <div className="news-list">
            {news.map((n, i) => (
              <article key={i} className={"news-card glass" + (n.url ? " link" : "")} onClick={() => n.url && openUrl(n.url)}>
                <div className="news-meta">
                  {n.tag && <span className="tag">{n.tag}</span>}
                  {n.date && <span className="muted small">{n.date}</span>}
                </div>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <aside className="home-side glass">
        <div className="me" onClick={onAccounts}>
          <Face skin={active?.skin_url} name={active?.name} size={40} />
          <div className="me-text">
            <b>{active?.name ?? "No account"}</b>
            <span>{social ? (social.username ? "@" + social.username + " · " : "") + "Level " + social.level : active ? "Com Client" : "Click to sign in"}</span>
          </div>
          <Icon name="chevron" size={16} />
        </div>
        {social && (social.unread > 0 || social.requests > 0) && (
          <div className="side-note">
            <Icon name="chat" size={14} />
            {social.unread > 0 && <span>{social.unread} new message{social.unread === 1 ? "" : "s"}</span>}
            {social.requests > 0 && <span>{social.requests} friend request{social.requests === 1 ? "" : "s"}</span>}
          </div>
        )}
        <div className="side-title">
          <span>Friends</span>
          <span className="muted">{social ? `${online.length} online` : ""}</span>
        </div>
        <div className="friends">
          {!active && <p className="muted small pad">Sign in to see your friends.</p>}
          {active && !social && !socialErr && (
            <p className="muted small pad">
              <Spinner size={11} /> Loading…
            </p>
          )}
          {socialErr && !social && <p className="muted small pad">Friends server unreachable.</p>}
          {social && social.friends.length === 0 && <p className="muted small pad">Add friends in the game: Profile → Friends.</p>}
          {social?.friends.map((f) => (
            <div key={f.uuid} className={"friend" + (f.online ? " online" : "")}>
              <div className="friend-face">
                <img
                  src={`https://mc-heads.net/avatar/${f.uuid.replace(/-/g, "")}/32`}
                  alt=""
                  onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                />
                {f.online && <i />}
              </div>
              <div className="friend-text">
                <b>{f.name}</b>
                <span>
                  {f.online
                    ? f.server
                      ? "Playing on " + f.server
                      : f.activity === "singleplayer"
                        ? "In singleplayer"
                        : "Online"
                    : "Last seen " + ago(f.last_seen)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
