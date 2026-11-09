import * as THREE from "three";
import { buildPart, loadTex } from "./pets.js";

// hats made of voxels (voxels.py): the same models and textures as the mod, loaded from HAT_BASE
const VOXEL_HATS = new Set(["bunny_hat", "axolotl_hat", "frog_hat"]);
let HAT_BASE = "/assets/cosmetics/hats";
let hatModels = null;
function setHatBase(b) {
  HAT_BASE = b;
  hatModels = null;
}
function voxelHat(style, g) {
  hatModels ||= fetch(`${HAT_BASE}/models.json`).then((r) => r.json());
  Promise.all([hatModels, loadTex(`${HAT_BASE}/tex/${style}.png`)])
    .then(([ms, tex]) => {
      const m = ms[style];
      if (!m || !tex) return;
      const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide });
      const flip = new THREE.Group(); // the game's model space (+y down, front at -z) -> three.js
      flip.rotation.x = Math.PI;
      flip.add(buildPart(m.root, m.w, m.h, mat, {}));
      g.add(flip);
    })
    .catch(() => {});
}
/** 0xRRGGBB, or a rainbow when -1. */
function colourAt(c, t, now) {
  if (c === -1) return new THREE.Color().setHSL((t * 0.6 + now / 4000) % 1, 0.75, 0.62);
  return new THREE.Color(c & 0xffffff);
}

