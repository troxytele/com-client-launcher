import { useState } from "react";
import Icon from "./Icon";

const KEY = "tourDone";

/** True on the very first start (no earlier version seen, no tour done). Read before WhatsNew stores the version. */
export function firstRun(): boolean {
  try {
    return localStorage.getItem(KEY) === null && localStorage.getItem("seenVersion") === null && localStorage.getItem("look") === null;
  } catch {
    return false;
  }
}

function done() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: just show it again next time */
  }
}

type Step = { icon: string; title: string; text: string; action: string; run: () => void };

/** Three quick screens on the first start: sign in, pick a profile, open the Locker. */
export default function Tour({
  signedIn,
  name,
  onSignIn,
  onProfiles,
  onLocker,
  onClose,
}: {
  signedIn: boolean;
  name: string | null;
  onSignIn: () => void;
  onProfiles: () => void;
  onLocker: () => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const finish = () => {
    done();
    onClose();
  };
  const steps: Step[] = [
    {
      icon: "user",
      title: "Sign in with Microsoft",
      text: signedIn
        ? `You're signed in as ${name ?? "your account"}. You can add more accounts any time from the bottom left.`
        : "Use the Microsoft account that owns Minecraft. Your password is never seen by Com Client: you sign in on Microsoft's own page.",
      action: signedIn ? "Next" : "Sign in",
      run: () => {
        if (!signedIn) onSignIn();
        setI(1);
      },
    },
    {
      icon: "layers",
      title: "Pick a profile",
      text: "Each profile has its own mods, worlds and settings. “Com Client” is ready to play; make more for modpacks or other setups.",
      action: "Open Profiles",
      run: () => {
        onProfiles();
        setI(2);
      },
    },
    {
      icon: "sparkle",
      title: "Open the Locker",
      text: "Capes, wings, halos, hats and auras. Try them on your own skin in 3D; other Com Client players see what you wear.",
      action: "Open Locker",
      run: () => {
        onLocker();
        finish();
      },
    },
  ];
  const s = steps[i];
  return (
    <div className="modal-back tour-back">
      <div className="modal glass tour" style={{ width: 440 }}>
        <div className="tour-icon">
          <Icon name={s.icon} size={26} />
        </div>
        <span className="tour-count">
          Step {i + 1} of {steps.length}
        </span>
        <h3>{s.title}</h3>
        <p className="muted">{s.text}</p>
        <div className="tour-dots">
          {steps.map((_, k) => (
            <button key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} title={`Step ${k + 1}`} />
          ))}
        </div>
        <div className="block-foot">
          <button className="btn ghost" onClick={finish}>
            Skip
          </button>
          <span className="grow" />
          {i > 0 && (
            <button className="btn ghost" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn primary" onClick={s.run}>
            {s.action}
          </button>
        </div>
      </div>
    </div>
  );
}
