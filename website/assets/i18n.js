// Website translations (German, Spanish, French). The pages are written in English; this swaps every known English
// text (and title / placeholder / aria-label / alt) for the chosen language, including text the page scripts add later.
(() => {
  const LANGS = [["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"]];
  const KEY = "cc-lang";
  const SKIP = "script,style,code,pre,textarea,[translate=no],.notranslate";
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  const memo = new WeakMap();
  let dict = null;
  let templates = [];

  const pick = () => {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && LANGS.some((l) => l[0] === q)) return q;
    try { const s = localStorage.getItem(KEY); if (s && LANGS.some((l) => l[0] === s)) return s; } catch (e) {}
    const sys = (navigator.language || "en").slice(0, 2).toLowerCase();
    return LANGS.some((l) => l[0] === sys) ? sys : "en";
  };
  const lang = pick();

  function tr(text) {
    if (!dict || !text) return text;
    const core = text.replace(/\s+/g, " ").trim();
    if (!core || !/[A-Za-z]/.test(core)) return text;
    let out = dict[core];
    if (out === undefined) {
      for (const t of templates) {
        const m = t.re.exec(core);
        if (m) { out = t.out.replace(/\{(\d)\}/g, (_, i) => tr(m[+i + 1])); break; }
      }
    }
    if (out === undefined) return text;
    return (/^\s/.test(text) ? " " : "") + out + (/\s$/.test(text) ? " " : "");
  }
  function doText(n) {
    const m = memo.get(n);
    if (m && n.data === m) return;
    if (n.parentElement && n.parentElement.closest(SKIP)) return;
    const out = tr(n.data);
    memo.set(n, out);
    if (out !== n.data) n.data = out;
  }
  function doAttrs(el) {
    if (el.closest(SKIP)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v == null) continue;
      const out = tr(v);
      if (out !== v) el.setAttribute(a, out);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }

  function picker() {
    const nav = document.querySelector("header.nav");
    if (!nav || nav.querySelector(".lang-pick")) return;
    const sel = document.createElement("select");
    sel.className = "lang-pick";
    sel.setAttribute("translate", "no");
    sel.setAttribute("aria-label", "Language");
    // phones get the short codes so the bar stays on one line
    const narrow = matchMedia("(max-width: 860px)").matches;
    for (const [id, name] of LANGS) sel.add(new Option(narrow ? id.toUpperCase() : name, id, false, id === lang));
    sel.onchange = () => {
      try { localStorage.setItem(KEY, sel.value); } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.delete("lang");
      location.href = u.toString();
    };
    const dl = nav.querySelector(".btn.primary");
    nav.insertBefore(sel, dl || nav.querySelector(".nav-toggle"));
  }

  function start() {
    picker();
    if (!dict) return;
    walk(document.body);
    document.title = tr(document.title);
    const d = document.querySelector('meta[name="description"]');
    if (d) d.content = tr(d.content);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  const ready = (f) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", f) : f());
  document.documentElement.lang = lang;
  if (lang === "en") return ready(start);
  // hide the page for a moment so English doesn't flash before the translation lands
  const root = document.documentElement;
  root.style.visibility = "hidden";
  const show = () => (root.style.visibility = "");
  const failsafe = setTimeout(show, 1500);
  fetch("/assets/i18n/" + lang + ".json?v=7f06ab25")
    .then((r) => r.json())
    .then((d) => {
      dict = d.exact;
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      templates = Object.entries(d.templates || {}).map(([en, out]) => ({
        re: new RegExp("^" + en.split(/(\{\d\})/).map((p) => (/^\{\d\}$/.test(p) ? "(.+?)" : esc(p))).join("") + "$"),
        out,
      }));
    })
    .catch(() => {})
    .finally(() => ready(() => { start(); clearTimeout(failsafe); show(); }));
})();
