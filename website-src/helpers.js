import * as THREE from "three";
/** 0xRRGGBB, or a rainbow when -1. */
function colourAt(c, t, now) {
  if (c === -1) return new THREE.Color().setHSL((t * 0.6 + now / 4000) % 1, 0.75, 0.62);
  return new THREE.Color(c & 0xffffff);
}

/** The same aura shapes as the mod (Auras.java), in blocks around the feet. */
function auraPoints(style, now, out) {
  const time = now / 1000;
  if (style === "sparkles") {
    for (let ring = 0; ring < 3; ring++) {
      const h = 0.45 + ring * 0.5;
      const r = 0.62 - ring * 0.06;
      const tilt = (ring - 1) * 0.35;
      const speed = (ring % 2 === 0 ? 1 : -1) * (1.1 + ring * 0.25);
      for (let k = 0; k < 4; k++) {
        const a = time * speed + (k * Math.PI) / 2 + ring;
        const tw = 0.65 + 0.35 * Math.sin(time * 6 + k * 2.1 + ring);
        out(Math.cos(a) * r, h + Math.sin(a) * r * tilt, Math.sin(a) * r, 0.07, tw, (ring * 4 + k) / 12);
        for (let s = 1; s <= 3; s++) {
          const b = a - speed * 0.06 * s;
          out(Math.cos(b) * r, h + Math.sin(b) * r * tilt, Math.sin(b) * r, 0.05 - s * 0.01, tw * (0.55 - s * 0.15), (ring * 4 + k) / 12);
        }
      }
    }
  } else if (style === "embers") {
    for (let i = 0; i < 22; i++) {
      const life = 2.2 + (i % 5) * 0.25;
      const cycle = (time + i * 0.61803 * life) / life;
      const phase = cycle % 1;
      const angle = i * 2.39996 + Math.floor(cycle) * 1.3;
      const r = 0.35 + (((i * 37) % 10) / 10) * 0.3;
      const sway = Math.sin(time * 1.7 + i) * 0.08;
      out(Math.cos(angle) * r + sway, 0.05 + phase * 2.1, Math.sin(angle) * r - sway, 0.06 * (1 - phase * 0.5), Math.sin(Math.PI * phase) * 0.9, phase);
    }
  } else if (style === "helix") {
    const n = 26;
    for (let strand = 0; strand < 2; strand++) {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = t * Math.PI * 4 + time * 2.2 + strand * Math.PI;
        const edge = Math.min(1, Math.min(t, 1 - t) * 6 + 0.15);
        out(Math.cos(a) * 0.58, 0.05 + t * 2.0, Math.sin(a) * 0.58, 0.05, 0.85 * edge, t);
      }
    }
  }
}

const glow = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }));
  m.position.set(x, y, z);
  return m;
}

/** Halo above the head (head space: 1 unit = 1 skin pixel, top of the head at y = 8). */
function makeHalo(style, color) {
  const g = new THREE.Group();
  const ring = (r, tiltX = 0, tiltZ = 0) => {
    const outer = new THREE.Mesh(new THREE.TorusGeometry(r, 0.9, 10, 48), glow(color, 0.35));
    const core = new THREE.Mesh(new THREE.TorusGeometry(r, 0.3, 8, 48), glow(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex(), 0.95));
    const holder = new THREE.Group();
    holder.add(outer, core);
    holder.rotation.set(Math.PI / 2 + tiltX, 0, tiltZ);
    g.add(holder);
    return holder;
  };
  if (style === "double") {
    ring(4.3, 0.3, 0);
    ring(5, 0, -0.3);
  } else if (style === "crown") {
    ring(4.5);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = i % 2 === 0 ? 2.1 : 1.3;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.55, h, 6), glow(color, 0.9));
      spike.position.set(Math.cos(a) * 4.5, h / 2, Math.sin(a) * 4.5);
      g.add(spike);
    }
  } else if (style === "orbit") {
    ring(4.6).children.forEach((c) => (c.material.opacity *= 0.45));
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 10), glow(0xffffff, 0.95));
      s.userData.orbit = i;
      g.add(s);
    }
  } else {
    ring(4.5);
  }
  g.position.y = 11;
  g.userData.kind = "halo";
  return g;
}

