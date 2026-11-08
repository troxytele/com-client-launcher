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
        for (const n of items.slice(0, 3)) {
          const a = el("article", "glass");
          const meta = el("div", "meta");
          if (n.tag) meta.append(el("span", null, n.tag));
          if (n.date) meta.append(document.createTextNode(n.date));
          a.append(meta, el("h3", null, n.title), el("p", null, n.body));
          if (n.url && /^https:\/\//.test(n.url)) {
            const link = el("a", null, "Read more");
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
  // ---- most played this week
  const top = document.getElementById("top-week");
  if (top) {
    get("/public/leaderboard?by=week")
      .then((d) => {
        top.textContent = "";
        const rows = d.rows.filter((r) => r.week_seconds > 0).slice(0, 5);
        if (!rows.length) {
          top.append(el("p", "loading", "Nobody played yet this week. Be the first!"));
          return;
        }
        rows.forEach((r, i) => {
          const a = el("a", "top-row");
          a.href = window.CC.profileUrl(r);
          a.append(el("span", "rank", String(i + 1)));
          if (r.avatar) {
            const img = el("img", "face");
            img.src = window.CC.avatarUrl(r.uuid, r.avatar);
            img.alt = "";
            a.append(img);
          } else a.append(window.CC.face(r.uuid, 30));
          const n = el("b", null, r.name);
          n.append(window.CC.roleBadges(r.roles));
          a.append(n, el("span", "value", window.CC.hours(r.week_seconds)));
          top.append(a);
        });
      })
      .catch(() => {
        top.textContent = "";
        top.append(el("p", "loading", "The leaderboard is waking up, try again in a moment."));
      });
  }
  const find = document.getElementById("home-find");
  if (find) {
    find.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = document.getElementById("home-find-name").value.trim().replace(/^@/, "");
      if (v) location.href = "/u/" + encodeURIComponent(v);
    });
  }

  // ---- a 3D player that keeps trying on different cosmetics
  const live = document.getElementById("live3d");
  if (live && window.CCViewer) {
    const canvas = live.querySelector("canvas");
    let viewer = null;
    const LOOKS = [
      ["Heaven wings + ring halo", { wings: "heaven", halo: "ring", haloColor: 0xffe07a, hat: "none", aura: "sparkles", auraColor: 0xffe07a }],
      ["Devil wings + crown", { wings: "devil", halo: "crown", haloColor: 0xff4d5e, hat: "none", aura: "embers", auraColor: 0xff8a3d }],
      ["Purple wings + cat ears", { wings: "purple", halo: "none", hat: "cat_ears", hatColor: 0x2a2a33, aura: "helix", auraColor: 0xb9a6ff }],
      ["Blue dragon + orbit halo", { wings: "blue_dragon", halo: "orbit", haloColor: 0x5aa9ff, hat: "none", aura: "sparkles", auraColor: -1 }],
      ["Gold crown + rainbow aura", { wings: "none", halo: "double", haloColor: 0xffffff, hat: "crown", aura: "helix", auraColor: -1 }],
    ];
    let i = 0;
    const show = () => {
      const [name, look] = LOOKS[i++ % LOOKS.length];
      viewer.setLook({ cape: "none", ...look }, null, look.wings !== "none" ? `/assets/cosmetics/${look.wings}.png` : null);
      document.getElementById("live3d-name").textContent = name;
    };
    const start = () => {
      if (viewer) return;
      viewer = window.CCViewer.create(canvas, { width: live.clientWidth, height: live.clientHeight });
      new ResizeObserver(() => viewer.setSize(live.clientWidth, live.clientHeight)).observe(live);
      viewer.setSkin("/assets/cosmetics/default-skin.png", false);
      show();
      setInterval(show, 4500);
    };
    // only build the 3D scene once it scrolls into view
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((e) => {
        if (e[0].isIntersecting) {
          io.disconnect();
          start();
        }
      }, { rootMargin: "200px" });
      io.observe(live);
    } else start();
  }

  // ---- live: how many people play right now
  const pill = document.getElementById("live-pill");
  if (pill) {
    get("/public/stats")
      .then((s) => {
        if (!s.players) return;
        pill.querySelector("span").textContent = s.online > 0 ? `${s.online.toLocaleString()} playing now` : `${s.players.toLocaleString()} players`;
        if (!s.online) pill.querySelector("i").hidden = true;
        pill.hidden = false;
      })
      .catch(() => {});
  }
})();
