import { getCurrentWindow } from "@tauri-apps/api/window";
import logo from "../assets/logo.png";

// Start-up animation: the logo draws in with an expanding ring, the name spells out, a thin line fills,
// then the whole thing fades away and the launcher slides in behind it.
export default function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className={"splash" + (leaving ? " leaving" : "")} data-tauri-drag-region>
      <button className="splash-close" title="Close" onClick={() => getCurrentWindow().close()}>
        ×
      </button>
      <div className="splash-mark">
        <i className="ring r1" />
        <i className="ring r2" />
        <img src={logo} alt="" />
      </div>
      <div className="splash-name">
        {"COM CLIENT".split("").map((ch, i) => (
          <span key={i} style={{ animationDelay: 0.45 + i * 0.05 + "s" }}>
            {ch === " " ? " " : ch}
          </span>
        ))}
      </div>
      <div className="splash-line">
        <div />
      </div>
    </div>
  );
}
