"use strict";
// comclient.xyz/changelog: launcher releases newer than the hand-written list, straight from GitHub
// (their notes are the "- " lines of the commits, "Title: text").
(() => {
  const list = document.querySelector(".releases");
  if (!list) return;
  const newest = (list.querySelector("h3")?.textContent || "").replace(/[^\d.]/g, "");
  const parts = (v) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const newer = (a, b) => {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  fetch("https://api.github.com/repos/troxytele/com-client-launcher/releases?per_page=30", { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rels) => {
      const fresh = rels
        .filter((r) => !r.draft && !r.prerelease)
        .map((r) => ({ v: String(r.tag_name || "").replace(/^v/, ""), at: r.published_at, notes: String(r.body || "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()) }))
        .filter((r) => r.notes.length && newer(r.v, newest));
      if (!fresh.length) return;
      list.querySelectorAll(".tag").forEach((t) => t.textContent === "LATEST" && t.remove());
      fresh.forEach((r, i) => {
        const a = el("article", "release glass");
        const h = el("header");
        h.append(el("h3", null, "Launcher " + r.v));
        if (i === 0) h.append(el("span", "tag", "LATEST"));
        const t = el("time", null, new Date(r.at).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" }));
        t.dateTime = String(r.at).slice(0, 10);
        h.append(t);
        const ul = el("ul");
        r.notes.forEach((n) => {
          const li = el("li");
          const k = n.indexOf(": ");
          if (k > 0 && k < 48) li.append(el("b", null, n.slice(0, k)), document.createTextNode(" · " + n.slice(k + 2)));
          else li.textContent = n;
          ul.append(li);
        });
        a.append(h, ul);
        list.insertBefore(a, list.children[i]);
      });
    })
    .catch(() => {});
})();
