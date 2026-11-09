// Wings in 3D, the same as the game (WingsFeature.java): the elytra shape held out to the sides and beating, in five
// types. They are their own model with their own texture, so a cape (animated ones too) still shows under them;
// skinview3d's built-in elytra shares the cape's texture, which is why wings used to hide the cape.
import * as THREE from "three";
import { ElytraObject } from "skinview3d";

const ELYTRA_REST = 0.2617994;
const RAD = Math.PI / 180;
// right against the back (just behind the jacket layer), so no gap shows from any side
const BACK_BASE = 2.3;

/** scale, spread (deg), flap (deg), ms per beat, tilt back (rad), up and back (blocks): WingsFeature.Shape */
export const WING_SHAPES = {
  classic: { label: "Classic", scale: 0.65, spread: 76, flap: 20, period: 2000, tilt: 0, up: 0.08, back: 0.18 },
  butterfly: { label: "Butterfly", scale: 0.6, spread: 108, flap: 26, period: 700, tilt: 0.1, up: 0.02, back: 0.17, pairs: 2 },
  seraph: { label: "Seraph", scale: 0.8, spread: 112, flap: 12, period: 3000, tilt: 0.15, up: 0.12, back: 0.2 },
  fairy: { label: "Fairy", scale: 0.45, spread: 98, flap: 24, period: 400, tilt: 0.05, up: 0.04, back: 0.17 },
  drake: { label: "Drake", scale: 0.85, spread: 84, flap: 28, period: 2500, tilt: 0.3, up: 0.06, back: 0.2 },
};

/** Which type a wing design is (WingsFeature.shapeOf). */
export function wingShape(id) {
  if (["monarch", "morpho", "celestial"].includes(id)) return "butterfly";
  if (["seraph", "void", "golden", "phoenix"].includes(id)) return "seraph";
  if (["pixie", "snowflake"].includes(id)) return "fairy";
  if (["bat", "emerald"].includes(id)) return "drake";
  return "classic";
}

const loadImage = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

/**
 * Wings for a skinview3d player: makeWings(id, url) -> Promise<{ group, tick(now), dispose() } | null>.
 * Add `group` to viewer.playerObject and call tick(performance.now()) every frame.
 */
export async function makeWings(id, url) {
  const img = await loadImage(url);
  if (!img) return null;
  const toTex = (image) => {
    const cv = document.createElement("canvas");
    cv.width = image.width;
    cv.height = image.height;
    cv.getContext("2d").drawImage(image, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  };
  const tex = toTex(img);
  const shape = WING_SHAPES[wingShape(id)];
  // butterflies: the lower pair is the rounder hind wing, with its own texture (<id>_lower.png)
  let lowerTex = null;
  if (shape.pairs === 2) {
    const low = await loadImage(url.replace(/\.png$/, "_lower.png"));
    if (low) lowerTex = toTex(low);
  }
  const group = new THREE.Group();
  const pairs = [];
  for (let i = 0; i < (shape.pairs || 1); i++) {
    const el = new ElytraObject();
    el.map = i === 1 && lowerTex ? lowerTex : tex;
    el.leftWing.rotation.order = "ZYX";
    el.rightWing.rotation.order = "ZYX";
    // like the game: the wing boxes are 2 px thick and start at their pivot (skinview3d's are 4 px and centred)
    for (const w of [el.leftWing, el.rightWing]) {
      const mesh = w.children[0];
      if (mesh) {
        mesh.scale.z = 0.5;
        mesh.position.z = -1;
      }
    }
    group.add(el);
    pairs.push(el);
  }
  const tick = (now) => {
    pairs.forEach((el, i) => {
      const lower = i === 1; // the butterfly's small lower pair
      const flap = Math.sin((now / shape.period) * Math.PI * 2 + (lower ? 0.6 : 0)) * shape.flap * RAD;
      const spread = (lower ? 58 : shape.spread) * RAD;
      el.leftWing.rotation.set(ELYTRA_REST + flap + shape.tilt, 0.01, ELYTRA_REST + spread);
      el.updateRightWing();
      el.scale.setScalar(lower ? shape.scale * 0.68 : shape.scale);
      // game: up is -y, back is +z; here up is +y and the back is -z (1 block = 16)
      el.position.set(0, 8 + shape.up * 16 - (lower ? 0.2 * 16 : 0), -(BACK_BASE + (shape.back - 0.18) * 16 + (lower ? 0.16 : 0)));
    });
  };
  tick(performance.now());
  return {
    group,
    tick,
    dispose() {
      tex.dispose();
      if (lowerTex) lowerTex.dispose();
      pairs.forEach((el) => el.material.dispose());
    },
  };
}