/** The colour of an aura point: snow is always snow-white, the rest use the chosen colour. */
function auraColour(style, c, t, now) {
  return style === "snow" ? new THREE.Color(0xeef6ff) : colourAt(c, t, now);
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
  } else if (style === "snow") {
    // flakes drifting down around the player, swaying, fading in at the top and out at the feet
    for (let i = 0; i < 26; i++) {
      const life = 3.2 + (i % 4) * 0.4;
      const cyc = (time + i * 0.61803 * life) / life;
      const phase = cyc % 1;
      const angle = i * 2.39996 + Math.floor(cyc) * 1.7;
      const r = 0.45 + (((i * 53) % 10) / 10) * 0.4;
      const sway = Math.sin(time * 1.3 + i * 1.7) * 0.12;
      const fade = Math.min(1, Math.min(phase * 5, (1 - phase) * 4));
      out(Math.cos(angle) * r + sway, 2.35 - phase * 2.3, Math.sin(angle) * r + sway * 0.5, i % 5 === 0 ? 0.06 : 0.04, fade * 0.95, phase);
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
  } else if (style === "wreath") {
    // holly wreath: a ring of leafy blocks with red berries and a little gold bell (WingsFeature.wreath)
    const n = 18, r = 4.6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = -((i % 3) - 1) * 0.25;
      g.add(box(1.8, 1.2, 1.8, i % 2 === 0 ? 0x1e7a3a : 0x2e9a4a, x, y, -z));
      if (i % 3 === 0) g.add(box(0.8, 0.6, 0.8, 0xe0262e, Math.cos(a) * (r + 0.4), y + 0.7, -Math.sin(a) * (r + 0.4)));
    }
    g.add(box(1.2, 1.2, 0.9, 0xf2c230, 0, -0.2, r + 0.75));
    g.userData.spin = true;
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

// Ears in the skin's own pixel style, the same as the mod (WingsFeature.Ear): a flat pixel-art piece standing on the
// head and leaning outward. rows: top first, columns from the middle of the head outward. B base, L light, D dark,
// P pink (front only), . empty. x/y/z: where the bottom middle sits (mod pixels: -y up, -z front); out/back: degrees.
const EARS = {
  dog_ears: { rows: [".BB.", "BPPL", "BPPB", "DPPD", "DBBD"], thick: 1, x: 2.4, y: -7.6, z: 0.6, out: 30, back: 6, fallback: 0x7a4a2a },
  cat_ears: { rows: ["LLB", "LBB", "LBD", "BBD"], thick: 1.6, x: 2.6, y: -7.9, z: 0.4, out: 22, back: 12, fallback: 0xededed },
  antlers: { rows: ["..L.L", "L.B.B", "BBBB.", ".BB..", ".B...", ".D..."], thick: 1, x: 3.0, y: -7.7, z: 0.6, out: 34, back: 8, fallback: 0x6e4a2c, fixed: true },
};

const mixRgb = (a, b, t) => {
  const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** base, light, dark, pink. Ears in the default white are their natural colour; antlers are always antler brown. */
function earPalette(ear, color) {
  const c = ear.fixed || (color & 0xffffff) === 0xededed ? ear.fallback : color & 0xffffff;
  return [c, mixRgb(c, 0xffffff, 0.28), mixRgb(c, 0x000000, 0.25), 0xf6a9bd];
}

function makeEar(ear, pal, side) {
  const g = new THREE.Group();
  const n = ear.rows.length, w = ear.rows[0].length, half = w / 2;
  const col = (ch, front) => (ch === "L" ? pal[1] : ch === "D" ? pal[2] : ch === "P" ? (front ? pal[3] : pal[0]) : pal[0]);
  for (let r = 0; r < n; r++) {
    const row = ear.rows[r];
    // mod y runs from -(n - r) to -(n - r) + 1; three.js has +y up
    const yMid = n - r - 0.5;
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      const x = side * (c + 0.5 - half);
      g.add(box(1, 1, ear.thick, col(ch, false), x, yMid, 0));
      if (ch === "P" || ch === "L" || ch === "D") g.add(box(1, 1, 0.04, col(ch, true), x, yMid, ear.thick / 2 + 0.03)); // the front (+z: the face's side)
    }
  }
  // place and lean it like the mod: translate, then roll outward (Z), then tip back (X); mod -> three.js flips y and z
  g.position.set(side * ear.x, -ear.y, -ear.z);
  g.rotation.order = "ZYX";
  g.rotation.set((-ear.back * Math.PI) / 180, 0, -((side * ear.out * Math.PI) / 180));
  return g;
}

// Santa hat (WingsFeature.SANTA): white fur brim, a red cone in steps that bends back and to the side, white pom-pom
const SANTA = [
  [-4.7, -9.4, -4.7, 4.7, -7.4, 4.7, 0],
  [-4.1, -11.2, -4.0, 4.1, -9.4, 4.2, 1],
  [-3.3, -12.9, -2.8, 3.5, -11.2, 4.0, 2],
  [-2.2, -14.3, -1.2, 3.0, -12.9, 3.8, 1],
  [-0.6, -15.3, 0.6, 3.4, -14.3, 3.6, 2],
  [1.6, -15.6, 1.4, 4.6, -14.6, 3.2, 1],
  [3.8, -15.4, 1.0, 6.4, -12.8, 3.6, 0],
];

/** A box given in mod pixels (x0..x1, y0..y1 with -y up, z0..z1 with -z front), placed in three.js head space. */
const modBox = (x0, y0, z0, x1, y1, z1, color) => box(x1 - x0, y1 - y0, z1 - z0, color, (x0 + x1) / 2, -(y0 + y1) / 2, -(z0 + z1) / 2);

/** Blocky hats, like the mod's. */
function makeHat(style, color) {
  const g = new THREE.Group();
  if (VOXEL_HATS.has(style)) {
    voxelHat(style, g);
  } else if (style === "crown") {
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
  } else if (EARS[style]) {
    const ear = EARS[style];
    const pal = earPalette(ear, color);
    for (const side of [-1, 1]) g.add(makeEar(ear, pal, side));
  } else if (style === "santa") {
    for (const [x0, y0, z0, x1, y1, z1, c] of SANTA) g.add(modBox(x0, y0, z0, x1, y1, z1, c === 0 ? 0xf4f4f2 : c === 1 ? 0xd42a2a : 0xb01e22));
    for (let i = 0; i < 6; i++) {
      const x = -4.2 + i * 1.6;
      g.add(modBox(x, -8.8, -4.78, x + 0.8, -8.0, -4.7, 0xd8d8d6));
    }
  }
  g.userData.kind = "hat";
  return g;
}


// Com Client's own capes (CustomCapes.java): an animated strip of 128x64 frames, top to bottom. [frames, ms per frame]
const CUSTOM_CAPES = {
  cc_northpole: [12, 150], cc_snowfall: [12, 140], cc_lights: [8, 260], cc_candy_cane: [16, 90], cc_frostbite: [12, 130],
  cc_prism: [16, 110],
  cc_rose_red: [16, 120], cc_rose_white: [16, 120], cc_sun: [16, 150], cc_moon: [16, 150],
  cc_heart_left: [16, 90], cc_heart_right: [16, 90], cc_yin: [16, 180], cc_yang: [16, 180],
  cc_mono_black: [20, 250], cc_mono_white: [20, 250], cc_gg: [24, 250],
  cc_aurora: [16, 110], cc_galaxy: [16, 130], cc_nebula: [16, 140], cc_lava: [16, 100],
  cc_rainbow: [16, 90], cc_storm: [16, 100], cc_waves: [16, 110], cc_fireflies: [16, 140],
  cc_hearts: [12, 120],
  cc_sunset: [16, 140], cc_sakura: [1, 1000],
  cc_honeycomb: [1, 1000], cc_mint: [1, 1000],
};

/** Cuts a cape strip into one canvas per frame. */
function capeFrames(img, n) {
  const h = Math.floor(img.height / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, i * h, img.width, h, 0, 0, img.width, h);
    out.push(c);
  }
  return out;
}

/** Plays an animated cape on a skinview3d viewer (everyone's cape on the same clock, like in game). Returns stop(). */
function playCape(viewer, img, id, backEquipment = "cape") {
  const [n, ms] = CUSTOM_CAPES[id] || [1, 1000];
  const frames = capeFrames(img, n);
  let last = -1;
  const step = () => {
    const f = Math.floor(Date.now() / ms) % frames.length;
    if (f !== last) {
      last = f;
      viewer.loadCape(frames[f], { backEquipment });
    }
  };
  step();
  if (frames.length < 2) return () => {};
  const t = setInterval(step, Math.min(ms, 100));
  return () => clearInterval(t);
}

export { VOXEL_HATS, setHatBase, CUSTOM_CAPES, EARS, earPalette, SANTA, capeFrames, playCape, auraColour, auraPoints, colourAt, glow, makeHalo, makeHat };
