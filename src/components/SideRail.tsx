import { useEffect, useRef, useState } from "react";
import { Account, api, msg } from "../api";
import { toast } from "../stores";
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
  accounts = [],
  onAccounts,
  onSwitched,
  badge,
}: {
  tabs: Tab[];
  page: string;
  onPage: (id: string) => void;
  account?: Account;
  accounts?: Account[];
  onAccounts: () => void;
  onSwitched?: (a: Account[]) => void;
  badge?: Record<string, number>;
}) {
  // quick switch: click the head for a list of your accounts (Manage opens the full dialog)
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  async function pick(a: Account) {
    if (a.active) return setOpen(false);
    setBusy(a.uuid);
    try {
      const list = await api.selectAccount(a.uuid);
      onSwitched?.(list);
      toast("Playing as " + a.name, "ok");
      setOpen(false);
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy("");
    }
  }
  return (
    <aside className="rail" data-tauri-drag-region>
      <div className="rail-logo" data-tauri-drag-region>
        <img src={logo} alt="" />
        {/* Christmas look: a little Santa hat on the logo */}
        <svg className="xmas-hat" viewBox="0 0 32 26" aria-hidden="true">
          <path d="M4 20 C7 9 13 4 21 5 C25 5.5 27 9 27.5 13 L24 13 C23.5 11 22 9.5 20 9.5 C15 10 11 14 9.5 20 Z" fill="#d42a2a" />
          <path d="M9 13 C12 9 16 7 20 7.5" stroke="#ff6b6b" stroke-width="1.4" fill="none" opacity=".5" />
          <rect x="2" y="18.5" width="17" height="5.5" rx="2.75" fill="#f4f4f2" />
          <circle cx="27" cy="14" r="3.4" fill="#f4f4f2" />
        </svg>
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
        <div className="rail-account-wrap" ref={box}>
        {open && (
          <div className="acc-switch glass">
            {accounts.map((a) => (
              <button key={a.uuid} className={"acc-switch-row" + (a.active ? " on" : "")} disabled={busy !== ""} onClick={() => pick(a)}>
                <Face skin={a.skin_url} name={a.name} size={22} />
                <span>{a.name}</span>
                {a.active ? <Icon name="check" size={13} /> : busy === a.uuid ? <span className="spin-dot" /> : null}
              </button>
            ))}
            <button className="acc-switch-row manage" onClick={() => (setOpen(false), onAccounts())}>
              <Icon name="users" size={15} />
              <span>{accounts.length ? "Add or manage" : "Sign in"}</span>
            </button>
          </div>
        )}
        <button className="rail-account" onClick={() => (accounts.length > 1 ? setOpen(!open) : onAccounts())} title={account ? account.name + " (switch account)" : "Sign in"}>
          <Face skin={account?.skin_url} name={account?.name} size={30} />
          <span className="rail-name">{account ? account.name : "Sign in"}</span>
        </button>
        </div>
      </div>
    </aside>
  );
}
