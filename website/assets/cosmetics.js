"use strict";
// comclient.xyz/cosmetics: every cosmetic in 3D. Click to try it on.
(() => {
  const { API, el, get } = window.CC;
  const $ = (id) => document.getElementById(id);
  const look = { cape: "none", wings: "heaven", halo: "ring", haloColor: 0xffe07a, hat: "none", hatColor: 0xededed, aura: "sparkles", auraColor: 0xa77bff, pet: "none", nametag: "none", icon: "none" };
  const FIELD = { capes: "cape", wings: "wings", halos: "halo", hats: "hat", auras: "aura", pets: "pet", nametags: "nametag", icons: "icon" };
  // wing types (WingsFeature.Shape): which design is which
  const wingType = (id) => (["monarch", "morpho", "celestial"].includes(id) ? "Butterfly" : id === "pixie" ? "Fairy"
    : ["dragon", "devil", "blue_dragon", "bat", "emerald"].includes(id) ? "Dragon" : "Feathered");
  let skinName = "Steve"; // the name shown with a name tag style
  const COLOR = { halos: "haloColor", hats: "hatColor", auras: "auraColor" };
  const SWATCHES = [0xffe07a, 0xffffff, 0xff6fae, 0xb9a6ff, 0x5aa9ff, 0x4fe3a0, 0xff5a5a, 0xff9f43, 0x1a1a1a];
  // cat and dog ears come in real fur colours: white, cream, golden, ginger, brown, dark brown, grey, black
  const EAR_COLORS = [0xededed, 0xefddb8, 0xd9a55b, 0xd07a33, 0x7b4a2d, 0x4a2e1c, 0x8c8782, 0x1e1a19];
  let catalog = null;
  let prices = null; // "cape:<hash>" -> points (0 = free), from the server's shop
  const SHOP_KIND = { capes: "cape", wings: "wings", halos: "halo", hats: "hat", auras: "aura", pets: "pet", nametags: "nametag", icons: "icon" };
  let seasons = new Map(); // seasonal items (Christmas, limited drops, advent): "kind:id" -> {name, start, end, only}
  let only = new Map(); // "kind:id" -> "advent" (can't be bought) or "limited"
  let deal = null; // today's deal: one item 30% off for a day
  get("/public/shop").then((s) => {
    prices = new Map(s.items.map((i) => [i.kind + ":" + i.id, i.price]));
    seasons = new Map(s.items.filter((i) => i.season).map((i) => [i.kind + ":" + i.id, i.season]));
    only = new Map(s.items.filter((i) => i.only).map((i) => [i.kind + ":" + i.id, i.only]));
    deal = s.deal || null;
    showDeal();
    if (catalog) render();
  }).catch(() => {});
  function priceTag(id) {
    if (!prices) return null;
    const p = prices.get(SHOP_KIND[kind] + ":" + id) ?? null;
    if (p === null) return null;
    if (only.get(SHOP_KIND[kind] + ":" + id) === "advent") return el("span", "g-price advent", "🎄 Advent calendar only");
    if (deal && deal.kind === SHOP_KIND[kind] && deal.id === id) {
      const t = el("span", "g-price deal");
      t.append(el("s", null, deal.full_price.toLocaleString()), document.createTextNode(" "), window.CC.coins(deal.price, 13));
      return t;
    }
    if (!p) return el("span", "g-price free", "Free");
    const t = el("span", "g-price");
    t.append(window.CC.coins(p, 13));
    const season = seasons.get(SHOP_KIND[kind] + ":" + id);
    if (season) {
      const now = Date.now() / 1000;
      const open = now >= season.start && now < season.end;
      const when = new Date((open ? season.end : season.start) * 1000).toLocaleDateString("en", { month: "short", day: "numeric" });
      const wrap = el("span", "g-season" + (open ? " open" : ""));
      const sname = season.name || "Christmas";
      wrap.append(t, el("small", null, open ? `${sname} · until ${when}` : `${sname} · back ${when}`));
      return wrap;
    }
    return t;
  }
  function showDeal() {
    if (!deal) return;
    const kindTab = Object.keys(SHOP_KIND).find((k) => SHOP_KIND[k] === deal.kind);
    if (!kindTab) return;
    const b = el("button", "deal-banner");
    b.type = "button";
    const txt = el("span", "grow");
    txt.append(document.createTextNode("Today's deal: "), el("b", null, deal.name), document.createTextNode(` (${deal.kind}) · ends in ${Math.max(1, Math.round((deal.ends - Date.now() / 1000) / 3600))} h`));
    const pr = el("span", null);
    pr.append(el("s", null, String(deal.full_price)), document.createTextNode(" "), window.CC.coins(deal.price, 16));
    b.append(el("span", "off", `-${deal.off}%`), txt, pr);
    b.addEventListener("click", () => {
      document.querySelector(`.g-tabs .tab[data-kind="${kindTab}"]`)?.click();
      if (catalog) pick(deal.id);
    });
    document.querySelector(".gallery").before(b);
  }
  let kind = "capes";
  let viewer = null;

  // Com Client's own capes come with the website (an animated strip; the first frame is the picture)
  const capeUrl = (h) => (h.startsWith("cc_") ? `/assets/cosmetics/capes/${h.slice(3)}.png` : `${API}/public/cape/${h}`);
  const hex = (n) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");

  function apply() {
    if (!viewer) return;
    const cape = look.cape !== "none" ? capeUrl(look.cape) : null;
    const wings = look.wings !== "none" ? `/assets/cosmetics/${look.wings}.png` : null;
    viewer.setLook(look, cape, wings);
    showNametag();
    showPet();
    const w = $("g-wearing");
    w.textContent = "";
    for (const [k, f] of Object.entries(FIELD)) {
      if (look[f] === "none") continue;
      const item = catalog[k].find((i) => i.id === look[f]);
      const chip = el("button", "chip", (item ? item.name : look[f]) + (k === "pets" ? " (pet)" : k === "nametags" ? " (name tag)" : k === "icons" ? " (icon)" : "") + " ✕");
      chip.title = "Take it off";
      chip.addEventListener("click", () => {
        look[f] = "none";
        apply();
        render();
      });
      w.append(chip);
    }
  }

  /** The front of a cape (10x16 pixels at 1,1 of its 64x32 texture). */
  function capeArt(hash) {
    const c = el("canvas", "art cape");
    c.width = 10;
    c.height = 16;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const s = img.width / 64;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, 10, 16);
    };
    img.src = capeUrl(hash);
    return c;
  }

  /** The wings' card picture: a 3D render of the pair. */
  function wingArt(id) {
    const img = el("img", "art voxel");
    img.src = `/assets/cosmetics/wings_card/${id}.png`;
    img.alt = "";
    return img;
  }

  let stopName = () => {};
  function showNametag() {
    const box = $("g-nametag");
    stopName();
    const on = look.nametag && look.nametag !== "none";
    box.hidden = !on;
    box.textContent = skinName;
    if (on) stopName = window.CC.styleName(box, look.nametag);
    if (look.icon && look.icon !== "none") {
      box.hidden = false;
      box.prepend(iconImg(look.icon, "g-nameicon"));   // in place of the Com Client C, in front of the name
    }
  }
  function showPet() {
    // the pet itself is in the 3D preview now
  }
  const VOXEL_HATS = new Set(["bunny_hat", "axolotl_hat", "frog_hat", "fire_horns", "pumpkin_hat"]);
  function iconImg(id, cls, dir = "icons") {
    const img = el("img", cls);
    img.src = `/assets/cosmetics/${dir}/${id}.png`;
    img.alt = "";
    return img;
  }
  function petArt(id) {
    const img = el("img", "art voxel");
    img.src = `/assets/cosmetics/pets/${id}.png`;
    img.alt = "";
    return img;
  }
  function nametagArt(style) {
    const a = el("span", "art nametag", "Name");
    window.CC.styleName(a, style.id, true);
    return a;
  }

  // halos, hats and auras: a real 3D picture of each one on Steve (rendered once, one after another, then kept)
  const thumbs = new Map();
  let thumbViewer = null;
  let thumbQueue = Promise.resolve();
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  function iconArt(k, id) {
    const color = COLOR[k] ? look[COLOR[k]] : 0;
    const key = `${k}:${id}:${color}`;
    const img = el("img", `art thumb ${k}`);
    img.alt = "";
    if (thumbs.has(key)) {
      img.src = thumbs.get(key);
      return img;
    }
    if (!window.CCViewer) return img;
    thumbQueue = thumbQueue.then(async () => {
      if (!thumbs.has(key)) {
        if (!thumbViewer) {
          thumbViewer = window.CCViewer.create(document.createElement("canvas"), { width: 160, height: 160, rotate: false, fromBehind: false });
          await thumbViewer.setSkin(window.CC.STEVE, false);
          thumbViewer.viewer.animation = null;
        }
        const v = thumbViewer.viewer;
        const lk = { cape: "none", wings: "none", halo: "none", haloColor: look.haloColor, hat: "none", hatColor: look.hatColor, aura: "none", auraColor: look.auraColor, pet: "none", nametag: "none", icon: "none" };
        lk[FIELD[k]] = id;
        thumbViewer.setLook(lk, null, null);
        const head = k !== "auras";
        v.playerWrapper.rotation.y = head ? 0.6 : 0.45;
        v.zoom = head ? 2.3 : 1.05;
        v.camera.position.y = head ? 14 : 2;
        v.controls.target.set(0, head ? 12.5 : 0, 0);
        v.controls.update();
        await frame();
        v.render();
        thumbs.set(key, v.canvas.toDataURL("image/png"));
      }
      img.src = thumbs.get(key);
    }).catch(() => {});
    return img;
  }

  function render() {
    const box = $("g-items");
    box.textContent = "";
    const field = FIELD[kind];
    const none = el("button", "g-item" + (look[field] === "none" ? " on" : ""));
    none.append(el("span", "art none", "✕"), el("small", null, "None"));
    none.addEventListener("click", () => pick("none"));
    box.append(none);
    for (const item of catalog[kind]) {
      const b = el("button", "g-item" + (look[field] === item.id ? " on" : ""));
      b.title = item.name;
      const art = kind === "capes" ? capeArt(item.id) : kind === "wings" ? wingArt(item.id) : kind === "pets" ? petArt(item.id)
        : kind === "hats" ? iconImg(item.id, "art voxel", "hats")
        : kind === "nametags" ? nametagArt(item) : kind === "icons" ? iconImg(item.id, "art nameicon") : iconArt(kind, item.id);
      b.append(art, el("small", null, item.name));
      if (kind === "wings") b.append(el("small", "g-type", wingType(item.id)));
      const tag = priceTag(item.id);
      if (tag) b.append(tag);
      b.addEventListener("click", () => pick(item.id));
      box.append(b);
    }
    // colours for halos, hats (not the gold crown) and auras
    const cbox = $("g-colors");
    cbox.textContent = "";
    const cf = COLOR[kind];
    cbox.hidden = !cf || (kind === "hats" && (["crown", "santa", "antlers"].includes(look.hat) || VOXEL_HATS.has(look.hat))) || (kind === "auras" && look.aura === "snow") || (kind === "halos" && look.halo === "wreath");
    if (cf) {
      for (const c of kind === "hats" ? EAR_COLORS : SWATCHES) {
        const s = el("button", "swatch" + (look[cf] === c ? " on" : ""));
        s.style.background = hex(c);
        s.title = hex(c);
        s.addEventListener("click", () => {
          look[cf] = c;
          apply();
          render();
        });
        cbox.append(s);
      }
      if (kind === "auras") {
        const r = el("button", "swatch rainbow" + (look.auraColor === -1 ? " on" : ""));
        r.title = "Rainbow";
        r.addEventListener("click", () => {
          look.auraColor = -1;
          apply();
          render();
        });
        cbox.append(r);
      }
    }
  }

  function pick(id) {
    look[FIELD[kind]] = id;
    apply();
    render();
  }

  document.querySelectorAll(".g-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".g-tabs .tab").forEach((x) => x.classList.toggle("on", x === t));
      kind = t.dataset.kind;
      render();
    }),
  );

  // any Minecraft name: see how your own skin looks with the cosmetics
  $("g-skin").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("g-skin-name");
    const name = input.value.trim().replace(/^@/, "");
    if (!name) {
      viewer.setSkin(window.CC.STEVE, false);
      skinName = "Steve";
      showNametag();
      return;
    }
    const btn = $("g-skin").querySelector("button");
    btn.disabled = true;
    btn.textContent = "Loading…";
    get("/public/mc/" + encodeURIComponent(name))
      .then((p) => {
        viewer.setSkin([p.skin, ...window.CC.STEVE], p.model === "slim");
        input.value = p.name;
        skinName = p.name;
        showNametag();
      })
      .catch((err) => {
        input.value = "";
        input.placeholder = err.message;
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = "Try on";
      });
  });

  // sets: a few items that go together, cheaper together; clicking one puts it on the 3D model
  get("/public/sets").then((r) => {
    const grid = $("sets-grid");
    for (const st of r.sets) {
      const card = el("button", "sets-web-card");
      card.append(el("b", null, st.name));
      card.append(el("small", null, st.items.map((i) => i.name).join(" · ")));
      const price = el("span", "g-price");
      price.append(el("s", null, st.full_price.toLocaleString()), document.createTextNode(" " + st.price.toLocaleString() + " points"));
      card.append(price);
      if (st.why) card.append(el("small", "muted", st.why));
      card.addEventListener("click", () => {
        if (!catalog) return;
        for (const it of st.items) look[it.kind] = it.id;
        apply();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      grid.append(card);
    }
    $("sets").hidden = r.sets.length === 0;
  }).catch(() => {});

  // the advent calendar: which doors are open, and what is only in there
  get("/public/advent").then((a) => {
    const box = $("advent");
    const start = new Date(a.start * 1000).toLocaleDateString("en", { month: "long", day: "numeric" });
    $("advent-text").textContent = (a.active
      ? `Door ${a.today} is open! Open the doors in the launcher's Locker or in game (main menu). Missed doors stay open until December 26.`
      : `Opens on ${start}: one door a day until Christmas, in the launcher's Locker or in game.`) +
      " Behind the doors: points and Christmas cosmetics you can't get anywhere else. What's inside is a surprise!";
    const grid = $("advent-grid");
    for (const d of a.doors) {
      const door = el("div", "advent-web-door" + (d.open ? " open" : ""));
      door.append(el("b", null, String(d.day)));
      door.append(el("small", null, d.open ? "Open" : "🔒"));
      grid.append(door);
    }
    box.hidden = false;
  }).catch(() => {});

  fetch("/assets/cosmetics/catalog.json")
    .then((r) => r.json())
    .then((c) => {
      catalog = c;
      look.cape = c.capes[0]?.id ?? "none";
      const canvas = $("g-canvas");
      const box = canvas.parentElement;
      if (window.CCViewer) {
        viewer = window.CCViewer.create(canvas, { width: box.clientWidth, height: box.clientHeight });
        new ResizeObserver(() => viewer.setSize(box.clientWidth, box.clientHeight)).observe(box);
        viewer.setSkin(window.CC.STEVE, false);
      }
      look.wings = "none";
      apply();
      render();
    });
})();
