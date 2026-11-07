import { useCallback, useEffect, useState } from "react";
import { api, GameExit, Info, msg, on, Progress } from "./api";
import { getLog, pushLog, toast } from "./stores";
import TopBar from "./components/TopBar";
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

type Page = "home" | "skins" | "mods" | "settings" | "logs";

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
  const [crash, setCrash] = useState<GameExit | null>(null);

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

  async function play() {
    if (!info) return;
    if (!info.accounts.some((a) => a.active)) {
      setAccountsOpen(true);
      return;
    }
    setError(null);
    setPhase("preparing");
    setProgress({ stage: "Getting ready", done: 0, total: 0 });
    pushLog("[Launcher] ---- starting " + new Date().toLocaleTimeString() + " ----");
    try {
      await api.launch();
      if (info.settings.open_logs) setPage("logs");
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
    { id: "skins", icon: "shirt", label: "Skins" },
    { id: "mods", icon: "cube", label: "Mods" },
    { id: "logs", icon: "terminal", label: "Logs" },
  ];

  return (
    <div className={"app" + (introOver ? " entered" : " waiting")}>
      <Backdrop />
      <TopBar
        version={info.version}
        tabs={tabs}
        page={page}
        onPage={(p) => setPage(p as Page)}
        phase={phase}
        account={active}
        onAccounts={() => setAccountsOpen(true)}
        onSettings={() => setPage("settings")}
      />
      <div className="layout">
        <main className="content" key={page}>
          {page === "home" && (
            <Home
              info={info}
              phase={phase}
              progress={progress}
              error={error}
              onPlay={play}
              onStop={() => api.kill()}
              onProfile={selectProfile}
              onAccounts={() => setAccountsOpen(true)}
              onLogs={() => setPage("logs")}
              onSkins={() => setPage("skins")}
              skinKey={skinKey}
            />
          )}
          {page === "skins" && (
            <Skins
              signedIn={!!active}
              onAccounts={(a) => setInfo({ ...info, accounts: a })}
              onSkinChanged={() => setSkinKey((k) => k + 1)}
            />
          )}
          {page === "mods" && <Mods profileName={profile.name} running={phase === "running"} />}
          {page === "settings" && <Settings info={info} reload={reload} running={phase !== "idle"} />}
          {page === "logs" && <Logs />}
        </main>
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
            {crash.crash_report && (
              <button className="btn" onClick={() => api.openFile(crash.crash_report!)}>
                <Icon name="alert" size={14} /> Open crash report
              </button>
            )}
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
      <Toasts />
      {!splashGone && <Splash leaving={introOver} />}
    </div>
  );
}
