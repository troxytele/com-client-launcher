import { getCurrentWindow } from "@tauri-apps/api/window";
import Icon from "./Icon";

// Minimize / maximize / close, always visible (the window has no Windows frame).
export default function WindowButtons() {
  const w = getCurrentWindow();
  return (
    <div className="win-btns">
      <button title="Minimize" onClick={() => w.minimize()}>
        <Icon name="min" size={14} />
      </button>
      <button title="Maximize" onClick={() => w.toggleMaximize()}>
        <Icon name="max" size={12} />
      </button>
      <button className="close" title="Close" onClick={() => w.close()}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}
