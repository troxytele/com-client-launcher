"use strict";
// Shared by the profile, players and cosmetics pages: the Com Client API, small helpers and the badges.
window.CC = (() => {
  const API = "https://com-client.onrender.com";
  const NEWS = "https://raw.githubusercontent.com/troxytele/com-client-launcher/main/news.json";
  // Steve, Minecraft's default skin, straight from Mojang (through our server, which adds CORS for the 3D viewer).
  // The local skin is only used when the server is asleep.
  const STEVE = [API + "/public/cape/1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b", "/assets/cosmetics/default-skin.png"];

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  async function get(path) {
    const r = await fetch(API + path, { headers: { Accept: "application/json" } });
    let body = null;
    try { body = await r.json(); } catch {}
    if (!r.ok) throw new Error((body && body.detail) || `Error ${r.status}`);
    return body;
  }

  const hours = (secs) => {
    const h = Math.floor(secs / 3600);
    if (h >= 1) return h.toLocaleString() + " h";
    return Math.max(0, Math.round(secs / 60)) + " min";
  };

  // in the order they're shown (the same as the server sends them)
  const ROLES = {
    developer: { name: "Developer", desc: "Makes Com Client" },
    moderator: { name: "Moderator", desc: "Keeps chat, the feed and pages friendly" },
    creator: { name: "Content Creator", desc: "Makes videos or streams with Com Client" },
    partner: { name: "Partner", desc: "A server or team Com Client works with" },
    bughunter: { name: "Bug Hunter", desc: "Found and reported a real bug" },
    tester: { name: "Tester", desc: "Tries new versions before everyone else" },
    supporter: { name: "Supporter", desc: "Supports Com Client" },
    booster: { name: "Booster", desc: "Boosts the Com Client Discord" },
    early: { name: "Early Supporter", desc: "Joined Com Client in its first months" },
  };

  /** Little role icons (same pictures as on name tags in game). */
  function roleBadges(roles, big) {
    const wrap = el("span", "roles" + (big ? " big" : ""));
    for (const r of roles || []) {
      if (!ROLES[r]) continue;
      const img = el("img");
      img.src = `/assets/badges/${r}.svg`;
      img.alt = ROLES[r].name;
      img.title = ROLES[r].name + " · " + ROLES[r].desc;
      wrap.append(img);
    }
    return wrap;
  }

  /** The player's face from their skin (8x8 face + hat layer), drawn sharp on a canvas. */
  function face(uuid, size = 40) {
    const c = el("canvas", "face");
    c.width = c.height = 8;
    c.style.width = c.style.height = size + "px";
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    };
    img.src = `${API}/public/skin/${uuid}`;
    return c;
  }

  const avatarUrl = (uuid, v) => `${API}/avatar/${uuid}?v=${v}`;

  /** comclient.xyz/u/<name> */
  const profileUrl = (p) => "/u/" + encodeURIComponent(p.username || p.name);

  /** The gold points coin (an <img>). */
  const coin = (size = 16) => {
    const i = el("img", "coin");
    i.src = "/assets/coin.svg";
    i.alt = "points";
    i.width = i.height = size;
    return i;
  };
  /** A coin followed by a number. */
  const coins = (n, size = 16) => {
    const s = el("span", "coins");
    s.append(coin(size), document.createTextNode(" " + Number(n).toLocaleString()));
    return s;
  };

  // name tag styles (NameStyles.java): gradients over the letters of the name, the moving ones flow along it
  const NAME_STYLES = {
    fire: { name: "Fire", stops: [0xffe066, 0xff7a1a, 0xe8202a], moving: true },
    ocean: { name: "Ocean", stops: [0x8ff6ff, 0x2e9bff, 0x4a4af0], moving: true },
    gold: { name: "Gold", stops: [0xb8860b, 0xf2c230, 0xfff4b0, 0xf2c230, 0xb8860b], moving: true },
    toxic: { name: "Toxic", stops: [0xd8ff3a, 0x3ae86e, 0x0e9f6e], moving: false },
    candy: { name: "Candy", stops: [0xff5fa2, 0xffb3d9, 0x8fd8ff], moving: false },
    galaxy: { name: "Galaxy", stops: [0xb57bff, 0x5b6bff, 0xff6bd5, 0xb57bff], moving: true },
    rainbow: { name: "Rainbow", stops: [], moving: true },
  };
  const mixRgb = (a, b, t) => {
    const ch = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  function nameColour(style, i, n, now) {
    let t = n <= 1 ? 0 : i / (n - 1);
    if (!style.stops.length) return `hsl(${(((t * 0.8 + now / 2500) % 1) * 360).toFixed(0)}, 100%, 70%)`;
    if (style.moving) {
      t = (t * 0.7 + now / 1800) % 1;
      t = t < 0.5 ? t * 2 : 2 - t * 2;
    }
    const st = style.stops;
    const f = t * (st.length - 1);
    const k = Math.min(st.length - 2, Math.floor(f));
    return "#" + mixRgb(st[k], st[k + 1], f - k).toString(16).padStart(6, "0");
  }
  /** Colours the letters of `target` (an element holding the name) with a name tag style; animates moving ones.
   *  Returns a function that stops it. */
  function styleName(target, styleId, still = false) {
    const style = NAME_STYLES[styleId];
    const text = target.textContent;
    if (!style || !text) return () => {};
    target.textContent = "";
    const letters = [...text].map((ch) => {
      const s = el("span", null, ch);
      target.append(s);
      return s;
    });
    let frame = 0;
    const paint = (now) => letters.forEach((s, i) => (s.style.color = nameColour(style, i, letters.length, now)));
    paint(900);
    if (!still && style.moving) {
      const loop = (now) => {
        paint(now);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(frame);
  }

  return { STEVE, API, NEWS, el, get, hours, ROLES, roleBadges, face, avatarUrl, profileUrl, coin, coins, NAME_STYLES, styleName };
})();
