// Small building blocks: switch, slider, modal, toasts.
import { ReactNode, useEffect } from "react";
import { useToasts } from "../stores";
import Icon from "./Icon";

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button className={"switch" + (on ? " on" : "")} disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span />
    </button>
  );
}

export function Modal({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass" style={{ width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.kind}>
          <Icon name={t.kind === "error" ? "alert" : t.kind === "ok" ? "check" : "sparkle"} size={15} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
