import { getCurrentWindow } from "@tauri-apps/api/window";
import Icon from "./Icon";

// Our own title bar (the window has no Windows frame): drag anywhere, three buttons on the right.
export default function TitleBar({ version }: { version: string }) {
  const w = getCurrentWindow();
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-name" data-tauri-drag-region>
        COM CLIENT <span>launcher {version && "v" + version}</span>
      </div>
      <div className="titlebar-buttons">
        <button title="Minimize" onClick={() => w.minimize()}>
          <Icon name="min" size={14} />
        </button>
        <button title="Maximize" onClick={() => w.toggleMaximize()}>
          <Icon name="max" size={12} />
        </button>
        <button className="close" title="Close" onClick={() => w.close()}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
