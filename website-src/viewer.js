// The website's 3D player: skin + cape / wings + halo + hat + aura, the same as the launcher's Locker and the game.
// Built into website/assets/viewer.js with:  npm run build:web
import * as THREE from "three";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { CUSTOM_CAPES, auraColour, auraPoints, glow, makeHalo, makeHat, playCape } from "./helpers.js";
import { loadPet } from "./pets.js";
import { makeWings } from "./wings.js";

const loadImage = (url, ms) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const t = setTimeout(() => resolve(null), ms);
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    img.src = url;
  });

function create(canvas, { width = 320, height = 420, rotate = true, fromBehind = true } = {}) {
  const v = new SkinViewer({ canvas, width, height, zoom: 0.78, fov: 40 });
  v.controls.enableZoom = false;
  v.controls.enablePan = false;
  v.autoRotate = rotate;
  v.autoRotateSpeed = 0.6;
  v.playerWrapper.rotation.y = fromBehind ? Math.PI + 0.5 : 0.45;
  v.globalLight.intensity = 3;
  v.cameraLight.intensity = 0.7;
  v.animation = new IdleAnimation();

  let look = { cape: "none", wings: "none", halo: "none", haloColor: 0, hat: "none", hatColor: 0, aura: "none", auraColor: 0 };
  const extras = {};
  let skinCall = 0;
  let capeCall = 0;
  let pet = null;
  let petKey = "";
  let petCall = 0;
  let stopCape = null;
  let wings = null;
  let wingKey = "";
  let wingCall = 0;
  const aura = new THREE.Group();
  const dots = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), glow(0xffffff, 0));
    dots.push(m);
    aura.add(m);
  }
  v.playerObject.add(aura);

  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    let i = 0;
    if (look.aura && look.aura !== "none") {
      auraPoints(look.aura, now, (x, y, z, size, bright, t) => {
        const d = dots[i++];
        if (!d) return;
        d.visible = true;
        d.position.set(x * 16, -16 + y * 16, z * 16);
        d.scale.setScalar(Math.max(0.35, size * 16 * 0.8));
        d.material.color = auraColour(look.aura, look.auraColor, t, now);
        d.material.opacity = Math.max(0, Math.min(1, bright));
      });
    }
    for (; i < dots.length; i++) dots[i].visible = false;
    if (wings) wings.tick(now);
    const halo = extras.halo;
    if (pet) pet.tick(now);
    if (halo) {
      halo.position.y = 11 + Math.sin(now / 700) * 0.25;
      if (halo.userData.spin) halo.rotation.y = -(now / 1000) * 0.21; // the wreath turns slowly, like in game
      halo.children.forEach((c) => {
        if (c.userData.orbit !== undefined) {
          const a = now / 600 + (c.userData.orbit * Math.PI * 2) / 3;
          c.position.set(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6);
        }
      });
    }
  };
  tick();

  return {
    viewer: v,
    setSize: (w, h) => v.setSize(w, h),
    /** Shows the first skin of `urls` that loads (each gets a few seconds), so a slow server never leaves the
     *  player blank. A newer setSkin call always wins over an older one that finishes late. */
    async setSkin(urls, slim) {
      const mine = ++skinCall;
      for (const url of [].concat(urls).filter(Boolean)) {
        const img = await loadImage(url, 7000);
        if (mine !== skinCall) return;
        if (img) {
          v.loadSkin(img, { model: slim ? "slim" : "default" });
          return;
        }
      }
      if (mine === skinCall) v.loadSkin(null);
    },
    /** look as the backend stores it; capeUrl / wingUrl are texture URLs (or null). */
    setLook(next, capeUrl, wingUrl) {
      look = { ...look, ...(next || {}) };
      const mine = ++capeCall;
      if (stopCape) {
        stopCape();
        stopCape = null;
      }
      // wings are their own model, so the cape (animated or not) shows under them, like in game
      const wk = wingUrl && look.wings && look.wings !== "none" ? look.wings + "|" + wingUrl : "";
      if (wk !== wingKey) {
        wingKey = wk;
        const mineW = ++wingCall;
        if (wings) {
          v.playerObject.remove(wings.group);
          wings.dispose();
          wings = null;
        }
        if (wk)
          makeWings(look.wings, wingUrl).then((w) => {
            if (!w) return;
            if (mineW !== wingCall) return w.dispose();
            wings = w;
            v.playerObject.add(w.group);
          });
      }
      try {
        if (CUSTOM_CAPES[look.cape]) {
          // Com Client's own capes are animated strips that come with the website
          loadImage(`/assets/cosmetics/capes/${look.cape.slice(3)}.png`, 7000).then((img) => {
            if (img && mine === capeCall) stopCape = playCape(v, img, look.cape);
          });
        } else if (capeUrl) v.loadCape(capeUrl, { backEquipment: "cape" });
        else v.loadCape(null);
      } catch {
        v.loadCape(null);
      }
      const head = v.playerObject.skin.head;
      for (const k of ["halo", "hat"]) {
        if (extras[k]) {
          head.remove(extras[k]);
          delete extras[k];
        }
      }
      if (look.halo && look.halo !== "none") head.add((extras.halo = makeHalo(look.halo, look.haloColor & 0xffffff)));
      if (look.hat && look.hat !== "none") head.add((extras.hat = makeHat(look.hat, look.hatColor & 0xffffff)));
      // the pet: the game's own mob model on (or beside) the shoulder
      const key = look.pet && look.pet !== "none" ? look.pet + (look.petLeft ? ":left" : "") : "";
      if (key !== petKey) {
        petKey = key;
        const mine2 = ++petCall;
        if (pet) {
          v.playerObject.remove(pet.group);
          pet.dispose();
          pet = null;
        }
        if (key)
          loadPet(look.pet, PET_BASE, !!look.petLeft).then((p) => {
            if (!p) return;
            if (mine2 !== petCall) return p.dispose();
            pet = p;
            v.playerObject.add(p.group);
          });
      }
    },
    dispose() {
      cancelAnimationFrame(frame);
      if (stopCape) stopCape();
      if (wings) wings.dispose();
      v.dispose();
    },
  };
}

// where pets' models and textures are (the launcher sets its own before creating a viewer)
let PET_BASE = "/assets/cosmetics/pets";
window.CCViewer = { create, setPetBase: (b) => (PET_BASE = b) };
