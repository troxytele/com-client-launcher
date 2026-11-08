"use strict";
// comclient.xyz/u/<name>: a player's public profile.
(() => {
  const { API, el, get, hours, roleBadges, face, avatarUrl, ROLES } = window.CC;
  const $ = (id) => document.getElementById(id);
  // the kit's icon: the same item pictures as the Tier Tags module in game (MCTiers, PvPTiers and SubTiers use different names)
  const tierIcon = (mode) => {
    const k = mode.toLowerCase();
    if (k.includes("neth")) return "nethpot";
    if (k.includes("sword")) return "sword";
    if (k.includes("axe")) return "axe";
    if (k.includes("debuff")) return "debuff";
    if (k.includes("pot")) return "pot";
    if (k.includes("mace")) return "mace";
    if (k.includes("uhc")) return "uhc";
    if (k.includes("crystal") || k.includes("vanilla")) return "vanilla";
    if (k.includes("trident")) return "trident";
    if (k.includes("minecart") || k.includes("cart")) return "minecart";
    if (k.includes("creeper")) return "creeper";
    if (k.includes("elytra")) return "elytra";
    if (k.includes("bow")) return "bow";
    if (k.includes("speed")) return "speed";
    if (k.includes("manhunt")) return "manhunt";
    if (k.includes("bed")) return "bed";
    if (k.includes("smp")) return k.includes("dia") ? "diasmp" : "smp";
    return "other";
  };
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
            const label = mode.replace(/_/g, " ");
            const wrap = el("span", "tier-mode t" + r.tier + (r.retired ? " retired" : ""));
            wrap.title = `${label}: ${r.high ? "High" : "Low"} Tier ${r.tier}${r.retired ? " (retired)" : ""}`;
            const icon = el("img", "tier-icon");
            icon.src = `/assets/tiers/${tierIcon(mode)}.png?v=items`; // ?v: new link so old cached pictures aren't reused
            icon.alt = "";
            icon.width = icon.height = 20;
            const text = el("span", "tier-text");
            text.append(el("b", null, `${r.retired ? "R" : ""}${r.high ? "HT" : "LT"}${r.tier}`), el("small", null, label));
            wrap.append(icon, text);
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
        $("song-name").textContent = p.music_name || "Their song";
        const play = $("song-play"), bar = $("song-bar"), fill = $("song-fill");
        const fmt = (t) => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00");
        const draw = () => {
          const d = m.duration || 0;
          fill.style.width = d ? `${(m.currentTime / d) * 100}%` : "0%";
          $("song-time").textContent = `${fmt(m.currentTime)} / ${fmt(d)}`;
          play.classList.toggle("on", !m.paused);
          play.setAttribute("aria-label", m.paused ? "Play" : "Pause");
        };
        play.addEventListener("click", () => (m.paused ? m.play().catch(() => {}) : m.pause()));
        for (const ev of ["timeupdate", "loadedmetadata", "play", "pause", "ended"]) m.addEventListener(ev, draw);
        const seek = (x) => {
          const r = bar.getBoundingClientRect();
          if (m.duration) m.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * m.duration;
        };
        bar.addEventListener("pointerdown", (e) => {
          seek(e.clientX);
          bar.setPointerCapture(e.pointerId);
          const move = (ev) => seek(ev.clientX);
          bar.addEventListener("pointermove", move);
          bar.addEventListener("pointerup", () => bar.removeEventListener("pointermove", move), { once: true });
        });
        bar.addEventListener("keydown", (e) => {
          if (e.key === "ArrowRight") m.currentTime += 5;
          if (e.key === "ArrowLeft") m.currentTime -= 5;
        });
        // volume: a speaker to mute and a slim bar you click or drag (remembered on this device)
        const box = $("song-vol"), track = $("vol-track"), vfill = $("vol-fill");
        let saved = 0.6;
        try {
          saved = Math.min(1, Math.max(0, parseFloat(localStorage.getItem("cc-song-volume") ?? "0.6")));
        } catch {}
        let before = saved || 0.6;
        const setVol = (v) => {
          m.volume = Math.min(1, Math.max(0, v));
          m.muted = m.volume === 0;
          vfill.style.width = m.volume * 100 + "%";
          $("vol-num").textContent = String(Math.round(m.volume * 100));
          track.setAttribute("aria-valuenow", String(Math.round(m.volume * 100)));
          box.classList.toggle("muted", m.volume === 0);
          box.classList.toggle("low", m.volume > 0 && m.volume < 0.5);
          try {
            localStorage.setItem("cc-song-volume", String(m.volume));
          } catch {}
        };
        setVol(saved);
        $("vol-btn").addEventListener("click", () => {
          if (m.volume > 0) {
            before = m.volume;
            setVol(0);
          } else setVol(before || 0.6);
        });
        const volAt = (x) => {
          const r = track.getBoundingClientRect();
          setVol((x - r.left) / r.width);
        };
        track.addEventListener("pointerdown", (e) => {
          volAt(e.clientX);
          track.setPointerCapture(e.pointerId);
          track.classList.add("drag");
          const move = (ev) => volAt(ev.clientX);
          track.addEventListener("pointermove", move);
          track.addEventListener("pointerup", () => {
            track.removeEventListener("pointermove", move);
            track.classList.remove("drag");
          }, { once: true });
        });
        // scroll over the volume pill to turn it up or down
        box.addEventListener("wheel", (e) => {
          e.preventDefault();
          setVol(m.volume + (e.deltaY < 0 ? 0.05 : -0.05));
        }, { passive: false });
        track.addEventListener("keydown", (e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") setVol(m.volume + 0.1);
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") setVol(m.volume - 0.1);
        });
        $("p-song").hidden = false;

        // play right away. Browsers only allow sound after the visitor did something on the page, so if that's
        // blocked the song starts with their first click or key press
        m.play().catch(() => {
          $("p-song").classList.add("waiting");
          const start = (e) => {
            if (e.target.closest && e.target.closest("#p-song")) return; // the player's own buttons handle it
            m.play().catch(() => {});
          };
          const done = () => {
            $("p-song").classList.remove("waiting");
            document.removeEventListener("pointerdown", start, true);
            document.removeEventListener("keydown", start, true);
          };
          document.addEventListener("pointerdown", start, true);
          document.addEventListener("keydown", start, true);
          m.addEventListener("play", done, { once: true });
        });
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
      wear.id = "wears";
      if (worn.length) {
        const head = el("div", "wear-head");
        head.append(el("h3", null, "Wears"));
        const share = el("button", "btn ghost small", "Share");
        share.type = "button";
        share.addEventListener("click", async () => {
          const url = location.origin + location.pathname + "#wears";
          try {
            if (navigator.share) await navigator.share({ title: `${p.name}'s look on Com Client`, url });
            else {
              await navigator.clipboard.writeText(url);
              share.textContent = "Link copied";
              setTimeout(() => (share.textContent = "Share"), 1600);
            }
          } catch {}
        });
        head.append(share);
        wear.append(head);
        const list = el("div", "chips");
        worn.forEach((w) => list.append(el("span", "chip", w)));
        wear.append(list);
        wear.hidden = false;
      }
      // points and unlocked items (players can hide these in the client's settings)
      if (p.shop) {
        const box = el("div", "p-shop");
        const pts = el("div", "pts");
        const stat = (n, label) => {
          const d = el("div");
          const b = el("b");
          b.append(window.CC.coins(n, 20));
          d.append(b, el("small", null, label));
          return d;
        };
        pts.append(stat(p.shop.points, "points"), stat(p.shop.earned, "earned in total"));
        box.append(pts);
        const NAMES = { cape: "Cape", wings: "Wings", halo: "Halo", hat: "Hat", aura: "Aura", emote: "Emote" };
        if (p.shop.everything) box.append(el("p", "muted", "Has every cosmetic unlocked (Com Client team)."));
        else if (p.shop.owned.length) {
          box.append(el("h3", null, `Unlocked (${p.shop.owned.length})`));
          const grid = el("div", "p-owned");
          for (const o of p.shop.owned) {
            const t = el("span");
            t.append(el("small", null, NAMES[o.kind] || o.kind), document.createTextNode(o.name));
            grid.append(t);
          }
          box.append(grid);
        }
        wear.append(box);
        wear.hidden = false;
      }
      if (!wear.hidden) {
        const a = el("a", "more", "See all cosmetics →");
        a.href = "/cosmetics";
        wear.append(a);
        if (location.hash === "#wears") setTimeout(() => wear.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      }
      const canvas = $("p-canvas");
      if (window.CCViewer && canvas) {
        const box = canvas.parentElement;
        const v = window.CCViewer.create(canvas, { width: box.clientWidth, height: box.clientHeight });
        new ResizeObserver(() => v.setSize(box.clientWidth, box.clientHeight)).observe(box);
        v.setSkin([`${API}/public/skin/${p.uuid}`, ...window.CC.STEVE], p.model === "slim");
        const cape = look.cape && look.cape !== "none" ? `${API}/public/cape/${look.cape}` : null;
        const wings = look.wings && look.wings !== "none" ? `/assets/cosmetics/${look.wings}.png` : null;
        v.setLook(look, cape, wings);
      }
    })
    .catch((e) => fail(/^No public/.test(e.message || "") ? "No public page with that name" : e.message || "Player not found"));
})();
