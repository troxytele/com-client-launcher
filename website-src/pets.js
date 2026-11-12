// Pets in 3D, the same as the game: Minecraft's own mob models (cuboids exported from the game's model code, in
// models.json) with the game's own textures, sitting on or flying beside the player's shoulder like Pets.java.
import * as THREE from "three";

// id -> [flies, scale] (Pets.java)
const PETS = {
  bee: [true, 0.55],
  ender_dragon: [true, 0.5],
  allay: [true, 0.55],
  bat: [true, 0.55],
  parrot: [false, 0.55],
  fox: [false, 0.5],
  cat: [false, 0.55],
  frog: [false, 0.55],
  axolotl: [false, 0.55],
  chicken: [false, 0.55],
  slime: [false, 0.45],
  goat: [false, 0.48],
  lamb: [false, 0.6],
  pumpkin_cat: [false, 0.55],
  koala: [false, 0.6],
  duck: [false, 0.6],
  penguin: [false, 0.55],
  capybara: [false, 0.5],
  red_panda: [false, 0.55],
  bunny: [false, 0.6],
  owl: [false, 0.55],
  corgi: [false, 0.5],
  panda: [false, 0.55],
  coin_btc: [true, 0.62],
  coin_eth: [true, 0.62],
  coin_ltc: [true, 0.62],
  warden: [false, 0.5],
  sniffer: [false, 0.5],
  baby_turtle: [false, 0.55],
  turtle: [false, 0.5],
  creeper: [false, 0.55],
  ghast: [true, 0.42],
  mooshroom: [false, 0.55],
  blaze: [true, 0.55],
  camel: [false, 0.5],
  hamster: [false, 0.55],
  hedgehog: [false, 0.55],
  otter: [false, 0.55],
  sloth: [false, 0.55],
  seal: [false, 0.55],
  shiba: [false, 0.55],
  husky: [false, 0.55],
  black_cat: [false, 0.55],
  white_cat: [false, 0.55],
  pig: [false, 0.55],
  snail: [false, 0.55],
  jellyfish: [true, 0.55],
  dragon_green: [true, 0.55],
  dragon_gold: [true, 0.55],
  dragon_ice: [true, 0.55],
  phoenix: [true, 0.55],
  ghost: [true, 0.55],
  snowman: [false, 0.5],
};
// every pet is Com Client's own chibi voxel model now
const OWN = new Set(Object.keys(PETS));

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
  if (id === "cat" && !OWN.has(id)) {
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
  {
    const m = models[id];
    if (!m) return null;
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
  // the Locker's pet colour, like Pets.java: -1 own colours, -2 rainbow, else a tint mixed 30% with white so the
  // shading stays (multiplied straight onto the texture, like the game)
  let tint = -1;
  const mats = [];
  holder.traverse((o) => o.material && !mats.includes(o.material) && mats.push(o.material));
  const paint = (rgb) => {
    const ch = (s) => { const c = (rgb >> s) & 255; return (c + ((255 - c) * 30) / 100) / 255; };
    for (const m of mats) m.color.setRGB(ch(16), ch(8), ch(0));
  };
  const hue = (h) => {
    h -= Math.floor(h);
    const sat = 0.65, i = Math.floor(h * 6), f = h * 6 - i, p = 1 - sat, q = 1 - sat * f, u = 1 - sat * (1 - f);
    const [r, g, b] = [[1, u, p], [q, 1, p], [p, 1, u], [p, q, 1], [u, p, 1], [1, p, q]][i % 6];
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  };
  const spinY = (n) => id === "bat" || id === "allay";
  return {
    group: holder,
    setColor(c) {
      tint = c ?? -1;
      if (tint === -1) for (const m of mats) m.color.setRGB(1, 1, 1);
      else if (tint >= 0) paint(tint & 0xffffff);
    },
    tick(now) {
      const t = now / 1000;
      if (tint === -2) paint(hue(t / 6)); // Fx.hue(age / 120): once around every 6 seconds
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
        const age = t * 20;
        for (const [n, g] of Object.entries(parts)) {
          const r = g.userData.rest;
          if (!r) continue;
          if (n === "waddle") g.rotation.z = r.roll + Math.sin(age * 0.22) * 0.08;
          else if (n === "sway") g.rotation.z = r.roll + Math.sin(age * 0.05) * 0.06;
          else if (n === "sniff") g.rotation.x = r.pitch + Math.max(0, Math.sin(age * 0.9)) * Math.max(0, Math.sin(age * 0.08)) * 0.25;
          else if (n.startsWith("tentacle")) g.rotation.x = r.pitch + Math.sin(age * 0.15 + n.length) * 0.18;
          else if (n.startsWith("gill")) g.rotation.z = r.roll + (n.startsWith("gill_l") ? 1 : -1) * Math.sin(age * 0.2) * 0.12;
          else if (n === "flash") g.visible = age % 90 > 80 && Math.floor(age % 90) % 3 !== 0;
          else if (n === "flicker") { const k = age % 110; g.visible = !((k > 96 && k < 100) || (k > 102 && k < 104)); }
        }
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
      for (const m of mats) m.dispose();
    },
  };
}
