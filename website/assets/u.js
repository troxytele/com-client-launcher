"use strict";
// comclient.xyz/u/<name>: a player's public profile.
(() => {
  const { API, el, get, hours, roleBadges, face, avatarUrl, ROLES } = window.CC;
  const $ = (id) => document.getElementById(id);
  const path = location.pathname.startsWith("/u/") ? location.pathname.slice(3).replace(/\/$/, "") : "";
  const who = decodeURIComponent(path) || new URLSearchParams(location.search).get("name") || "";

  const SOCIAL = {
    instagram: (v) => "https://instagram.com/" + v,
    snapchat: (v) => "https://snapchat.com/add/" + v,
    tiktok: (v) => "https://tiktok.com/@" + v.replace(/^@/, ""),
    youtube: (v) => "https://youtube.com/@" + v.replace(/^@/, ""),
    twitch: (v) => "https://twitch.tv/" + v,
    x: (v) => "https://x.com/" + v.replace(/^@/, ""),
    github: (v) => "https://github.com/" + v,
    steam: (v) => "https://steamcommunity.com/id/" + v,
    telegram: (v) => "https://t.me/" + v.replace(/^@/, ""),
    reddit: (v) => "https://reddit.com/u/" + v.replace(/^u\//, ""),
    kick: (v) => "https://kick.com/" + v,
    soundcloud: (v) => "https://soundcloud.com/" + v,
    roblox: (v) => "https://www.roblox.com/search/users?keyword=" + encodeURIComponent(v),
  };
  const COPY_ONLY = new Set(["discord", "bitcoin", "litecoin", "ethereum", "solana", "monero", "usdt"]);

  function linkFor(type, value) {
    if (/^https:\/\//i.test(value)) return value;
    if (COPY_ONLY.has(type)) return null;
    if (type === "website") return /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value) ? "https://" + value : null;
    if (type === "spotify") return null;
    const f = SOCIAL[type];
    return f && /^[\w.@\-/]+$/.test(value) ? f(encodeURI(value)) : null;
  }

  function stat(label, value) {
    const d = el("div", "p-stat glass");
    d.append(el("b", null, value), el("span", null, label));
    return d;
  }

  function fail(text) {
    $("p-name").textContent = text;
    $("p-sub").textContent = "";
    document.title = "Player not found · Com Client";
    $("profile").classList.add("missing");
  }

  if (!who) {
    fail("No player given");
    return;
  }

  get("/public/player/" + encodeURIComponent(who))
    .then((p) => {
      document.title = `${p.name} · Com Client`;
      if (p.username && !location.pathname.endsWith("/" + p.username)) history.replaceState(null, "", "/u/" + encodeURIComponent(p.username));

      // ---- banner (their page background), photo, names
      if (p.bg) $("p-banner").style.backgroundImage = `url("${API}/page/${p.uuid}/background?v=${p.bg}")`;
      else $("p-banner").classList.add("plain");
      const av = $("p-avatar");
      if (p.avatar) {
        const img = el("img");
        img.src = avatarUrl(p.uuid, p.avatar);
        img.alt = "";
        av.append(img);
      } else av.append(face(p.uuid, 72));
      $("p-name").textContent = p.name;
      const sub = [];
      if (p.username) sub.push("@" + p.username);
      sub.push(`Level ${p.level} · ${p.title}`);
      $("p-sub").textContent = sub.join(" · ");
      $("p-roles").append(roleBadges(p.roles, true));

      if (p.bio) {
        $("p-bio").textContent = p.bio;
        $("p-bio").hidden = false;
      }

      // ---- socials
      for (const s of p.socials || []) {
        const href = linkFor(s.type, s.value);
        const a = el(href ? "a" : "button", "p-social glass");
        if (href) {
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener nofollow";
        } else {
          a.type = "button";
          a.title = "Copy";
          a.addEventListener("click", () => {
            navigator.clipboard?.writeText(s.value);
            a.classList.add("copied");
            setTimeout(() => a.classList.remove("copied"), 1200);
          });
        }
        const icon = el("img");
        icon.src = `/assets/social/${s.type}.png`;
        icon.alt = "";
        a.append(icon, el("span", null, s.value.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)));
        $("p-socials").append(a);
      }

      // ---- numbers
      const since = new Date(p.since * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" });
      $("p-stats").append(
        stat("played", hours(p.play_seconds)),
        stat("days played", p.days_played.toLocaleString()),
        stat("best streak", p.best_streak + (p.best_streak === 1 ? " day" : " days")),
        stat("friends", p.friends.toLocaleString()),
        stat("member since", since),
      );

      // ---- level progress
      const lv = $("p-level");
      const span = Math.max(1, p.level_end - p.level_start);
      const pct = Math.min(100, Math.max(0, ((p.play_seconds - p.level_start) / span) * 100));
      lv.append(el("b", null, `Level ${p.level}`), el("span", "muted", `${hours(p.level_end - p.play_seconds)} to level ${p.level + 1}`));
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = pct.toFixed(1) + "%";
      bar.append(fill);
      lv.append(bar);
      lv.hidden = false;

      // ---- last 7 days
      const wk = $("p-week");
      const max = Math.max(1, ...p.week);
      wk.append(el("h3", null, "Last 7 days"));
      const bars = el("div", "week");
      p.week.forEach((secs, i) => {
        const d = new Date(Date.now() - (6 - i) * 86400000);
        const col = el("div");
        col.title = hours(secs);
        const b = el("i");
        b.style.height = Math.max(4, (secs / max) * 100) + "%";
        if (!secs) b.className = "zero";
        col.append(b, el("span", null, d.toLocaleDateString(undefined, { weekday: "short" })));
        bars.append(col);
      });
      wk.append(bars);
      wk.hidden = false;

      // ---- PvP tiers
      const lists = Object.entries(p.tiers || {});
      if (lists.length) {
        const t = $("p-tiers");
        t.append(el("h3", null, "PvP tiers"));
        for (const [list, modes] of lists) {
          const row = el("div", "tier-row");
          row.append(el("span", "tier-list", { mctiers: "MCTiers", pvptiers: "PvPTiers", subtiers: "SubTiers" }[list] || list));
          for (const [mode, r] of Object.entries(modes)) {
            const chip = el("span", "tier t" + r.tier + (r.retired ? " retired" : ""), `${r.retired ? "R" : ""}${r.high ? "HT" : "LT"}${r.tier}`);
            chip.title = mode;
            const wrap = el("span", "tier-mode");
            wrap.append(chip, el("small", null, mode.replace(/_/g, " ")));
            row.append(wrap);
          }
          t.append(row);
        }
        t.hidden = false;
      }

      // ---- badges: roles first, then achievements
      const bd = $("p-badges");
      const roles = (p.roles || []).filter((r) => ROLES[r]);
      if (roles.length || (p.badges || []).length) {
        bd.append(el("h3", null, "Badges"));
        const grid = el("div", "badge-grid");
        for (const r of roles) {
          const b = el("div", "badge role");
          const img = el("img");
          img.src = `/assets/badges/${r}.svg`;
          img.alt = "";
          b.append(img, el("b", null, ROLES[r].name), el("span", null, ROLES[r].desc));
          grid.append(b);
        }
        for (const x of p.badges || []) {
          const b = el("div", "badge");
          b.append(el("i", null, "★"), el("b", null, x.name), el("span", null, x.desc));
          grid.append(b);
        }
        bd.append(grid);
        bd.hidden = false;
      }

      // ---- song
      if (p.music) {
        const m = $("p-music");
        m.src = `${API}/page/${p.uuid}/music?v=${p.music}`;
        m.title = p.music_name || "Their song";
        m.hidden = false;
      }

      // ---- 3D model with cosmetics
      const look = p.cosmetics || {};
      const wear = $("p-wear");
      const worn = [];
      if (look.cape && look.cape !== "none") worn.push("Cape");
      if (look.wings && look.wings !== "none") worn.push("Wings: " + look.wings.replace(/_/g, " "));
      if (look.halo && look.halo !== "none") worn.push("Halo: " + look.halo);
      if (look.hat && look.hat !== "none") worn.push("Hat: " + look.hat.replace(/_/g, " "));
      if (look.aura && look.aura !== "none") worn.push("Aura: " + look.aura);
      if (worn.length) {
        wear.append(el("h3", null, "Wearing"));
        const list = el("div", "chips");
        worn.forEach((w) => list.append(el("span", "chip", w)));
        wear.append(list);
        const a = el("a", "more", "See all cosmetics →");
        a.href = "/cosmetics";
        wear.append(a);
        wear.hidden = false;
      }
      const canvas = $("p-canvas");
      if (window.CCViewer && canvas) {
        const box = canvas.parentElement;
        const v = window.CCViewer.create(canvas, { width: box.clientWidth, height: box.clientHeight });
        new ResizeObserver(() => v.setSize(box.clientWidth, box.clientHeight)).observe(box);
        v.setSkin(`${API}/public/skin/${p.uuid}`, p.model === "slim");
        const cape = look.cape && look.cape !== "none" ? `${API}/public/cape/${look.cape}` : null;
        const wings = look.wings && look.wings !== "none" ? `/assets/cosmetics/${look.wings}.png` : null;
        v.setLook(look, cape, wings);
      }
    })
    .catch((e) => fail(e.message === "This player's profile is private" ? "This profile is private" : e.message || "Player not found"));
})();
