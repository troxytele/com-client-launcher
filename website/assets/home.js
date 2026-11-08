"use strict";
// Home page: news (from the same news.json as the launcher and the game) and live player numbers.
(() => {
  const { NEWS, el, get } = window.CC;
  const list = document.getElementById("news-list");
  if (list) {
    fetch(NEWS, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((items) => {
        list.textContent = "";
        for (const n of items.slice(0, 6)) {
          const a = el("article", "glass");
          const meta = el("div", "meta");
          if (n.tag) meta.append(el("span", null, n.tag));
          if (n.date) meta.append(document.createTextNode(n.date));
          a.append(meta, el("h3", null, n.title), el("p", null, n.body));
          if (n.url && /^https:\/\//.test(n.url)) {
            const link = el("a", null, "Read more →");
            link.href = n.url;
            link.rel = "noopener";
            a.append(link);
          }
          list.append(a);
        }
        if (!items.length) list.append(el("p", "loading", "No news right now."));
      })
      .catch(() => {
        list.textContent = "";
        list.append(el("p", "loading", "Couldn't load the news right now."));
      });
  }
  const stat = document.getElementById("live-stat");
  if (stat) {
    get("/public/stats")
      .then((s) => {
        if (!s.players) return;
        stat.textContent = "";
        const b = el("b", "live");
        b.append(el("i"), document.createTextNode(s.online.toLocaleString()));
        stat.append(b, el("span", null, `online now · ${s.players.toLocaleString()} players`));
      })
      .catch(() => {});
  }
})();
