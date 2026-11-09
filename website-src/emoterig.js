// A Minecraft player that can bend at the elbows and knees, posed by emote clips (the same clips and the same maths as
// the mod's EmoteClips.java). Used for emote previews (and the website).
import * as THREE from "three";

// ---------------------------------------------------------------- clips: keyframes, smooth through every key

/** Catmull-Rom through looping keys [[t, ...values]] (t in 0..period). */
function sampleLoop(keys, period, t) {
  const n = keys.length;
  if (n === 1) return keys[0].slice(1);
  t = ((t % period) + period) % period;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (keys[k][0] > t) {
      i = k - 1;
      break;
    }
  }
  if (i < 0) i = n - 1;
  const at = (k) => keys[((k % n) + n) % n];
  const p1 = at(i), p2 = at(i + 1), p0 = at(i - 1), p3 = at(i + 2);
  let t1 = p1[0], t2 = p2[0];
  if (t2 <= t1) t2 += period;
  let tt = t;
  if (tt < t1) tt += period;
  const u = (tt - t1) / (t2 - t1 || 1);
  const out = [];
  for (let d = 1; d < p1.length; d++) {
    const a = p0[d], b = p1[d], c = p2[d], e = p3[d];
    out.push(0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - e) * u * u + (-a + 3 * b - 3 * c + e) * u * u * u));
  }
  return out;
}

/** The pose of a clip at time t (seconds): { part: [values] }. */
export function samplePose(clip, t) {
  const pose = {};
  for (const [part, keys] of Object.entries(clip.keys)) pose[part] = sampleLoop(keys, clip.period, t);
  return pose;
}

// ---------------------------------------------------------------- the player model (MC model space: px, +y down, front -z)

// part: pivot, cube origin + size, uv, layer uv, the split height (cube y) for bendy limbs
const PARTS = {
  head: { pivot: [0, 0, 0], o: [-4, -8, -4], s: [8, 8, 8], uv: [0, 0], layer: [32, 0], grow: 0.5 },
  body: { pivot: [0, 0, 0], o: [-4, 0, -2], s: [8, 12, 4], uv: [16, 16], layer: [16, 32], grow: 0.25 },
  rightArm: { pivot: [-5, 2, 0], o: [-3, -2, -2], s: [4, 12, 4], uv: [40, 16], layer: [40, 32], grow: 0.25, split: 4 },
  leftArm: { pivot: [5, 2, 0], o: [-1, -2, -2], s: [4, 12, 4], uv: [32, 48], layer: [48, 48], grow: 0.25, split: 4 },
  rightLeg: { pivot: [-1.9, 12, 0], o: [-2, 0, -2], s: [4, 12, 4], uv: [0, 16], layer: [0, 32], grow: 0.25, split: 6 },
  leftLeg: { pivot: [1.9, 12, 0], o: [-2, 0, -2], s: [4, 12, 4], uv: [16, 48], layer: [0, 48], grow: 0.25, split: 6 },
};
const SLIM = { rightArm: { pivot: [-5, 2.5, 0], o: [-2, -2, -2], s: [3, 12, 4] }, leftArm: { pivot: [5, 2.5, 0], o: [-1, -2, -2], s: [3, 12, 4] } };

/** The 6 faces of a box-UV cuboid: [verts(4) as [x,y,z,u,v]] (the game's own layout). */
function cuboidQuads(o, s, uv, grow) {
  const [sx, sy, sz] = s;
  const x0 = o[0] - grow, x1 = o[0] + sx + grow, y0 = o[1] - grow, y1 = o[1] + sy + grow, z0 = o[2] - grow, z1 = o[2] + sz + grow;
  const [u, v] = uv;
  const j = u, k = u + sz, l = u + sz + sx, m = u + sz + sx + sx, n = u + sz + sx + sz, oo = u + sz + sx + sz + sx;
  const p = v, q = v + sz, r = v + sz + sy;
  const V = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [
    ["down", [5, 4, 0, 1], k, p, l, q], ["up", [2, 3, 7, 6], l, q, m, p], ["west", [0, 4, 7, 3], j, q, k, r],
    ["north", [1, 0, 3, 2], k, q, l, r], ["east", [5, 1, 2, 6], l, q, n, r], ["south", [4, 5, 6, 7], n, q, oo, r],
  ];
  return faces.map(([dir, idx, u1, v1, u2, v2]) => {
    const quv = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]];
    return { dir, v: idx.map((ix, i) => [...V[ix], quv[i][0], quv[i][1]]) };
  });
}

/** Cuts a limb's quads at height y: the side faces are cut with their texture, the top/bottom go to their half,
 *  and each half gets a cap at the joint (so a bent elbow or knee looks solid). */
