"use strict";
(() => {
  const REPO = "troxytele/com-client-launcher";
  const RELEASES = `https://github.com/${REPO}/releases`;
  const API = `https://api.github.com/repos/${REPO}/releases`;

  // ---------------------------------------------------------------- tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === tab));
      document.querySelectorAll(".shot").forEach((s) => s.classList.toggle("on", s.dataset.shot === id));
    });
  });

  // ---------------------------------------------------------------- reveal on scroll
  const items = document.querySelectorAll(".feature, .sec-head, .shots, .cos-card, .split-text, .launcher-mock, .launcher-list, .faq details, .download, .stats, .release");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
  }

  // ---------------------------------------------------------------- download button
  const cacheKey = "cc-latest";
  const readCache = () => {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      return c && Date.now() - c.at < 10 * 60 * 1000 ? c : null;
    } catch { return null; }
  };
  const applyLatest = (url, version) => {
    document.querySelectorAll("[data-download]").forEach((a) => {
      a.href = url;
      if (url.endsWith(".exe")) a.setAttribute("download", "");
    });
    if (version) document.querySelectorAll("[data-version]").forEach((s) => { s.textContent = `Version ${version}`; });
  };
  // before anything loads, the buttons point to the releases page
  applyLatest(`${RELEASES}/latest`);

  const cached = readCache();
  if (cached) applyLatest(cached.url, cached.version);
  else {
    fetch(`${API}/latest`, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rel) => {
        const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name) && !/\.sig$/i.test(a.name));
        const msi = (rel.assets || []).find((a) => /\.msi$/i.test(a.name));
        const asset = exe || msi;
        const url = asset ? asset.browser_download_url : rel.html_url;
        const version = String(rel.tag_name || "").replace(/^v/, "");
        if (!/^https:\/\/github\.com\//.test(url)) return;
        applyLatest(url, version);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ url, version, at: Date.now() })); } catch {}
      })
      .catch(() => {});
  }

  // ---------------------------------------------------------------- changelog page
  const list = document.getElementById("releases");
  if (!list) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // tiny, safe markdown: headings, bullet lists, paragraphs. Everything as text, never HTML.
  const strip = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  const renderBody = (md, into) => {
    let ul = null;
    for (const raw of String(md || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { ul = null; continue; }
      if (/^#{1,6}\s/.test(line)) { ul = null; into.append(el("div", "kind", strip(line.replace(/^#+\s*/, "")))); continue; }
      if (/^[-*+]\s/.test(line)) {
        if (!ul) { ul = el("ul"); into.append(ul); }
        ul.append(el("li", null, strip(line.replace(/^[-*+]\s+/, ""))));
        continue;
      }
      ul = null;
      into.append(el("p", "body", strip(line)));
    }
  };

  fetch(`${API}?per_page=30`, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rels) => {
      list.textContent = "";
      const shown = rels.filter((r) => !r.draft);
      if (!shown.length) { list.append(el("p", "loading", "No releases yet.")); return; }
      shown.forEach((rel, i) => {
        const card = el("article", "release glass");
        const head = el("header");
        head.append(el("h3", null, rel.name || rel.tag_name));
        if (i === 0) head.append(el("span", "tag", "LATEST"));
        if (rel.prerelease) head.append(el("span", "tag", "PREVIEW"));
        const t = el("time", null, new Date(rel.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
        t.dateTime = rel.published_at;
        head.append(t);
        card.append(head);
        if (rel.body && rel.body.trim()) renderBody(rel.body, card);
        else card.append(el("p", "body", "Bug fixes and improvements."));
        list.append(card);
      });
    })
    .catch(() => {
      list.textContent = "";
      const p = el("p", "loading", "Couldn't load the changelog right now. ");
      const a = el("a", null, "See it on GitHub");
      a.href = RELEASES;
      a.rel = "noopener";
      p.append(a);
      list.append(p);
    });
})();
