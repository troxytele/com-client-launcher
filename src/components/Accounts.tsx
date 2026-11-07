import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Account, api, DeviceCode, msg } from "../api";
import { toast } from "../stores";
import Face from "./Face";
import Icon from "./Icon";
import { Modal, Spinner } from "./Ui";

// Accounts: switch, remove, add with the Microsoft window (or with a code on microsoft.com/link).
export default function Accounts({ accounts, onChange, onClose }: { accounts: Account[]; onChange: (a: Account[]) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const polling = useRef(false);

  useEffect(() => () => void (polling.current = false), []);

  async function addWindow() {
    setBusy(true);
    try {
      const a = await api.login();
      onChange(a);
      toast("Signed in as " + (a.find((x) => x.active)?.name ?? ""), "ok");
    } catch (e) {
      const m = msg(e);
      if (!m.includes("window closed")) toast(m, "error");
    } finally {
      setBusy(false);
    }
  }

  async function addCode() {
    setBusy(true);
    try {
      const c = await api.deviceStart();
      setCode(c);
      polling.current = true;
      const until = Date.now() + c.expires_in * 1000;
      while (polling.current && Date.now() < until) {
        await new Promise((r) => setTimeout(r, Math.max(2, c.interval) * 1000));
        if (!polling.current) break;
        const a = await api.devicePoll(c.device_code);
        if (a) {
          onChange(a);
          toast("Signed in as " + (a.find((x) => x.active)?.name ?? ""), "ok");
          break;
        }
      }
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      polling.current = false;
      setCode(null);
      setBusy(false);
    }
  }

  return (
    <Modal title="Accounts" onClose={onClose}>
      <div className="acc-list">
        {accounts.length === 0 && <p className="muted">Sign in with the Microsoft account that owns Minecraft.</p>}
        {accounts.map((a) => (
          <div key={a.uuid} className={"acc-row" + (a.active ? " active" : "")} onClick={() => api.selectAccount(a.uuid).then(onChange)}>
            <Face skin={a.skin_url} name={a.name} size={34} />
            <div className="acc-name">
              <b>{a.name}</b>
              <span>{a.active ? "Playing as this account" : "Click to switch"}</span>
            </div>
            {a.active && <Icon name="check" className="accent" />}
            <button
              className="icon-btn danger"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                api.removeAccount(a.uuid).then(onChange);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </div>
      {code ? (
        <div className="device-code">
          <p>
            Open <a onClick={() => openUrl(code.verification_uri)}>{code.verification_uri.replace("https://", "")}</a> and enter
          </p>
          <div className="code" onClick={() => navigator.clipboard.writeText(code.user_code).then(() => toast("Code copied"))}>
            {code.user_code}
            <Icon name="copy" size={15} />
          </div>
          <p className="muted small">
            <Spinner size={11} /> Waiting for you to sign in…
          </p>
          <button className="btn" onClick={() => (polling.current = false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="acc-add">
          <button className="btn primary" disabled={busy} onClick={addWindow}>
            {busy ? <Spinner /> : <Icon name="plus" size={16} />} Add Microsoft account
          </button>
          <button className="btn ghost small" disabled={busy} onClick={addCode}>
            Sign in with a code instead
          </button>
        </div>
      )}
    </Modal>
  );
}
