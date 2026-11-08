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

  return { STEVE, API, NEWS, el, get, hours, ROLES, roleBadges, face, avatarUrl, profileUrl };
})();
