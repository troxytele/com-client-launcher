// Wings in 3D, the same as the game (WingsFeature.java): each wing is two flat textured panels (an arm and a hand, or a
// butterfly's fore and hind wing), posed and beating from wing_rigs.json, which the game reads too. They are their own
// model with their own texture, so a cape (animated ones too) still shows under them.
import * as THREE from "three";
import RIGS from "./wing_rigs.json";

const RAD = Math.PI / 180;
// the wings hang from the top of the body: the neck is y 8 here (the game's body pivot)
const NECK = 8;

/** The wing types, for labels ("Feathered", "Dragon", ...). */
export const WING_SHAPES = Object.fromEntries(Object.entries(RIGS.shapes).map(([k, v]) => [k, { label: v.label }]));

/** Which type a wing design is (WingsFeature.shapeOf). */
export function wingShape(id) {
  return RIGS.designs[id] || "feather";
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
 * One panel as a flat quad, in three's space (the game's x, -y, -z): it starts at its top-inner corner and runs
 * along +x (side 1) or -x (side -1) and down. The texture is the same on both faces.
 */
function panelMesh(p, side, material) {
  const [tw, th] = RIGS.texture;
  const [u, v, uw, vh] = p.uv;
  const [w, h] = p.size;
  const g = new THREE.BufferGeometry();
  const x = side * w;
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, x, 0, 0, x, -h, 0, 0, -h, 0], 3));
  const u0 = u / tw, u1 = (u + uw) / tw, v0 = 1 - v / th, v1 = 1 - (v + vh) / th;
  g.setAttribute("uv", new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex(side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/**
 * Wings for a skinview3d player: makeWings(id, url) -> Promise<{ group, tick(now), dispose() } | null>.
 * Add `group` to viewer.playerObject and call tick(performance.now()) every frame.
 */
export async function makeWings(id, url) {
  const img = await loadImage(url);
  if (!img) return null;
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext("2d").drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 });
  const shape = RIGS.shapes[wingShape(id)];

  const group = new THREE.Group();
  group.position.y = NECK;
  const joints = []; // [object, panel, side]
  for (const side of [1, -1]) {
    const byId = {};
    for (const p of shape.panels) {
      const joint = new THREE.Group();
      joint.rotation.order = "YZX";
      const [ax, ay, az] = p.at;
      joint.position.set(side * ax, -ay, -az);
      if (!p.parent) joint.scale.setScalar(shape.scale);
      joint.add(panelMesh(p, side, material));
      (p.parent ? byId[p.parent] : group).add(joint);
      byId[p.id] = joint;
      joints.push([joint, p, side]);
    }
  }
  const tick = (now) => {
    const a = ((now / 50) / shape.period) * Math.PI * 2;
    for (const [joint, p, side] of joints) {
      const [yaw, pitch, roll] = p.rot;
      const s = Math.sin(a + p.flap[2]);
      joint.rotation.set(pitch * RAD, side * (yaw + p.flap[1] * s) * RAD, side * (roll + p.flap[0] * s) * RAD);
    }
  };
  tick(performance.now());
  return {
    group,
    tick,
    dispose() {
      tex.dispose();
      material.dispose();
      group.traverse((o) => o.geometry && o.geometry.dispose());
    },
  };
}
