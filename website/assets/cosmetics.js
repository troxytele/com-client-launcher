"use strict";
// comclient.xyz/cosmetics: every cosmetic in 3D. Click to try it on.
(() => {
  const { API, el, get } = window.CC;
  const $ = (id) => document.getElementById(id);
  const look = { cape: "none", wings: "heaven", halo: "ring", haloColor: 0xffe07a, hat: "none", hatColor: 0xededed, aura: "sparkles", auraColor: 0xa77bff };
  const FIELD = { capes: "cape", wings: "wings", halos: "halo", hats: "hat", auras: "aura" };
  const COLOR = { halos: "haloColor", hats: "hatColor", auras: "auraColor" };
  const SWATCHES = [0xffe07a, 0xffffff, 0xff6fae, 0xb9a6ff, 0x5aa9ff, 0x4fe3a0, 0xff5a5a, 0xff9f43, 0x1a1a1a];
  // cat and dog ears come in real fur colours: white, cream, golden, ginger, brown, dark brown, grey, black
  const EAR_COLORS = [0xededed, 0xefddb8, 0xd9a55b, 0xd07a33, 0x7b4a2d, 0x4a2e1c, 0x8c8782, 0x1e1a19];
  let catalog = null;
  let kind = "capes";
  let viewer = null;

  const capeUrl = (h) => `${API}/public/cape/${h}`;
  const hex = (n) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");

  function apply() {
    if (!viewer) return;
    const cape = look.cape !== "none" ? capeUrl(look.cape) : null;
    const wings = look.wings !== "none" ? `/assets/cosmetics/${look.wings}.png` : null;
    viewer.setLook(look, cape, wings);
    const w = $("g-wearing");
    w.textContent = "";
    for (const [k, f] of Object.entries(FIELD)) {
      if (look[f] === "none") continue;
      const item = catalog[k].find((i) => i.id === look[f]);
      const chip = el("button", "chip", (item ? item.name : look[f]) + " ✕");
      chip.title = "Take it off";
      chip.addEventListener("click", () => {
        look[f] = "none";
        apply();
        render();
      });
      w.append(chip);
    }
    if (look.wings !== "none" && look.cape !== "none") w.append(el("small", "muted", "Wings and a cape: the preview shows the wings"));
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

  /** The two wings like the game's card: the elytra's back face, mirrored. */
  function wingArt(id) {
    const c = el("canvas", "art wings");
    c.width = 24;
    c.height = 20;
    const img = new Image();
    img.onload = () => {
      const s = img.width / 64;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 36 * s, 2 * s, 10 * s, 20 * s, 12, 0, 10, 20);
      g.save();
      g.scale(-1, 1);
      g.drawImage(img, 36 * s, 2 * s, 10 * s, 20 * s, -12, 0, 10, 20);
      g.restore();
    };
    img.src = `/assets/cosmetics/${id}.png`;
    return c;
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
        const lk = { cape: "none", wings: "none", halo: "none", haloColor: look.haloColor, hat: "none", hatColor: look.hatColor, aura: "none", auraColor: look.auraColor };
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
      b.append(kind === "capes" ? capeArt(item.id) : kind === "wings" ? wingArt(item.id) : iconArt(kind, item.id), el("small", null, item.name));
      b.addEventListener("click", () => pick(item.id));
      box.append(b);
    }
    // colours for halos, hats (not the gold crown) and auras
    const cbox = $("g-colors");
    cbox.textContent = "";
    const cf = COLOR[kind];
    cbox.hidden = !cf || (kind === "hats" && look.hat === "crown");
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
      return;
    }
    const btn = $("g-skin").querySelector("button");
    btn.disabled = true;
    btn.textContent = "Loading…";
    get("/public/mc/" + encodeURIComponent(name))
      .then((p) => {
        viewer.setSkin([p.skin, ...window.CC.STEVE], p.model === "slim");
        input.value = p.name;
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
