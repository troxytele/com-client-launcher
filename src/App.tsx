import { useCallback, useEffect, useState } from "react";
import { api, GameExit, Info, msg, on, Progress } from "./api";
import { getLog, pushLog, toast } from "./stores";
import SideRail from "./components/SideRail";
import WindowButtons from "./components/WindowButtons";
import Crashes from "./pages/Crashes";
import Splash from "./components/Splash";
import Backdrop from "./components/Backdrop";
import Icon from "./components/Icon";
import Accounts from "./components/Accounts";
import Updater from "./components/Updater";
import { Modal, Toasts } from "./components/Ui";
import Home from "./pages/Home";
import Mods from "./pages/Mods";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import Skins from "./pages/Skins";
import Profiles from "./pages/Profiles";
import WhatsNew from "./components/WhatsNew";
import Gallery from "./pages/Gallery";
import Friends from "./pages/Friends";
import Locker from "./pages/Locker";

type Page = "home" | "profiles" | "skins" | "locker" | "mods" | "friends" | "gallery" | "settings" | "logs" | "crashes";

export default function App() {
  const [updated, setUpdated] = useState(false);
  // the start-up animation plays at least this long, then fades out over the launcher
  const [introOver, setIntroOver] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIntroOver(true), 1900);
    return () => clearTimeout(t);
  }, []);
  const [info, setInfo] = useState<Info | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [phase, setPhase] = useState<"idle" | "preparing" | "running">("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [skinKey, setSkinKey] = useState(0);
  const [crashFile, setCrashFile] = useState<string | null>(null);
  const [crash, setCrash] = useState<GameExit | null>(null);
  const [unread, setUnread] = useState(0);
  const onUnread = useCallback((n: number) => setUnread(n), []);

  useEffect(() => {
    if (!introOver || !updated || !info) return;
    const t = setTimeout(() => setSplashGone(true), 900);
    return () => clearTimeout(t);
  }, [introOver, updated, info !== null]);

  const reload = useCallback(() => {
    api.info().then((i) => {
      setInfo(i);
      if (i.running) setPhase("running");
    });
  }, []);

  useEffect(() => {
    reload();
    // events from the core
    const un: Promise<() => void>[] = [
      on.progress((p) => setProgress(p)),
      on.log((l) => pushLog(l)),
      on.started(() => {
        setPhase("running");
        setProgress(null);
      }),
      on.exit((e) => {
        setPhase("idle");
        reload();
        if (e.crashed) setCrash(e);
      }),
    ];
    // block the browser's own right-click menu and reload keys (it's an app, not a web page)
    const ctx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, .console")) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "p"))) e.preventDefault();
    };
    window.addEventListener("contextmenu", ctx);
    window.addEventListener("keydown", keys);
    return () => {
      un.forEach((p) => p.then((f) => f()));
      window.removeEventListener("contextmenu", ctx);
      window.removeEventListener("keydown", keys);
    };
  }, [reload]);

  async function play(server?: string, profileId?: string, replay?: string) {
    if (!info) return;
    if (!info.accounts.some((a) => a.active)) {
      setAccountsOpen(true);
      return;
    }
    setError(null);
    setPhase("preparing");
    setProgress({ stage: "Getting ready", done: 0, total: 0 });
    pushLog("[Launcher] ---- starting " + new Date().toLocaleTimeString() + (server ? " (joining " + server + ")" : "") + " ----");
    try {
      await api.launch(server, profileId, replay);
    } catch (e) {
      const m = msg(e);
      pushLog("[Launcher] " + m);
      setError(m);
      setPhase("idle");
      toast(m, "error");
    }
  }

  async function selectProfile(id: string) {
    if (!info) return;
    await api.saveSettings({ ...info.settings, active_profile: id });
    reload();
  }

  if (!updated || !info) {
    return (
      <div className="app">
        {!updated && <Updater onDone={() => setUpdated(true)} />}
        <Splash leaving={false} />
      </div>
    );
  }

  const active = info.accounts.find((a) => a.active);
  const profile = info.profiles.find((p) => p.id === info.settings.active_profile) ?? info.profiles[0];
  const tabs: { id: Page; icon: string; label: string }[] = [
    { id: "home", icon: "play", label: "Play" },
    { id: "profiles", icon: "layers", label: "Profiles" },
    { id: "skins", icon: "shirt", label: "Skins" },
    { id: "locker", icon: "sparkle", label: "Locker" },
    { id: "mods", icon: "cube", label: "Mods" },
    { id: "friends", icon: "users", label: "Friends" },
    { id: "gallery", icon: "image", label: "Gallery" },
    { id: "crashes", icon: "bug", label: "Crashes" },
    { id: "logs", icon: "terminal", label: "Logs" },
  ];
  const titles: Record<Page, string> = {
    home: "Play", profiles: "Profiles", skins: "Skins", locker: "Locker", mods: "Mods", friends: "Friends", gallery: "Gallery",
    crashes: "Crashes", logs: "Logs", settings: "Settings",
  };

  return (
    <div className={"app" + (introOver ? " entered" : " waiting")}>
      <Backdrop />
      <SideRail
        tabs={tabs}
        page={page}
        onPage={(p) => setPage(p as Page)}
        account={active}
        onAccounts={() => setAccountsOpen(true)}
        badge={{ friends: unread }}
      />
      <div className="main">
        <div className="topstrip" data-tauri-drag-region>
          <span className="strip-title" data-tauri-drag-region>
            COM CLIENT <i>/</i> {titles[page].toUpperCase()}
          </span>
          <span className="grow" data-tauri-drag-region />
          <span className={"status-dot " + phase} data-tauri-drag-region>
            <i />
            {phase === "running" ? "In game" : phase === "preparing" ? "Starting…" : "Ready"} · v{info.version}
          </span>
          <WindowButtons />
        </div>
      <div className="layout">
        <main className="content" key={page}>
          {page === "home" && (
            <Home
              info={info}
              phase={phase}
              progress={progress}
              error={error}
              onPlay={play}
              onProfiles={() => setPage("profiles")}
              onStop={() => api.kill()}
              onProfile={selectProfile}
              onAccounts={() => setAccountsOpen(true)}
              onLogs={() => setPage("logs")}
              onSkins={() => setPage("skins")}
              skinKey={skinKey}
            />
          )}
          {page === "profiles" && <Profiles info={info} reload={reload} running={phase !== "idle"} onPlay={(srv) => { setPage("home"); play(srv); }} />}
          {page === "skins" && (
            <Skins
              signedIn={!!active}
              onAccounts={(a) => setInfo({ ...info, accounts: a })}
              onSkinChanged={() => setSkinKey((k) => k + 1)}
            />
          )}
          {page === "mods" && (
            <Mods
              profileName={profile.name}
              running={phase === "running"}
              onModpack={async (id) => {
                await selectProfile(id);
                setPage("profiles");
              }}
            />
          )}
          {page === "locker" && <Locker signedIn={!!active} onAccounts={() => setAccountsOpen(true)} skinKey={skinKey} />}
          {page === "friends" && (
            <Friends
              signedIn={!!active}
              running={phase !== "idle"}
              onAccounts={() => setAccountsOpen(true)}
              onUnread={onUnread}
              onJoin={(server) => {
                setPage("home");
                play(server);
              }}
            />
          )}
          {page === "gallery" && (
            <Gallery
              profiles={info.profiles}
              running={phase !== "idle"}
              onWatch={(r) => {
                setPage("home");
                play(undefined, r.profile, r.path);
              }}
            />
          )}
          {page === "settings" && <Settings info={info} reload={reload} running={phase !== "idle"} />}
          {page === "logs" && <Logs />}
          {page === "crashes" && <Crashes initial={crashFile} />}
        </main>
      </div>
      </div>

      {accountsOpen && (
        <Accounts
          accounts={info.accounts}
          onChange={(a) => setInfo({ ...info, accounts: a })}
          onClose={() => setAccountsOpen(false)}
        />
      )}

      {crash && (
        <Modal title="Minecraft crashed" onClose={() => setCrash(null)} width={560}>
          <p className="muted">
            The game closed with code {crash.code ?? "?"}. The last lines of the log usually say why (look for a mod name).
          </p>
          <pre className="crash-tail">
            {getLog()
              .filter((l) => /ERROR|FATAL|Exception|Caused by|\tat /.test(l))
              .slice(-14)
              .join("\n") || getLog().slice(-14).join("\n")}
          </pre>
          <div className="block-foot">
            <button
              className="btn"
              onClick={() => {
                setCrashFile(crash.crash_report ?? null);
                setCrash(null);
                setPage("crashes");
              }}
            >
              <Icon name="bug" size={14} /> Why did it crash?
            </button>
            <span className="grow" />
            <button
              className="btn"
              onClick={() => {
                setCrash(null);
                setPage("logs");
              }}
            >
              <Icon name="terminal" size={14} /> Show logs
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setCrash(null);
                play();
              }}
            >
              <Icon name="play" size={14} fill /> Play again
            </button>
          </div>
        </Modal>
      )}
      {splashGone && <WhatsNew version={info.version} />}
      <Toasts />
      {!splashGone && <Splash leaving={introOver} />}
    </div>
  );
}