// Floppy dog ears (the same boxes as the mod's WingsFeature.dogEars): each ear rises from the top of the head,
// arches over and hangs down beside it, pink inside. [out from, out to, up from, up to, back from, back to, part]
// in skin pixels; "out" from the middle of the head, "up" from the top of the hat layer, part c = colour, d = darker, p = pink
const DOG_EAR = [
  [1.2, 2.4, 0.0, 1.0, -1.2, 1.5, "c"],
  [1.8, 3.2, 0.7, 1.7, -1.3, 1.5, "c"],
  [2.6, 4.6, 1.3, 2.1, -1.3, 1.6, "c"],
  [4.2, 5.6, 0.5, 1.8, -1.3, 1.6, "c"],
  [4.8, 5.8, -2.2, 0.8, -1.3, 1.6, "c"],
  [4.95, 5.65, -2.8, -2.2, -1.0, 1.3, "d"],
  [2.4, 4.5, 0.0, 1.3, -0.9, 1.2, "p"],
  [4.5, 4.85, -1.9, 0.5, -0.9, 1.2, "p"],
];

/** Blocky hats, like the mod's. */
function makeHat(style, color) {
  const g = new THREE.Group();
  if (style === "crown") {
    const gold = 0xf2c230;
    const o = 4.6;
    g.add(box(o * 2, 2, 0.6, gold, 0, 9.6, -o + 0.3));
    g.add(box(o * 2, 2, 0.6, gold, 0, 9.6, o - 0.3));
    g.add(box(0.6, 2, o * 2, gold, -o + 0.3, 9.6, 0));
    g.add(box(0.6, 2, o * 2, gold, o - 0.3, 9.6, 0));
    for (const [x, z] of [[-3.5, -o], [0, -o], [3.5, -o], [-3.5, o], [0, o], [3.5, o], [-o, 0], [o, 0]]) {
      const p = box(1, 1.6, 1, gold);
      p.position.set(x, 11.2, z);
      g.add(p);
    }
    const ruby = box(1, 1, 0.4, 0xe0304a);
    ruby.position.set(0, 9.6, -o - 0.1);
    g.add(ruby);
  } else if (style === "cat_ears") {
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      const outer = box(3, 3, 1, color);
      const inner = box(1.6, 1.8, 0.3, 0xffb3c7);
      inner.position.set(0, -0.3, 0.6); // the pink inside faces forward (+z: the face's side)
      ear.add(outer, inner);
      ear.position.set(side * 2.6, 9.6, 0);
      ear.rotation.z = side * -0.25;
      g.add(ear);
    }
  } else if (style === "dog_ears") {
    const dark = new THREE.Color(color).multiplyScalar(0.72).getHex();
    for (const side of [-1, 1]) {
      for (const [a0, a1, u0, u1, z0, z1, part] of DOG_EAR) {
        const col = part === "p" ? 0xf6a9bd : part === "d" ? dark : color;
        // three.js: the face is at +z, so the mod's "back" (+z there) runs the other way
        g.add(box(a1 - a0, u1 - u0, z1 - z0, col, (side * (a0 + a1)) / 2, 8.5 + (u0 + u1) / 2, -(z0 + z1) / 2));
      }
    }
  }
  g.userData.kind = "hat";
  return g;
}

// the client's wing pose: vanilla elytra rest angle, spread 76 degrees, 20 degree flap every 2 s, 0.65 size,
// a little up and back (skin pixels: 1 block = 16)
const ELYTRA_REST = 0.2617994;
const WING_SPREAD = (76 * Math.PI) / 180;
const WING_FLAP = (20 * Math.PI) / 180;
const WING_SCALE = 0.65;
const WING_UP = 0.08 * 16;
const WING_BACK = 0.18 * 16;


export { auraPoints, colourAt, glow, makeHalo, makeHat };
