import { Account } from "../api";
import Face from "./Face";
import Icon from "./Icon";
import logo from "../assets/logo.png";

export type Tab = { id: string; icon: string; label: string };

// The left rail: logo, the pages, and at the bottom Settings + your account.
export default function SideRail({
  tabs,
  page,
  onPage,
  account,
  onAccounts,
  badge,
}: {
  tabs: Tab[];
  page: string;
  onPage: (id: string) => void;
  account?: Account;
  onAccounts: () => void;
  badge?: Record<string, number>;
}) {
  return (
    <aside className="rail" data-tauri-drag-region>
      <div className="rail-logo" data-tauri-drag-region>
        <img src={logo} alt="" />
      </div>
      <nav className="rail-nav">
        {tabs.map((t) => (
          <button key={t.id} className={page === t.id ? "on" : ""} onClick={() => onPage(t.id)} title={t.label}>
            <Icon name={t.icon} size={19} />
            <span>{t.label}</span>
            {!!badge?.[t.id] && <em>{badge[t.id]}</em>}
          </button>
        ))}
      </nav>
      <div className="rail-bottom">
        <button className={page === "settings" ? "on" : ""} onClick={() => onPage("settings")} title="Settings">
          <Icon name="gear" size={19} />
          <span>Settings</span>
        </button>
        <button className="rail-account" onClick={onAccounts} title={account ? account.name + " (switch account)" : "Sign in"}>
          <Face skin={account?.skin_url} name={account?.name} size={30} />
        </button>
      </div>
    </aside>
  );
}
