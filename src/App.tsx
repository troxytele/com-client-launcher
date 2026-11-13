import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { api, GameExit, Info, msg, on, Progress } from "./api";
import { analyze } from "./crash";
import { getLog, pushLog, toast } from "./stores";
import SideRail from "./components/SideRail";
import WindowButtons from "./components/WindowButtons";
import Splash from "./components/Splash";
import Backdrop from "./components/Backdrop";
import Icon from "./components/Icon";
import Accounts from "./components/Accounts";
import Updater from "./components/Updater";
import { Modal, Toasts } from "./components/Ui";
import Home from "./pages/Home";
// every page except Home loads the first time it's opened: a faster start and less memory
const Mods = lazy(() => import("./pages/Mods"));
const Settings = lazy(() => import("./pages/Settings"));
const Logs = lazy(() => import("./pages/Logs"));
const Skins = lazy(() => import("./pages/Skins"));
const Profiles = lazy(() => import("./pages/Profiles"));
const Gallery = lazy(() => import("./pages/Gallery"));
const Friends = lazy(() => import("./pages/Friends"));
const Locker = lazy(() => import("./pages/Locker"));
const Crashes = lazy(() => import("./pages/Crashes"));
import { checkUpdates, updateCount, useUpdates } from "./updates";
import WhatsNew from "./components/WhatsNew";
import Tour, { firstRun } from "./components/Tour";

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
  const [tour, setTour] = useState(firstRun);
  const [skinKey, setSkinKey] = useState(0);
  const [crashFile, setCrashFile] = useState<string | null>(null);
  const [crash, setCrash] = useState<GameExit | null>(null);
  const [unread, setUnread] = useState(0);
  const onUnread = useCallback((n: number) => setUnread(n), []);
  const updates = useUpdates();

  // check / download the game files in the background, so Play starts right away later
  // (starts while the splash is still showing; Play waits for it instead of checking everything twice)
  const ready = info !== null;
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => api.prewarm().catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [ready]);

  // load the other pages in the background once the start is done, so opening them is instant too
  useEffect(() => {
    if (!splashGone) return;
    const t = setTimeout(() => {
      for (const load of [() => import("./pages/Mods"), () => import("./pages/Friends"), () => import("./pages/Locker"), () => import("./pages/Skins"), () => import("./pages/Settings")])
        load().catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [splashGone]);

  // mod updates: a quiet check a little after start, after switching profile, then every 6 hours
  const activeProfile = info?.settings.active_profile ?? "";
  useEffect(() => {
    if (!splashGone || !activeProfile) return;
    const first = setTimeout(() => checkUpdates(activeProfile), 6000);
    const again = setInterval(() => checkUpdates(activeProfile), 6 * 3600_000);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [splashGone, activeProfile]);

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
        <Splash leaving={false} />
        {!updated && <Updater onDone={() => setUpdated(true)} />}
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
        accounts={info.accounts}
        onSwitched={(a) => setInfo({ ...info, accounts: a })}
        onAccounts={() => setAccountsOpen(true)}
        badge={{ friends: unread, mods: updates.profile === activeProfile ? updateCount(updates) : 0 }}
      />
      <div className="main">
        <div className="topstrip" data-tauri-drag-region>
          <div className="fairy-lights" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${(i * 0.37) % 2.4}s` }} />
            ))}
          </div>
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
          <Suspense fallback={<div className="page-loading" />}>
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
              onMods={() => setPage("mods")}
              skinKey={skinKey}
            />
          )}
          {page === "profiles" && <Profiles info={info} reload={reload} running={phase !== "idle"} onPlay={(srv) => { setPage("home"); play(srv); }}
            onMods={async (id?: string) => {
              if (id && id !== profile.id) await selectProfile(id);
              setPage("mods");
            }} />}
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
              version={profile.version || info.mc_version}
              running={phase === "running"}
              onModpack={async (id) => {
                await selectProfile(id);
                setPage("profiles");
              }}
              profiles={info.profiles}
              activeId={profile.id}
              onSelectProfile={selectProfile}
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
          </Suspense>
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
          <CrashReason exit={crash} log={getLog()} />
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
      {splashGone && tour && !accountsOpen && (
        <Tour
          signedIn={!!active}
          name={active?.name ?? null}
          onSignIn={() => setAccountsOpen(true)}
          onProfiles={() => setPage("profiles")}
          onLocker={() => setPage("locker")}
          onClose={() => setTour(false)}
        />
      )}
      {splashGone && <WhatsNew version={info.version} />}
      <Toasts />
      {!splashGone && <Splash leaving={introOver} />}
    </div>
  );
}

/** The crash popup's body: what most likely went wrong, in plain words, with the raw lines folded away. */
function CrashReason({ exit, log }: { exit: GameExit; log: string[] }) {
  const [report, setReport] = useState<string | null>(null);
  useEffect(() => {
    if (!exit.crash_report) return;
    api.crashRead(exit.crash_report).then(setReport).catch(() => setReport(null));
  }, [exit.crash_report]);
  const text = (report ?? "") + "\n" + log.join("\n");
  const found = useMemo(() => analyze(text), [text]);
  const tail = log.filter((l) => /ERROR|FATAL|Exception|Caused by|\tat /.test(l)).slice(-14);
  const top = found.findings.slice(0, 3);
  return (
    <>
      {top.length ? (
        <div className="crash-reasons">
          {top.map((f) => (
            <div key={f.title} className={`crash-reason ${f.level}`}>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          Minecraft closed unexpectedly (code {exit.code ?? "?"}) and the crash doesn't match a known problem. If you added mods recently, turn the
          newest ones off in Mods and play again. “Why did it crash?” shows the whole report.
        </p>
      )}
      <details className="crash-details">
        <summary>Show the error lines</summary>
        <pre className="crash-tail">{(tail.length ? tail : log.slice(-14)).join("\n")}</pre>
      </details>
    </>
  );
}
