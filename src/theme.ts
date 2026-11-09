// Launcher colours. Black is the default; the others only change the accent + a hint of tint in the background.
export type Theme = {
  id: string;
  name: string;
  bg: string;
  bg2: string;
  surface: string;
  accent: string;
  accent2: string;
  hi: string;
  onAccent: string;
};

export const THEMES: Theme[] = [
  { id: "black", name: "Black", bg: "#000000", bg2: "#0a0a0b", surface: "rgba(14, 14, 16, 0.97)", accent: "#ffffff", accent2: "#bfbfc4", hi: "#ffffff", onAccent: "#050505" },
  { id: "violet", name: "Violet", bg: "#06040b", bg2: "#0d0a16", surface: "rgba(18, 13, 30, 0.97)", accent: "#a77bff", accent2: "#7c4dff", hi: "#c4a6ff", onAccent: "#ffffff" },
  { id: "ocean", name: "Ocean", bg: "#02060c", bg2: "#081120", surface: "rgba(10, 18, 32, 0.97)", accent: "#5aa9ff", accent2: "#2f6fff", hi: "#93c8ff", onAccent: "#ffffff" },
  { id: "rose", name: "Rose", bg: "#0a0408", bg2: "#160912", surface: "rgba(28, 12, 22, 0.97)", accent: "#ff6fae", accent2: "#e8357f", hi: "#ffa3cb", onAccent: "#ffffff" },
  { id: "emerald", name: "Emerald", bg: "#020906", bg2: "#07150f", surface: "rgba(10, 26, 19, 0.97)", accent: "#4fe3a0", accent2: "#17a86b", hi: "#93f2c6", onAccent: "#03140c" },
  { id: "sunset", name: "Sunset", bg: "#0b0603", bg2: "#170d06", surface: "rgba(30, 17, 9, 0.97)", accent: "#ffa24c", accent2: "#ff6a2b", hi: "#ffc387", onAccent: "#1a0b02" },
];

// ---------------------------------------------------------------- custom colour

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]: number[]) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}
function mix(a: number[], b: number[], t: number) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

export function isHex(v: string) {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

/** A whole theme from one colour the player picked. */
export function customTheme(color: string): Theme {
  const c = parse(isHex(color) ? color : "#ff5a6a");
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const s = mix(black, c, 0.11);
  return {
    id: "custom",
    name: "Custom",
    bg: hex(mix(black, c, 0.035)),
    bg2: hex(mix(black, c, 0.075)),
    surface: `rgba(${s.map(Math.round).join(", ")}, 0.97)`,
    accent: hex(c),
    accent2: hex(mix(c, black, 0.22)),
    hi: hex(mix(c, white, 0.38)),
    onAccent: lum > 0.6 ? "#08080a" : "#ffffff",
  };
}

export type Look = { theme: string; stars: boolean; custom: string; festive: boolean };

/** The Christmas look is on by default from November 1 to Twelfth Night (Jan 6). */
export function festiveSeason(d = new Date()) {
  const m = d.getMonth(), day = d.getDate();
  return m === 10 || m === 11 || (m === 0 && day <= 6);
}

const KEY = "look";

export function getLook(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const theme = v.theme === "crimson" ? "custom" : typeof v.theme === "string" ? v.theme : "black";
    return { theme, stars: v.stars !== false, custom: isHex(v.custom) ? v.custom : "#ff5a6a", festive: typeof v.festive === "boolean" ? v.festive : festiveSeason() };
  } catch {
    return { theme: "black", stars: true, custom: "#ff5a6a", festive: festiveSeason() };
  }
}

const listeners = new Set<(l: Look) => void>();

export function onLook(f: (l: Look) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function setLook(l: Look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // storage blocked: still applies for this session
  }
  applyLook(l);
  listeners.forEach((f) => f(l));
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function applyLook(l: Look = getLook()) {
  const t = l.theme === "custom" ? customTheme(l.custom) : THEMES.find((x) => x.id === l.theme) ?? THEMES[0];
  const r = document.documentElement.style;
  r.setProperty("--bg", t.bg);
  r.setProperty("--bg2", t.bg2);
  r.setProperty("--surface", t.surface);
  r.setProperty("--accent", t.accent);
  r.setProperty("--accent-2", t.accent2);
  r.setProperty("--accent-hi", t.hi);
  r.setProperty("--accent-rgb", rgb(t.accent));
  r.setProperty("--accent2-rgb", rgb(t.accent2));
  r.setProperty("--on-accent", t.onAccent);
  document.documentElement.dataset.theme = t.id;
  document.documentElement.classList.toggle("festive", l.festive);
}
