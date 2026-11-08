// The website's 3D player: skin + cape / wings + halo + hat + aura, the same as the launcher's Locker and the game.
// Built into website/assets/viewer.js with:  npm run build:web
import * as THREE from "three";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { auraPoints, colourAt, glow, makeHalo, makeHat } from "./helpers.js";

const ELYTRA_REST = 0.2617994;
const WING_SPREAD = (76 * Math.PI) / 180;
const WING_FLAP = (20 * Math.PI) / 180;
const WING_SCALE = 0.65;
const WING_UP = 0.08 * 16;
const WING_BACK = 0.18 * 16;

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
        d.material.color = colourAt(look.auraColor, t, now);
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
      el.position.set(0, 8 + WING_UP, -2 - WING_BACK);
    }
    const halo = extras.halo;
    if (halo) {
      halo.position.y = 11 + Math.sin(now / 700) * 0.25;
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
    async setSkin(url, slim) {
      try {
        if (url) await v.loadSkin(url, { model: slim ? "slim" : "default" });
        else v.loadSkin(null);
      } catch {
        v.loadSkin(null);
      }
    },
    /** look as the backend stores it; capeUrl / wingUrl are texture URLs (or null). */
    setLook(next, capeUrl, wingUrl) {
      look = { ...look, ...(next || {}) };
      try {
        if (wingUrl) v.loadCape(wingUrl, { backEquipment: "elytra" });
        else if (capeUrl) v.loadCape(capeUrl, { backEquipment: "cape" });
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
      v.dispose();
    },
  };
}

window.CCViewer = { create };
