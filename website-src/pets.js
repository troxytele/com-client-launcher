// Pets in 3D, the same as the game: Minecraft's own mob models (cuboids exported from the game's model code, in
// models.json) with the game's own textures, sitting on or flying beside the player's shoulder like Pets.java.
import * as THREE from "three";

// id -> [flies, scale] (Pets.java)
const PETS = {
  bee: [true, 0.55], ender_dragon: [true, 0.06], allay: [true, 0.55], bat: [true, 0.5],
  parrot: [false, 1.0], fox: [false, 0.42], cat: [false, 0.42], frog: [false, 0.55],
  axolotl: [false, 0.5], chicken: [false, 0.5], slime: [false, 0.45],
  // Com Client's own chibi pets (voxels.py): head bobs, ears and tails wiggle
  goat: [false, 0.48], lamb: [false, 0.6], pumpkin_cat: [false, 0.55], koala: [false, 0.6], duck: [false, 0.6], penguin: [false, 0.55],
  // coins that hover beside you and spin
  coin_btc: [true, 0.62], coin_eth: [true, 0.62], coin_com: [true, 0.62], coin_gem: [true, 0.62],
};
const OWN = new Set(["goat", "lamb", "pumpkin_cat", "koala", "duck", "penguin", "coin_btc", "coin_eth", "coin_com", "coin_gem"]);

let modelsP = null;
const loadModels = (base) => (modelsP ||= fetch(`${base}/models.json`).then((r) => r.json()));
const texCache = {};
function loadTex(url) {
  return (texCache[url] ||= new Promise((res) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      },
      undefined,
      () => res(null),
    );
  }));
}

/** One Minecraft cuboid with box UVs (ModelPart.Cuboid), in the game's model space (pixels, +y down). */
function cuboid(c, tw, th, pos, uv) {
  const [ox, oy, oz] = c.o;
  const [sx, sy, sz] = c.s;
  const [gx, gy, gz] = c.g;
  let x0 = ox - gx, x1 = ox + sx + gx;
  const y0 = oy - gy, y1 = oy + sy + gy, z0 = oz - gz, z1 = oz + sz + gz;
  if (c.m) [x0, x1] = [x1, x0];
  const W = tw * c.ts[0], H = th * c.ts[1];
  const [u, v] = c.uv;
  // u: j k l m n o, v: p q r (the game's own layout)
  const j = u, k = u + sz, l = u + sz + sx, m = u + sz + sx + sx, n = u + sz + sx + sz, o = u + sz + sx + sz + sx;
  const p = v, q = v + sz, r = v + sz + sy;
  const V = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // vertex order and uv rectangles per face (DOWN, UP, WEST, NORTH, EAST, SOUTH)
  const faces = [
    ["D", [5, 4, 0, 1], k, p, l, q],
    ["U", [2, 3, 7, 6], l, q, m, p],
    ["W", [0, 4, 7, 3], j, q, k, r],
    ["N", [1, 0, 3, 2], k, q, l, r],
    ["E", [5, 1, 2, 6], l, q, n, r],
    ["S", [4, 5, 6, 7], n, q, o, r],
  ];
  for (const [dir, idx, u1, v1, u2, v2] of faces) {
    if (c.f && !c.f.includes(dir)) continue;
    // Quad: v0 -> (u2, v1), v1 -> (u1, v1), v2 -> (u1, v2), v3 -> (u2, v2); a mirrored cuboid flips its quads
    let quv = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]];
    let qi = idx;
    if (c.m) {
      qi = [...idx].reverse();
      quv = [...quv].reverse();
    }
    const tri = [0, 1, 2, 0, 2, 3];
    for (const t of tri) {
      pos.push(...V[qi[t]]);
      uv.push(quv[t][0] / W, quv[t][1] / H);
    }
  }
}

function buildPart(p, tw, th, mat, parts) {
  const g = new THREE.Group();
  g.name = p.n;
  const [x, y, z, pitch, yaw, roll, xs, ys, zs] = p.t;
  g.position.set(x, y, z);
  g.rotation.order = "ZYX"; // the game rotates by Z, then Y, then X
  g.rotation.set(pitch, yaw, roll);
  g.scale.set(xs || 1, ys || 1, zs || 1);
  g.userData.rest = { x, y, z, pitch, yaw, roll };
  if (p.c.length) {
    const pos = [], uv = [];
    for (const c of p.c) cuboid(c, tw, th, pos, uv);
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, mat));
    }
  }
  parts[p.n] = g;
  for (const ch of p.ch) g.add(buildPart(ch, tw, th, mat, parts));
  return g;
}