function splitQuads(quads, y) {
  const upper = [], lower = [];
  const cut = (a, b) => {
    const k = (y - a[1]) / (b[1] - a[1]);
    return a.map((x, i) => x + (b[i] - x) * k);
  };
  for (const q of quads) {
    const ys = q.v.map((p) => p[1]);
    if (Math.max(...ys) <= y + 1e-4) upper.push(q);
    else if (Math.min(...ys) >= y - 1e-4) lower.push(q);
    else {
      // side face: vertices 0,1 are at one end, 2,3 at the other (y0 -> y1 for 'west/north/east/south')
      const [a, b, c, d] = q.v; // a,b top (y small), c,d bottom
      const bc = cut(b, c), ad = cut(a, d);
      upper.push({ dir: q.dir, v: [a, b, bc, ad] });
      lower.push({ dir: q.dir, v: [ad, bc, c, d] });
    }
  }
  // joint caps: the bottom face's texture under the upper half, the top face's over the lower half
  const down = quads.find((q) => q.dir === "down"), up = quads.find((q) => q.dir === "up");
  if (up) upper.push({ dir: "cap", v: up.v.map((p) => [p[0], y, p[2], p[3], p[4]]) });
  if (down) lower.push({ dir: "cap", v: down.v.map((p) => [p[0], y, p[2], p[3], p[4]]) });
  return [upper, lower];
}

function mesh(quads, mat, shift = [0, 0, 0]) {
  const pos = [], uv = [];
  for (const q of quads) {
    for (const t of [0, 1, 2, 0, 2, 3]) {
      const p = q.v[t];
      pos.push(p[0] - shift[0], p[1] - shift[1], p[2] - shift[2]);
      uv.push(p[3] / 64, p[4] / 64);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** A player from a skin texture. Returns { group, pose(p) }; group is in three.js space (feet at y = 0, face +z). */
export function makePlayer(texture, slim = false) {
  const base = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.5 });
  const layer = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, alphaTest: 0.1 });
  const group = new THREE.Group();
  const root = new THREE.Group(); // MC model space
  root.rotation.x = Math.PI;
  root.position.y = 24; // MC y = 24 is the feet
  group.add(root);
  const mover = new THREE.Group(); // the whole body (bob, turn)
  root.add(mover);
  const parts = {};
  for (const [name, def0] of Object.entries(PARTS)) {
    const def = { ...def0, ...(slim && SLIM[name] ? SLIM[name] : {}) };
    const g = new THREE.Group();
    g.position.set(...def.pivot);
    g.rotation.order = "ZYX";
    mover.add(g);
    parts[name] = g;
    const inner = cuboidQuads(def.o, def.s, def.uv, 0);
    const outer = cuboidQuads(def.o, def.s, def.layer, def.grow);
    if (def.split === undefined) {
      g.add(mesh(inner, base), mesh(outer, layer));
      continue;
    }
    const [iu, il] = splitQuads(inner, def.split);
    const [ou, ol] = splitQuads(outer, def.split);
    g.add(mesh(iu, base), mesh(ou, layer));
    // the lower half turns around the joint: the middle of the limb at the split height
    const jx = def.o[0] + def.s[0] / 2, jz = def.o[2] + def.s[2] / 2;
    const low = new THREE.Group();
    low.position.set(jx, def.split, jz);
    low.rotation.order = "ZYX";
    low.add(mesh(il, base, [jx, def.split, jz]), mesh(ol, layer, [jx, def.split, jz]));
    g.add(low);
    parts[name + "Low"] = low;
  }
  const BEND = { rightElbow: "rightArmLow", leftElbow: "leftArmLow", rightKnee: "rightLegLow", leftKnee: "leftLegLow" };
  return {
    group,
    /** pose: { head|body|rightArm|leftArm|rightLeg|leftLeg: [pitch,yaw,roll], *Elbow|*Knee: [bend], root: [x,y,z,yaw,roll] } */
    pose(p) {
      for (const name of Object.keys(PARTS)) {
        const v = p[name] || [0, 0, 0];
        parts[name].rotation.set(v[0], v[1], v[2]);
      }
      // elbows and knees: [bend, twist] (bend: pitch of the lower half; twist: its roll)
      for (const [k, part] of Object.entries(BEND)) parts[part].rotation.set(p[k] ? p[k][0] : 0, 0, p[k] && p[k].length > 1 ? p[k][1] : 0);
      const r = p.root || [0, 0, 0, 0, 0];
      mover.position.set(r[0], r[1], r[2]);
      mover.rotation.set(0, r[3] || 0, r[4] || 0);
    },
  };
}
