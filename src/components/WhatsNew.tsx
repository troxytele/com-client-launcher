import { useEffect, useState } from "react";
import Icon from "./Icon";
import { Modal } from "./Ui";

// Shown once after the launcher updated itself. Newest version first.
export const CHANGELOG: { version: string; items: [string, string, string][] }[] = [
  {
    version: "0.6.19",
    items: [["clock", "Play time graphs", "See how long you played each day and each week on the Profiles page, for all profiles or just one."]],
  },
  {
    version: "0.6.18",
    items: [["sparkle", "Points coin", "Points now have their own gold coin everywhere: Locker, prices and the daily deal."]],
  },
  {
    version: "0.6.17",
    items: [
      ["sparkle", "Daily deal", "One cosmetic is 30% off every day. You'll find it at the top of the Locker."],
      ["clock", "Daily reward", "Claim points every day in the game's main menu. The longer your streak, the more you get."],
    ],
  },
  {
    version: "0.6.16",
    items: [["users", "Invite button", "Copy your invite link straight from the Friends page or the Locker."]],
  },
  {
    version: "0.6.15",
    items: [
      ["sparkle", "Points and unlocks", "Earn points by playing, with a daily streak bonus and by inviting friends, then unlock wings, halos, hats, auras and capes in the Locker. A few capes stay free."],
      ["users", "Invite friends", "Your own invite link is in the Locker: you get points when a friend joins with it and plays an hour, and so do they."],
    ],
  },
  {
    version: "0.6.14",
    items: [
      ["bug", "Crashes explained", "When Minecraft crashes, the popup now says what most likely went wrong and what to do, in plain words."],
      ["sparkle", "Quick tour", "New players get three short steps on the first start: sign in, pick a profile, open the Locker."],
    ],
  },
  {
    version: "0.6.13",
    items: [
      ["download", "Bring your old setup", "Profiles → Import → From another launcher: pick an instance from Modrinth App, NoRisk, Lunar, Feather, Prism, CurseForge, ATLauncher, GDLauncher or the Minecraft Launcher, choose what to bring (settings, servers, worlds, packs, shaders, mods) and it becomes a new profile."],
      ["shirt", "Ears in real fur colours", "Cat and dog ears now come in white, cream, golden, ginger, brown, dark brown, grey and black, and the cat ears' pink inside faces the right way."],
    ],
  },
  {
    version: "0.6.12",
    items: [
      ["download", "Import anything", "Profiles → Import (or Mods → Modpacks): drop a .mrpack or .ccprofile on the launcher, pick it, or paste a Modrinth link. You see what it is before it installs."],
    ],
  },
  {
    version: "0.6.11",
    items: [
      ["shirt", "Locker: wings and dog ears", "Wings now sit right on your back, and the dog ears are new: floppy, with pink inside."],
    ],
  },
  {
    version: "0.6.10",
    items: [
      ["user", "Steve when signed out", "Without an account (or without a skin) Home and the Locker show Steve instead of an empty spot."],
    ],
  },
  {
    version: "0.6.9",
    items: [
      ["shirt", "Wings fixed", "In the Locker the wings now sit right on your back, like in game."],
    ],
  },
  {
    version: "0.6.8",
    items: [
      ["bolt", "Faster", "The launcher loads a third of what it did at start, and the game files are checked while the splash is still showing, so Play starts sooner."],
    ],
  },
  {
    version: "0.6.7",
    items: [
      ["flag", "Report and block", "Hover a message in Friends to report it to the Com Client staff, or block someone from the chat header. Blocks work in game and on the website too."],
    ],
  },
  {
    version: "0.6.6",
    items: [
      ["download", "New update screen", "Updates now show a progress ring, download speed, time left and what's new, with Try again if something goes wrong."],
      ["sparkle", "Discord", "Your Discord status has a Download Com Client button now."],
    ],
  },
  {
    version: "0.6.5",
    items: [["sparkle", "Wings fixed in the Locker", "The wings now sit on your back and spread out like in the game, instead of floating flat away from you."]],
  },
  {
    version: "0.6.4",
    items: [
      ["play", "Starts faster", "The launcher checks and downloads the game files in the background and remembers what it already checked, so Play starts right away."],
      ["refresh", "Mod updates", "When your mods, resource packs or shaders have updates, the Mods tab shows how many and the launch bar has an Update all button."],
    ],
  },
  {
    version: "0.6.3",
    items: [
      ["sparkle", "Locker looks like the game", "Wings are held out to the sides and beat like in Com Client, and every wing, halo, hat and aura card shows the same picture as in the game."],
    ],
  },
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
