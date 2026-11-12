import * as THREE from "three";

// Fire horns, the same as in game: the smooth horn mesh (meshes/horns.bin from the mod, exported to horns.json),
// its texture recoloured like HornsMeshRenderer does, the glowing tips drawn a second time, and the fire that rises
// between the horns (a port of ChinaHatFireRenderer). Units are skin pixels in the head's space.

const DEFAULT_HORN = 0xff1100;
const DEFAULT_FIRE = 0xff5900;
const DEFAULT_CORE = 0xfff700;

const lerpColor = (a, b, t) => {
  const ch = (s) => Math.round((a >> s & 255) + ((b >> s & 255) - (a >> s & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Locker hat colour -> horn colour: grey/white (the default) keeps the classic red. */
function hornColor(hat) {
  const r = hat >> 16 & 255, g = hat >> 8 & 255, b = hat & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 || (max - min) / max < 0.2 ? DEFAULT_HORN : hat & 0xffffff;
}

/** HornsMeshRenderer.glowColor for one pixel (r, g, b in 0..1). */
function retintPixel(r, g, b, horn, fire, core, out) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  out[0] = r; out[1] = g; out[2] = b;
  if (mx <= 0) return;
  const sat = (mx - mn) / mx;
  const f16 = smooth(0.34, 0.55, sat);
  if (f16 <= 0) return;
  const d = Math.max(mx - mn, 1e-6);
  let h = mx === r ? (((g - b) / d) % 6 + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h > 300) h -= 360;
  const f19 = smooth(9, 20, h), f20 = smooth(18, 60, h);
  for (let k = 0; k < 3; k++) {
    const s = 16 - k * 8;
    const src = k === 0 ? r : k === 1 ? g : b;
    const hc = (horn >> s & 255) / 255;
    const fc = ((fire >> s & 255) + ((core >> s & 255) - (fire >> s & 255)) * f20) / 255;
    const target = mx * (1 - sat + sat * (hc + (fc - hc) * f19));
    out[k] = Math.min(1, Math.max(0, src + (target - src) * f16));
  }
}

let meshData = null;
const images = {};
function loadImage(url) {
  return (images[url] ||= new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  }));
}

function tintedTexture(img, horn, fire, core) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data, out = [0, 0, 0];
  for (let i = 0; i < p.length; i += 4) {
    retintPixel(p[i] / 255, p[i + 1] / 255, p[i + 2] / 255, horn, fire, core, out);
    p[i] = Math.round(out[0] * 255);
    p[i + 1] = Math.round(out[1] * 255);
    p[i + 2] = Math.round(out[2] * 255);
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  // the viewer renders into a linear target with no conversion at the end, so the game's sRGB values go in as they are
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// ---- the fire: flame sprites rising between the horns (all in blocks, like the game; drawn x16) ----

const MAX = 288;
const FIRE_VERT = `
attribute float size;
attribute float stretch;
attribute float angle;
attribute vec4 tint;
uniform float viewport;
varying vec4 vTint;
varying float vStretch;
varying float vAngle;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // the quad is size x size*stretch (half extents), drawn inside a square point as large as its longest side
  float depth = projectionMatrix[3][3] > 0.5 ? 1.0 : -mv.z; // orthographic cameras have no perspective divide
  gl_PointSize = 2.4 * size * max(1.0, stretch) * projectionMatrix[1][1] * viewport * 0.5 / depth;
  vTint = tint;
  vStretch = stretch;
  vAngle = angle;
}`;
const FIRE_FRAG = `
uniform sampler2D map;
varying vec4 vTint;
varying float vStretch;
varying float vAngle;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.4 * max(1.0, vStretch);
  p.y = -p.y;
  float c = cos(vAngle), s = sin(vAngle);
  // undo the billboard's rotation, then its stretch along the rotated vertical
  vec2 q = vec2(p.x * c + p.y * s, (-p.x * s + p.y * c) / vStretch);
  if (abs(q.x) > 1.0 || abs(q.y) > 1.0) discard;
  vec4 t = texture2D(map, vec2(q.x, -q.y) * 0.5 + 0.5) * vTint;
  if (t.a < 0.002) discard;
  gl_FragColor = t;
}`;

function makeFire(flameTex, fireColor, coreColor, origin) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), size = new Float32Array(MAX), stretch = new Float32Array(MAX);
  const angle = new Float32Array(MAX), tint = new Float32Array(MAX * 4);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("stretch", new THREE.BufferAttribute(stretch, 1));
  geo.setAttribute("angle", new THREE.BufferAttribute(angle, 1));
  geo.setAttribute("tint", new THREE.BufferAttribute(tint, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: flameTex }, viewport: { value: 400 } },
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  const v = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(v);
    mat.uniforms.viewport.value = v.y;
  };

  // particles: position (blocks, relative to the emitter), velocity, age, life, size, angle, spin, core?
  const P = [];
  let spawnA = 0, spawnB = 0, last = -1;
  const fireLate = lerpColor(fireColor, 0x300000, 0.3); // Colors.lerp(fire, 0xFF300000, 0.3)
  const coreHot = lerpColor(coreColor, 0xffffff, 0.35);
  const rnd = Math.random;

  function step(dt) {
    const keep = Math.exp(-2.5 * dt);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) {
        P[i] = P[P.length - 1];
        P.pop();
        continue;
      }
      // rises (the core faster), sideways drift fades out
      const lift = (p.core ? 2.5 : 1.9) * dt;
      const up = p.vy + lift;
      p.vx *= keep;
      p.vz *= keep;
      p.vy = (p.vy - up + lift) * keep + up;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.angle += p.spin * dt;
    }
    spawnA += 120 * dt;
    spawnB += 90 * dt;
    while (spawnA >= 1 || spawnB >= 1) {
      const core = spawnB >= spawnA;
      if (core) spawnB--;
      else spawnA--;
      if (P.length >= MAX) continue;
      const r = (core ? 0.05 : 0.09) * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      const speed = (core ? 0.95 : 0.85) + rnd() * 0.3;
      const side = 0.09 * rnd();
      P.push({
        core,
        x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r,
        vx: Math.cos(a) * side, vy: speed, vz: Math.sin(a) * side,
        age: rnd() * dt,
        life: core ? 0.36 + rnd() * 0.16 : 0.6 + rnd() * 0.25,
        size: (core ? 0.11 : 0.19) * (0.8 + rnd() * 0.4),
        angle: (rnd() - 0.5) * 0.5,
        spin: (rnd() - 0.5) * 1.2,
      });
    }
  }

  function draw() {
    let n = 0;
    // flames first, the hot core on top (additive, so the order only matters a little)
    for (const pass of [false, true]) {
      for (const p of P) {
        if (p.core !== pass) continue;
        const t = Math.min(1, Math.max(0, p.age / p.life));
        let scale, alpha, c;
        if (p.core) {
          scale = 1 - 0.55 * t;
          alpha = smooth(0, 0.18, t) * (1 - t) * 0.9;
          c = lerpColor(coreHot, coreColor, t);
        } else {
          scale = t < 0.15 ? 0.55 + (0.45 * t) / 0.15 : 1 - (0.6 * (t - 0.15)) / 0.85;
          alpha = smooth(0, 0.22, t) * (1 - t) * 0.62;
          c = t < 0.4 ? lerpColor(coreColor, fireColor, t / 0.4) : lerpColor(fireColor, fireLate, (t - 0.4) / 0.6);
        }
        if (alpha <= 0.002) continue;
        pos[n * 3] = origin.x + p.x * 16;
        pos[n * 3 + 1] = origin.y + p.y * 16;
        pos[n * 3 + 2] = origin.z + p.z * 16;
        size[n] = p.size * scale * 16;
        stretch[n] = p.core ? 1.4 : 1.8;
        angle[n] = p.angle;
        // the game's colours are sRGB; the shader writes them straight to the screen
        tint[n * 4] = ((c >> 16) & 255) / 255;
        tint[n * 4 + 1] = ((c >> 8) & 255) / 255;
        tint[n * 4 + 2] = (c & 255) / 255;
        tint[n * 4 + 3] = alpha;
        n++;
      }
    }
    geo.setDrawRange(0, n);
    for (const k of ["position", "size", "stretch", "angle", "tint"]) geo.attributes[k].needsUpdate = true;
  }

  return {
    points,
    tick(now) {
      const t = now / 1000;
      if (last < 0 || t - last > 0.25) {
        P.length = 0;
        last = t;
        return;
      }
      let dt = t - last;
      last = t;
      while (dt > 0) {
        const s = Math.min(dt, 1 / 60);
        step(s);
        dt -= s;
      }
      draw();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Builds the Fire horns into `g` (head space). Sets g.userData.tick for the fire. */
export function fireHorns(g, base, hatColor) {
  meshData ||= fetch(`${base}/horns.json`).then((r) => r.json());
  const horn = hornColor(hatColor ?? 0);
  const fire = horn === DEFAULT_HORN ? DEFAULT_FIRE : lerpColor(horn, 0xffaa33, 0.45);
  const core = DEFAULT_CORE;
  let fx = null;
  g.userData.tick = (now) => fx && fx.tick(now);
  Promise.all([meshData, loadImage(`${base}/horns.png`), loadImage(`${base}/flame.png`)])
    .then(([m, img, flameImg]) => {
      if (!m || !img) return;
      const map = tintedTexture(img, horn, fire, core);
      const shade = (vals) => {
        const c = new Float32Array(vals.length * 3);
        vals.forEach((s, i) => c.fill(s, i * 3, i * 3 + 3));
        return new THREE.BufferAttribute(c, 3);
      };
      const position = new THREE.Float32BufferAttribute(m.pos, 3);
      const uv = new THREE.Float32BufferAttribute(m.uv, 2);

      const body = new THREE.BufferGeometry();
      body.setAttribute("position", position);
      body.setAttribute("uv", uv);
      body.setAttribute("color", shade(m.shade));
      body.setIndex(m.idx);
      const mat = new THREE.MeshBasicMaterial({ map, vertexColors: true, side: THREE.DoubleSide });
      const bodyMesh = new THREE.Mesh(body, mat);
      bodyMesh.renderOrder = 1;

      // the tips again, with their glow shading, over the body (same depth, drawn after it)
      const tips = new THREE.BufferGeometry();
      tips.setAttribute("position", position);
      tips.setAttribute("uv", uv);
      tips.setAttribute("color", shade(m.glow));
      const idx = [];
      for (const t of m.glowTris) idx.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]);
      tips.setIndex(idx);
      const tipMesh = new THREE.Mesh(tips, mat);
      tipMesh.renderOrder = 2;
      g.add(bodyMesh, tipMesh);

      if (flameImg) {
        const flame = new THREE.Texture(flameImg);
        flame.needsUpdate = true;
        flame.colorSpace = THREE.NoColorSpace;
        fx = makeFire(flame, fire, core, new THREE.Vector3(0, 8 + 0.24 * 16, -m.centerZ * 16));
        g.add(fx.points);
      }
      g.userData.dispose = () => {
        body.dispose();
        tips.dispose();
        mat.dispose();
        map.dispose();
        fx && fx.dispose();
      };
    })
    .catch(() => {});
}
