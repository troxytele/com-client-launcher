import { getCurrentWindow } from "@tauri-apps/api/window";
import { Account } from "../api";
import Face from "./Face";
import Icon from "./Icon";
import { Spinner } from "./Ui";
import logo from "../assets/logo.png";

export type Tab = { id: string; icon: string; label: string };

// The window's own title bar (no Windows frame): logo, the page tabs in the middle, account + window buttons on the right.
// Empty space drags the window.
export default function TopBar({
  version,
  tabs,
  page,
  onPage,
  phase,
  account,
  onAccounts,
  onSettings,
}: {
  version: string;
  tabs: Tab[];
  page: string;
  onPage: (id: string) => void;
  phase: "idle" | "preparing" | "running";
  account?: Account;
  onAccounts: () => void;
  onSettings: () => void;
}) {
  const w = getCurrentWindow();
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <img src={logo} alt="" />
        <div data-tauri-drag-region>
          <b>COM CLIENT</b>
          <span>
            <i className={"live" + (phase === "running" ? " on" : "")} /> v{version}
          </span>
        </div>
      </div>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={page === t.id ? "on" : ""} onClick={() => onPage(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="top-right">
        <div className={"status-chip " + phase} title={phase === "running" ? "Minecraft is running" : ""}>
          {phase === "preparing" ? <Spinner size={11} /> : <i />}
          {phase === "running" ? "In game" : phase === "preparing" ? "Starting" : "Ready"}
        </div>
        <button className="account-pill" onClick={onAccounts}>
          <Face skin={account?.skin_url} name={account?.name} size={26} round />
          <span>{account?.name ?? "Sign in"}</span>
          <Icon name="chevronDown" size={13} />
        </button>
        <button className={"round-btn" + (page === "settings" ? " on" : "")} title="Settings" onClick={onSettings}>
          <Icon name="gear" size={17} />
        </button>
        <div className="win-buttons">
          <button title="Minimize" onClick={() => w.minimize()}>
            <Icon name="min" size={12} />
          </button>
          <button title="Maximize" onClick={() => w.toggleMaximize()}>
            <Icon name="max" size={10} />
          </button>
          <button className="close" title="Close" onClick={() => w.close()}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    </header>
  );
}
