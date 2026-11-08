// The website's 3D player: skin + cape / wings + halo + hat + aura, the same as the launcher's Locker and the game.
// Built into website/assets/viewer.js with:  npm run build:web
import * as THREE from "three";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { CUSTOM_CAPES, auraColour, auraPoints, glow, makeHalo, makeHat, playCape } from "./helpers.js";

const ELYTRA_REST = 0.2617994;
const WING_SPREAD = (76 * Math.PI) / 180;
const WING_FLAP = (20 * Math.PI) / 180;
const WING_SCALE = 0.65;
const WING_UP = 0.08 * 16;
// right against the back (just behind the jacket layer), so no gap shows from any side
const WING_BACK = 2.3;

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
  let stopCape = null;
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
    const el = v.playerObject.elytra;
    if (el.visible) {
      // Minecraft turns model parts pitch first, then roll (ZYX); three.js defaults to XYZ, which laid the
      // spread wings flat and away from the back
      el.leftWing.rotation.order = "ZYX";
      el.rightWing.rotation.order = "ZYX";
      const flap = Math.sin((now / 2000) * Math.PI * 2) * WING_FLAP;
      el.leftWing.rotation.set(ELYTRA_REST + flap, 0.01, ELYTRA_REST + WING_SPREAD);
      el.updateRightWing();
      el.scale.setScalar(WING_SCALE);
      // like the game: the wing boxes are 2 px thick and start at their pivot, which sits WING_BACK behind the
      // middle of the body (skinview3d's own elytra is 4 px thick, centred, and already pushed 2 px back)
      for (const w of [el.leftWing, el.rightWing]) {
        const mesh = w.children[0];
        if (mesh) {
          mesh.scale.z = 0.5;
          mesh.position.z = -1;
        }
      }
      el.position.set(0, 8 + WING_UP, -WING_BACK);
    }
    const halo = extras.halo;
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
      try {
        if (wingUrl) v.loadCape(wingUrl, { backEquipment: "elytra" });
        else if (CUSTOM_CAPES[look.cape]) {
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
    },
    dispose() {
      cancelAnimationFrame(frame);
      if (stopCape) stopCape();
      v.dispose();
    },
  };
}

window.CCViewer = { create };
