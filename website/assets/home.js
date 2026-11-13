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
        list.removeAttribute("aria-busy");
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
  const loadTop = (tries) => {
    get("/public/leaderboard?by=week")
      .then((d) => {
        top.textContent = "";
        top.removeAttribute("aria-busy");
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
        // the free server sleeps: it takes ~30 s to wake up, so try a few more times before giving up
        if (tries < 3) {
          setTimeout(() => loadTop(tries + 1), 8000);
          return;
        }
        top.textContent = "";
        top.removeAttribute("aria-busy");
        const box = el("div", "top-empty");
        const again = el("button", "btn ghost small", "Try again");
        again.type = "button";
        again.addEventListener("click", () => {
          top.textContent = "";
          top.setAttribute("aria-busy", "true");
          for (let k = 0; k < 5; k++) {
            const r = el("div", "sk-row");
            r.append(el("i"), el("i"), el("i"));
            top.append(r);
          }
          loadTop(0);
        });
        box.append(el("p", "loading", "The leaderboard couldn't load right now."), again);
        top.append(box);
      });
  };
  if (top) loadTop(0);
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
  const fallback3d = () => {
    if (!live || live.classList.contains("fallback")) return;
    live.classList.add("fallback");
    live.querySelector(".sk-3d")?.remove();
    const img = el("img", "live3d-still");
    img.src = "/assets/cosmetics/wings_card/heaven.png";
    img.alt = "Heaven wings";
    live.prepend(img);
    document.getElementById("live3d-name").textContent = "Heaven wings";
  };
  if (live && !window.CCViewer) fallback3d();
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
      try {
        viewer = window.CCViewer.create(canvas, { width: live.clientWidth, height: live.clientHeight });
      } catch {
        fallback3d(); // no WebGL: a still picture instead of an empty box
        return;
      }
      setTimeout(() => live.classList.add("ready"), 600);
      new ResizeObserver(() => viewer.setSize(live.clientWidth, live.clientHeight)).observe(live);
      viewer.setSkin(window.CC.STEVE, false);
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
        const st = document.getElementById("stat-players");
        if (st) {
          const b = st.querySelector("b");
          b.dataset.count = String(s.players);
          st.hidden = false;
          st.parentElement.classList.add("five");
          if (window.CCCount) window.CCCount(b);
        }
        pill.querySelector("span").textContent = s.online > 0 ? `${s.online.toLocaleString()} playing right now` : `${s.players.toLocaleString()} players on Com Client`;
        if (!s.online) pill.querySelector("i").hidden = true;
        pill.hidden = false;
      })
      .catch(() => {});
  }
})();
