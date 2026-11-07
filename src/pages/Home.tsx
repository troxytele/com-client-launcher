import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ago, api, CurrentSkin, Info, msg, NewsItem, Progress, Social } from "../api";
import Icon from "../components/Icon";
import SkinModel from "../components/SkinModel";
import { Spinner } from "../components/Ui";

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

const R = 54; // radius of the progress ring around the launch disc
const C = 2 * Math.PI * R;

// The Play page: your player under a spotlight with your name huge behind it, a spec sheet of the selected
// profile, profile cards, the round launch disc and the news underneath.
export default function Home({ info, phase, progress, error, onPlay, onStop, onProfile, onAccounts, onLogs, onSkins, skinKey }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [social, setSocial] = useState<Social | null>(null);
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
    } catch {
      // not saved, still works
    }
  };
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
  const name = active?.name ?? "PLAYER";
  const ramGb = (profile?.ram_mb ?? 0) / 1024;

  return (
    <div className="play">
      {/* ------------------------------------------------ the player */}
      <section className="showcase">
        <div className="giant-name" aria-hidden>
          {name}
        </div>
        <div className="spotlight" />
        <div className="floor" />
        {skin ? (
          <SkinModel skin={skin.data} slim={skin.variant === "slim"} animate={animate} className="showcase-model" zoom={0.6} />
        ) : (
          <div className="showcase-model center">
            <Spinner />
          </div>
        )}
        <div className="showcase-tools">
          <button className={"chip" + (animate ? " on" : "")} onClick={() => setAnimate(!animate)} title="Animate the player">
            <Icon name={animate ? "play" : "stop"} size={11} fill /> {animate ? "Moving" : "Still"}
          </button>
          <button className="chip" onClick={onSkins}>
            <Icon name="shirt" size={12} /> Skin
          </button>
        </div>
        {online.length > 0 && (
          <div className="online-stack" title={online.map((f) => f.name).join(", ")}>
            <div className="faces">
              {online.slice(0, 4).map((f) => (
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
        )}
      </section>

      {/* ------------------------------------------------ profile + launch */}
      <section className="deck">
        <div className="who" onClick={onAccounts}>
          <span className="who-label">PLAYING AS</span>
          <b>{active?.name ?? "Not signed in"}</b>
          {social && (
            <span className="who-meta">
              {social.username ? "@" + social.username + " · " : ""}level {social.level}
              {social.unread > 0 && <em> · {social.unread} new message{social.unread === 1 ? "" : "s"}</em>}
            </span>
          )}
        </div>

        <div className="spec">
          <div>
            <span>VERSION</span>
            <b>{info.mc_version}</b>
          </div>
          <div>
            <span>LOADER</span>
            <b>Fabric</b>
          </div>
          <div>
            <span>CLIENT</span>
            <b>{info.client.client_version || "latest"}</b>
          </div>
          <div>
            <span>MEMORY</span>
            <b>{ramGb ? (Number.isInteger(ramGb) ? ramGb : ramGb.toFixed(1)) + " GB" : "auto"}</b>
          </div>
        </div>

        <div className="profiles-row">
          {info.profiles.map((p, i) => (
            <button
              key={p.id}
              className={"pcard" + (p.id === profile?.id ? " on" : "")}
              disabled={phase !== "idle"}
              onClick={() => onProfile(p.id)}
            >
              <span className="pcard-n">{String(i + 1).padStart(2, "0")}</span>
              <b>{p.name}</b>
              <small>{p.last_played ? ago(p.last_played) : "new"}</small>
            </button>
          ))}
        </div>

        <div className="launch-zone">
          <button
            className={"disc" + (phase === "running" ? " running" : phase === "preparing" ? " busy" : "")}
            onClick={phase === "running" ? onStop : onPlay}
            disabled={phase === "preparing"}
          >
            <svg viewBox="0 0 120 120">
              <circle className="disc-track" cx="60" cy="60" r={R} />
              <circle
                className={"disc-fill" + (phase === "preparing" && pct === null ? " spin" : "")}
                cx="60"
                cy="60"
                r={R}
                strokeDasharray={C}
                strokeDashoffset={phase === "preparing" ? C * (1 - (pct ?? 25) / 100) : C}
              />
            </svg>
            <span className="disc-core">
              {phase === "running" ? (
                <Icon name="stop" size={24} fill />
              ) : phase === "preparing" ? (
                <b>{pct !== null ? Math.round(pct) + "%" : <Spinner size={20} />}</b>
              ) : (
                <Icon name="play" size={30} fill />
              )}
            </span>
          </button>
          <div className="launch-text">
            <b>{phase === "running" ? "In game" : phase === "preparing" ? "Starting" : active ? "Launch" : "Sign in"}</b>
            <span>
              {phase === "running"
                ? "Click the disc to stop Minecraft"
                : phase === "preparing"
                  ? progress?.stage ?? "Getting ready"
                  : active
                    ? profile?.name + " · " + info.mc_version
                    : "with your Microsoft account"}
            </span>
            {phase === "idle" && error && (
              <button className="launch-error" onClick={onLogs}>
                <Icon name="alert" size={13} /> {error}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ news */}
      <section className="headlines">
        {news.slice(0, 3).map((n, i) => (
          <article key={i} className={"headline-card" + (n.url ? " link" : "")} onClick={() => n.url && openUrl(n.url)}>
            <span className="idx">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <small>
                {n.tag ?? "News"}
                {n.date && " · " + n.date}
              </small>
              <b>{n.title}</b>
              <p>{n.body}</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
