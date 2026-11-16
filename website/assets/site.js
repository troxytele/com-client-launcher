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
    sunset: { name: "Sunset", stops: [0xff5f6d, 0xffc371], moving: true },
    lava: { name: "Lava", stops: [0xff3d00, 0xffb300, 0xff3d00], moving: true },
    mint: { name: "Mint", stops: [0xb8ffe0, 0x3fe0a0], moving: false },
    ice: { name: "Ice", stops: [0xe0f7ff, 0x8fd3ff, 0xffffff, 0x8fd3ff], moving: true },
    sakura: { name: "Sakura", stops: [0xffb7d5, 0xfff0f6, 0xff8fbf], moving: true },
    vaporwave: { name: "Vaporwave", stops: [0xff71ce, 0x01cdfe, 0xb967ff], moving: true },
    emerald: { name: "Emerald", stops: [0x0e9f6e, 0x6dffb0, 0x0e9f6e], moving: true },
    blood: { name: "Blood Moon", stops: [0x7a0010, 0xe8202a, 0x7a0010], moving: true },
    midnight: { name: "Midnight", stops: [0xb57bff, 0x5b6bff, 0x1d2a8f], moving: false },
    mono: { name: "Mono", stops: [0xffffff, 0x8a8a8a, 0xffffff], moving: true },
    peach: { name: "Peach", stops: [0xffb199, 0xffe0c2, 0xff8a80], moving: true },
    forest: { name: "Forest", stops: [0x2e7d32, 0x8bc34a, 0x2e7d32], moving: true },
    royal: { name: "Royal", stops: [0x3b2a8f, 0xc9a227, 0x3b2a8f], moving: true },
    fire_ice: { name: "Fire & Ice", stops: [0xff4a1a, 0xffb347, 0x8fd3ff, 0x2e7bff], moving: true },
    cotton_candy: { name: "Cotton Candy", stops: [0xffb3e6, 0xb3e5ff], moving: true },
    neon: { name: "Neon", stops: [0x39ff14, 0xff2bd6, 0x00f0ff], moving: true },
    copper: { name: "Copper", stops: [0xb87333, 0xf0b27a, 0x8c4a1e], moving: false },
    shadow: { name: "Shadow", stops: [0x5a5a6e, 0xc8c8d8, 0x5a5a6e], moving: true },
    bubblegum: { name: "Bubblegum", stops: [0xff77c8, 0xffc6e8, 0xff77c8], moving: true },
    ruby: { name: "Ruby", stops: [0x8e0f2b, 0xff4a6e, 0x8e0f2b], moving: true },
    sapphire: { name: "Sapphire", stops: [0x0f2e8e, 0x4a8bff, 0x0f2e8e], moving: true },
    amethyst: { name: "Amethyst", stops: [0x5a1e8e, 0xc77bff, 0x5a1e8e], moving: true },
    sunrise: { name: "Sunrise", stops: [0xff6a3d, 0xffb347, 0xffe07a], moving: false },
    lime: { name: "Lime", stops: [0xb6ff3a, 0x5fd33a], moving: false },
    christmas: { name: "Christmas", stops: [0xe8262b, 0xffffff, 0x2f8f3a, 0xffffff, 0xe8262b], moving: true },
    candy_cane: { name: "Candy Cane", stops: [0xff3a3a, 0xffffff, 0xff3a3a, 0xffffff], moving: true },
    frost: { name: "Frost", stops: [0xffffff, 0x9fd6ff, 0x4a8bff, 0x9fd6ff], moving: true },
    gingerbread: { name: "Gingerbread", stops: [0x9a5a28, 0xd08a4a, 0xfff4e0], moving: false },
    evergreen: { name: "Evergreen", stops: [0x1f6a2a, 0x5fd36b, 0x1f6a2a], moving: true },
    golden_star: { name: "Golden Star", stops: [0xfff3a0, 0xf2c230, 0xb8860b, 0xf2c230], moving: true },
    lagoon: { name: "Lagoon", stops: [0x00c9a7, 0x3fe0ff, 0x0077b6], moving: true },
    berry: { name: "Berry", stops: [0x8e2de2, 0xff4f9a, 0x8e2de2], moving: true },
    volt: { name: "Volt", stops: [0xfff200, 0x00f0ff, 0xfff200], moving: true },
    ember: { name: "Ember", stops: [0x8a1a04, 0xff5a1a, 0xffd36b, 0xff5a1a], moving: true },
    pastel: { name: "Pastel", stops: [0xffb3d9, 0xb3e5ff, 0xd9ffb3, 0xfff0b3], moving: true },
    dusk: { name: "Dusk", stops: [0x2a1a5a, 0xc04dff, 0xff7a59], moving: false },
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
