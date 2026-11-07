import { useEffect, useState } from "react";
import Icon from "./Icon";
import { Modal } from "./Ui";

// Shown once after the launcher updated itself. Newest version first.
export const CHANGELOG: { version: string; items: [string, string, string][] }[] = [
  {
    version: "0.6.2",
    items: [
      ["sparkle", "Locker fixed", "Cape names and pictures show properly again, and picking one of the official capes works."],
      ["users", "Friends fixed", "Signing in to Com Client no longer fails when the page loads or while the game is running."],
    ],
  },
  {
    version: "0.6.1",
    items: [
      ["terminal", "Logs window", "A separate window with the game's log (colours, filters, search), its memory and CPU, and one-click upload to mclo.gs. Turn it on in Settings, or open it from the Logs page."],
    ],
  },
  {
    version: "0.6.0",
    items: [
      ["image", "Gallery", "Every screenshot from all your profiles in one grid: open, copy, share or delete them."],
      ["film", "Replays", "Your ReplayMod recordings, with a Watch button that starts the game straight into one."],
      ["users", "Friends", "Who's online and on which server, Join them with one click, and chat right from the launcher."],
      ["box", "Modpacks", "Mods → Modpacks: install a whole Modrinth modpack as a new profile in one click."],
      ["sparkle", "Locker", "Browse and wear capes, wings, halos, hats and auras, tried on your own skin in 3D. All free for now."],
      ["bolt", "Auto-optimise", "On the Profiles page: checks your PC and picks the memory, performance mods and video settings."],
    ],
  },
  {
    version: "0.5.1",
    items: [["edit", "Rename profiles", "Click a profile's name (or Rename) on the Profiles page, or double-click it in the list, then type the new name."]],
  },
  {
    version: "0.5.0",
    items: [
      ["layers", "Profiles", "A new Profiles page: names, Minecraft block or item icons (or your own picture), duplicate, export and import."],
      ["globe", "Quick join", "Pin servers to a profile. They sit next to PLAY: one click starts the game and joins."],
      ["clock", "Play time", "Total hours, time per profile, your last sessions and the past two weeks."],
      ["sparkle", "Custom colour", "Pick any accent colour you like in Settings → Appearance."],
      ["min", "Tray", "While you play, the launcher waits in the system tray and comes back when you quit."],
      ["volume", "Sounds", "Soft click and hover sounds, the same as in game. Switch them off in Settings."],
    ],
  },
];

const KEY = "seenVersion";

export default function WhatsNew({ version }: { version: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(KEY);
      localStorage.setItem(KEY, version);
    } catch {
      return;
    }
    // a brand-new install doesn't need a list of changes; an update does
    const hasNotes = CHANGELOG.some((c) => c.version === version);
    if (hasNotes && seen !== version && (seen !== null || localStorage.getItem("look") !== null)) setShow(true);
  }, [version]);
  if (!show) return null;
  const notes = CHANGELOG.find((c) => c.version === version)!;
  return (
    <Modal title={"What's new in " + version} onClose={() => setShow(false)} width={520}>
      <div className="whatsnew">
        {notes.items.map(([icon, title, text]) => (
          <div key={title} className="wn-item">
            <span className="wn-icon">
              <Icon name={icon} size={17} />
            </span>
            <div>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="block-foot">
        <span className="grow" />
        <button className="btn primary" onClick={() => setShow(false)}>
          Nice <Icon name="arrowRight" size={13} />
        </button>
      </div>
    </Modal>
  );
}