/** Sitting poses for pets that sit on the shoulder (from the game's FelineEntityModel). */
function pose(id, parts) {
  if (id === "cat") {
    const s = (n, f) => parts[n] && f(parts[n]);
    s("body", (b) => { b.rotation.x = Math.PI / 4; b.position.y += -4; b.position.z += 5; });
    s("head", (h) => { h.position.y += -3.3; h.position.z += 1; });
    s("tail1", (t) => { t.position.y += 8; t.position.z += -2; t.rotation.x = 1.7278761; });
    s("tail2", (t) => { t.position.y += 2; t.position.z += -0.8; t.rotation.x = 2.670354; });
    for (const n of ["left_front_leg", "right_front_leg"]) s(n, (l) => { l.rotation.x = -0.15707964; l.position.y = 16.1; l.position.z = -7; });
    for (const n of ["left_hind_leg", "right_hind_leg"]) s(n, (l) => { l.rotation.x = -Math.PI / 2; l.position.y = 21; l.position.z = 1; });
  }
}

/**
 * Loads a pet. base: where models.json and tex/ live. Returns { group, tick(now) } or null; add group to the
 * skinview3d playerObject. left: on the player's left shoulder.
 */
export { buildPart, loadTex };

export async function loadPet(id, base, left) {
  const info = PETS[id];
  if (!info) return null;
  const [flies, scale] = info;
  const [models, tex] = await Promise.all([loadModels(base), loadTex(`${base}/tex/${id}.png`)]);
  if (!tex) return null;
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide });
  const holder = new THREE.Group(); // at the shoulder
  const flip = new THREE.Group(); // the game's model space (+y down, front at -z) -> three.js (+y up, front at +z)
  flip.rotation.x = Math.PI;
  flip.scale.setScalar(scale);
  holder.add(flip);
  const parts = {};
  if (id === "slime") {
    const inner = models.slime_inner, outer = models.slime_outer;
    const ig = buildPart(inner.root, inner.w, inner.h, mat, parts);
    ig.position.y -= 24;
    flip.add(ig);
    const glass = new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide });
    const og = buildPart(outer.root, outer.w, outer.h, glass, {});
    og.position.y -= 24;
    flip.add(og);
  } else {
    const m = models[id];
    const root = buildPart(m.root, m.w, m.h, mat, parts);
    root.position.y -= 24; // the mob stands on y = 24 px: put its feet on the shoulder
    flip.add(root);
  }
  pose(id, parts);
  // where it sits: on top of the shoulder, or hovering beside it (Pets.render, in skin pixels)
  const side = left ? 1 : -1;
  const base0 = flies ? [side * 12.5, 8 + 5.1, -1.9] : [side * 6.4, 8, 0];
  holder.position.set(...base0);
  const wings = Object.entries(parts).filter(([n]) => n.includes("wing"));
  const spinY = (n) => id === "bat" || id === "allay";
  return {
    group: holder,
    tick(now) {
      const t = now / 1000;
      if (flies) {
        holder.position.y = base0[1] + Math.sin(t * 2) * 1.1;
        holder.rotation.y = Math.sin(t * 0.6) * 0.25;
        holder.rotation.z = side * 0.1 * Math.sin(t * 1.4);
      }
      if (id === "slime") {
        const sq = Math.cos(t * 6.4) * 0.08;
        flip.scale.set(scale * (1 + sq), scale * (1 - sq), scale * (1 + sq));
      }
      if (OWN.has(id)) {
        // Pets.java (own pets): the head bobs, ears and tails wiggle, wings flutter now and then
        const P = (n) => parts[n];
        if (P("head")) P("head").rotation.x = P("head").userData.rest.pitch + Math.sin(t * 2.2) * 0.06;
        for (const n of ["left_ear", "right_ear"]) if (P(n)) P(n).rotation.z = P(n).userData.rest.roll + (n.startsWith("left") ? 1 : -1) * Math.max(0, Math.sin(t * 3.1)) * 0.25;
        if (P("tail")) P("tail").rotation.y = Math.sin(t * 6) * 0.4;
        if (P("spin")) P("spin").rotation.y = t * 2.4;
        for (const n of ["left_wing", "right_wing"]) if (P(n)) P(n).rotation.z = P(n).userData.rest.roll + (n.startsWith("left") ? -1 : 1) * Math.max(0, Math.sin(t * 9)) * Math.max(0, Math.sin(t * 0.9)) * 0.6;
        return;
      }
      for (const [n, w] of wings) {
        const r = w.userData.rest;
        const s = n.includes("left") ? -1 : 1;
        const speed = id === "bee" ? 40 : id === "chicken" ? 3 : 9;
        const amp = id === "bee" ? 0.5 : id === "chicken" ? 0.08 : id === "ender_dragon" ? 0.6 : 0.7;
        const a = Math.sin(t * speed) * amp;
        if (spinY(n)) w.rotation.y = r.yaw + s * a;
        else w.rotation.z = r.roll + s * a;
      }
    },
    dispose() {
      holder.traverse((o) => o.geometry && o.geometry.dispose());
      mat.dispose();
    },
  };
}
