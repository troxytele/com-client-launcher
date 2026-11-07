import { useEffect, useState } from "react";
import { api, msg, OptimisePlan, Profile } from "../api";
import { toast } from "../stores";
import Icon from "./Icon";
import { Modal, Spinner, Switch } from "./Ui";

const NAMES: Record<string, string> = {
  renderDistance: "Render distance",
  simulationDistance: "Simulation distance",
  graphicsMode: "Graphics",
  maxFps: "Max FPS",
  enableVsync: "VSync",
  entityShadows: "Entity shadows",
  particles: "Particles",
  ao: "Smooth lighting",
  biomeBlendRadius: "Biome blend",
  renderClouds: "Clouds",
  mipmapLevels: "Mipmap levels",
  entityDistanceScaling: "Entity distance",
};

function pretty(key: string, v: string) {
  const s = v.replace(/"/g, "");
  if (key === "graphicsMode") return ["Fast", "Fancy", "Fabulous"][Number(s)] ?? s;
  if (key === "particles") return ["All", "Decreased", "Minimal"][Number(s)] ?? s;
  if (key === "maxFps") return s === "260" ? "Unlimited" : s;
  if (key === "renderDistance" || key === "simulationDistance") return s + " chunks";
  if (key === "entityDistanceScaling") return Math.round(Number(s) * 100) + "%";
  if (s === "true") return "On";
  if (s === "false") return "Off";
  if (s === "fast") return "Fast";
  return s;
}

const TIER: Record<string, string> = {
  high: "Strong PC: high settings with lots of FPS",
  medium: "Good PC: balanced settings",
  low: "Lighter PC: settings for the most FPS",
};

// Auto-optimise: checks the PC, then sets memory, performance mods and video settings for one profile.
export default function Optimise({ profile, onClose, onDone }: { profile: Profile; onClose: () => void; onDone: (list: Profile[]) => void }) {
  const [plan, setPlan] = useState<OptimisePlan | null>(null);
  const [video, setVideo] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.optimiseScan().then(setPlan).catch((e) => toast(msg(e), "error"));
  }, []);

  async function apply() {
    setBusy(true);
    try {
      const list = await api.optimiseApply(profile.id, video);
      toast(`${profile.name} is optimised`, "ok");
      onDone(list);
      onClose();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={"Auto-optimise " + profile.name} onClose={onClose} width={520}>
      {!plan ? (
        <div className="center pad">
          <Spinner /> <span className="muted">&nbsp; Checking your PC…</span>
        </div>
      ) : (
        <>
          <div className="opt-pc">
            <div>
              <Icon name="memory" size={16} />
              <b>{(plan.ram_total_mb / 1024).toFixed(0)} GB</b>
              <span>memory</span>
            </div>
            <div>
              <Icon name="cube" size={16} />
              <b>{plan.cores} threads</b>
              <span title={plan.cpu}>{plan.cpu || "processor"}</span>
            </div>
            <div>
              <Icon name="sparkle" size={16} />
              <b>{plan.gpu_kind === "dedicated" ? "Graphics card" : plan.gpu_kind === "integrated" ? "Built-in graphics" : "Graphics"}</b>
              <span title={plan.gpu}>{plan.gpu || "unknown"}</span>
            </div>
          </div>
          <p className={"opt-tier " + plan.tier}>
            <Icon name="bolt" size={15} /> {TIER[plan.tier]}
          </p>
          <div className="opt-list">
            <div className="opt-row">
              <span>Memory for the game</span>
              <b>
                {(profile.ram_mb / 1024).toFixed(1)} GB → {(plan.ram_mb / 1024).toFixed(1)} GB
              </b>
            </div>
            <div className="opt-row">
              <span>Performance mods (Sodium, Lithium, FerriteCore, EntityCulling)</span>
              <b>{profile.performance_mods ? "On (stays on)" : "Off → On"}</b>
            </div>
            <div className="opt-row head">
              <span>Video settings</span>
              <Switch on={video} onChange={setVideo} />
            </div>
            {video &&
              plan.video.map(([k, v]) => (
                <div key={k} className="opt-row sub">
                  <span>{NAMES[k] ?? k}</span>
                  <b>{pretty(k, v)}</b>
                </div>
              ))}
          </div>
          <p className="muted small">Your other settings (keys, sound, FOV …) stay as they are. You can change everything again in game.</p>
          <div className="block-foot">
            <span className="grow" />
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={apply}>
              {busy ? <Spinner size={13} /> : <Icon name="bolt" size={14} />} Optimise
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
