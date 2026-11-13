// Launcher translations (German, Spanish, French).
//
// The UI is written in English. Instead of threading a t() call through every component, the text the launcher
// shows is translated where it lands: a MutationObserver looks at every text node and every title / placeholder /
// aria-label and swaps known English strings for the chosen language. React keeps working on its own virtual DOM,
// so when it writes a new English string the observer simply translates that one too.
//
// The dictionaries (src/i18n/<lang>.json) have two parts:
//   exact      English text -> translation
//   templates  English with {0}, {1} ... for the parts that change -> translation using the same numbers

export type Lang = "en" | "de" | "es" | "fr";
export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
];

type Dict = { exact: Record<string, string>; templates: Record<string, string> };
type Compiled = { exact: Map<string, string>; templates: { re: RegExp; out: string }[] };

const KEY = "cc-lang";
const loaders: Record<Exclude<Lang, "en">, () => Promise<{ default: Dict }>> = {
  de: () => import("./i18n/de.json"),
  es: () => import("./i18n/es.json"),
  fr: () => import("./i18n/fr.json"),
};

let lang: Lang = "en";
let dict: Compiled | null = null;
const listeners = new Set<(l: Lang) => void>();

/** Text we must never touch: logs, chat messages, things people typed. */
const SKIP = "script,style,textarea,code,pre,[translate=no],.notranslate,.ll,.console > div:not(.muted),.msg,.lw-console";
const ATTRS = ["title", "placeholder", "aria-label", "alt"];

const textMemo = new WeakMap<Text, { orig: string; out: string }>();
const attrMemo = new WeakMap<Element, Record<string, { orig: string; out: string }>>();

const UNIT = /^ ?(h|min|d|s|days|months|mods|worlds|packs|points|games|lines|update|more|of)\b/;

function compile(d: Dict): Compiled {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const templates = Object.entries(d.templates)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([en, out]) => {
      const order: number[] = [];
      const src: (string | null)[] = en.split(/(\{\d\})/).map((part) => {
        const m = /^\{(\d)\}$/.exec(part);
        if (!m) return esc(part);
        order.push(+m[1]);
        return null;
      });
      // a number followed by a unit ("3 h ago", "12 mods") must only match the number, or "Last played 3 h ago"
      // would be read as "{Last played 3} h ago"
      const parts = en.split(/(\{\d\})/);
      src.forEach((p, i) => {
        if (p !== null) return;
        const next = parts[i + 1] || "";
        src[i] = UNIT.test(next) ? "([\\d.,]+)" : "(.+?)";
      });
      const re = new RegExp("^" + src.join("") + "$", "s");
      // remember which capture is which number, then rewrite the output to use capture positions
      let o = out;
      order.forEach((n, i) => (o = o.split("{" + n + "}").join("\u0000" + i + "\u0000")));
      return { re, out: o };
    });
  return { exact: new Map(Object.entries(d.exact)), templates };
}

/** Translates one piece of UI text (keeps the spaces around it). Unknown text comes back unchanged. */
export function tr(text: string): string {
  if (!dict || !text) return text;
  const core = text.replace(/\s+/g, " ").trim();
  if (!core || !/[A-Za-z]/.test(core)) return text;
  let out = dict.exact.get(core);
  if (out === undefined) {
    for (const t of dict.templates) {
      const m = t.re.exec(core);
      if (m) {
        // the changing parts can be known text themselves ("14 days", "Never")
        out = t.out.replace(/\u0000(\d+)\u0000/g, (_, i) => tr(m[+i + 1]));
        break;
      }
    }
  }
  if (out === undefined) return text;
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  return (lead ? " " : "") + out + (trail ? " " : "");
}

function skipped(el: Element | null): boolean {
  return !!el && !!el.closest(SKIP);
}

function doText(n: Text) {
  const memo = textMemo.get(n);
  if (memo && n.data === memo.out) return; // already ours
  if (skipped(n.parentElement)) return;
  const orig = n.data;
  const out = tr(orig);
  textMemo.set(n, { orig, out });
  if (out !== orig) n.data = out;
}

function doAttrs(el: Element) {
  if (skipped(el)) return;
  let memo = attrMemo.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    const m = memo?.[a];
    if (m && v === m.out) continue;
    const out = tr(v);
    if (!memo) attrMemo.set(el, (memo = {}));
    memo[a] = { orig: v, out };
    if (out !== v) el.setAttribute(a, out);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (skipped(el)) return;
  doAttrs(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

/** Puts every translated string back to its English original (before switching language). */
function restore(root: Node) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const m = textMemo.get(t);
      if (m && t.data === m.out && m.out !== m.orig) t.data = m.orig;
      textMemo.delete(t);
    } else {
      const el = n as Element;
      const memo = attrMemo.get(el);
      if (memo) for (const a in memo) if (el.getAttribute(a) === memo[a].out) el.setAttribute(a, memo[a].orig);
      attrMemo.delete(el);
    }
  }
}

let observer: MutationObserver | null = null;
function observe() {
  if (observer) return;
  observer = new MutationObserver((list) => {
    if (!dict) return;
    for (const m of list) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes") doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

export function getLang(): Lang {
  return lang;
}

function guess(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && LANGS.some((l) => l.id === saved)) return saved;
  } catch {
    /* storage can be unavailable */
  }
  const sys = (navigator.language || "en").slice(0, 2).toLowerCase();
  return (LANGS.some((l) => l.id === sys) ? sys : "en") as Lang;
}

export async function setLang(next: Lang, save = true) {
  if (save) {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }
  if (next === lang && (next === "en" || dict)) return;
  const d = next === "en" ? null : compile((await loaders[next]()).default);
  if (dict) restore(document.body);
  lang = next;
  dict = d;
  document.documentElement.lang = next;
  if (dict) {
    observe();
    walk(document.body);
  }
  listeners.forEach((f) => f(next));
}

export function onLang(f: (l: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Call once at start-up. Picks the saved language (or the system's, the first time). */
export function installI18n(): Promise<void> {
  // other windows (the logs window) follow a change made in the main window
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue) setLang(e.newValue as Lang, false);
  });
  return setLang(guess(), false);
}
