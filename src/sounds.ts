// Little UI sounds (the same click/hover as in the game). Off with one switch in Settings.
import clickUrl from "./assets/sounds/click.ogg";
import hoverUrl from "./assets/sounds/hover.ogg";

export type SoundPrefs = { on: boolean; volume: number };
const KEY = "sounds";

export function getSounds(): SoundPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { on: v.on !== false, volume: typeof v.volume === "number" ? v.volume : 0.45 };
  } catch {
    return { on: true, volume: 0.45 };
  }
}

export function setSounds(p: SoundPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
  prefs = p;
}

let prefs = getSounds();
let ctx: AudioContext | null = null;
const buffers: Record<string, AudioBuffer | null> = {};
let lastHover = 0;

async function load(url: string) {
  if (url in buffers) return buffers[url];
  buffers[url] = null;
  try {
    ctx ??= new AudioContext();
    const data = await (await fetch(url)).arrayBuffer();
    buffers[url] = await ctx.decodeAudioData(data);
  } catch {
    // no audio here: stay quiet
  }
  return buffers[url];
}

function play(url: string, vol: number) {
  if (!prefs.on || prefs.volume <= 0) return;
  const b = buffers[url];
  if (!b || !ctx) {
    load(url);
    return;
  }
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = prefs.volume * vol;
  src.buffer = b;
  src.connect(g).connect(ctx.destination);
  src.start();
}

export const sfx = {
  click: () => play(clickUrl, 1),
  hover: () => {
    const now = performance.now();
    if (now - lastHover < 60) return;
    lastHover = now;
    play(hoverUrl, 0.5);
  },
};

const CLICKABLE = "button:not(:disabled), .theme-swatch, select, .news-card.link, [role=switch], .pcard";

/** One listener for the whole window: every button clicks and hovers. */
export function installSounds() {
  load(clickUrl);
  load(hoverUrl);
  document.addEventListener(
    "pointerdown",
    (e) => {
      if ((e.target as HTMLElement).closest?.(CLICKABLE)) sfx.click();
    },
    true,
  );
  let over: Element | null = null;
  document.addEventListener(
    "pointerover",
    (e) => {
      const el = (e.target as HTMLElement).closest?.(CLICKABLE) ?? null;
      if (el && el !== over) sfx.hover();
      over = el;
    },
    true,
  );
}
