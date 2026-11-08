import { useEffect, useRef } from "react";
import * as THREE from "three";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { Look } from "../api";

/** 0xRRGGBB, or a rainbow when -1. */
function colourAt(c: number, t: number, now: number) {
  if (c === -1) return new THREE.Color().setHSL((t * 0.6 + now / 4000) % 1, 0.75, 0.62);
  return new THREE.Color(c & 0xffffff);
}

/** The same aura shapes as the mod (Auras.java), in blocks around the feet. */
export function auraPoints(style: string, now: number, out: (x: number, y: number, z: number, size: number, bright: number, t: number) => void) {
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

const glow = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }));
  m.position.set(x, y, z);
  return m;
}

/** Halo above the head (head space: 1 unit = 1 skin pixel, top of the head at y = 8). */
function makeHalo(style: string, color: number) {
  const g = new THREE.Group();
  const ring = (r: number, tiltX = 0, tiltZ = 0) => {
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
    ring(4.6).children.forEach((c) => (((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity *= 0.45));
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

/** Blocky hats, like the mod's. */
function makeHat(style: string, color: number) {
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
      inner.position.set(0, -0.3, -0.6);
      ear.add(outer, inner);
      ear.position.set(side * 2.6, 9.6, 0);
      ear.rotation.z = side * -0.25;
      g.add(ear);
    }
  } else if (style === "dog_ears") {
    for (const side of [-1, 1]) {
      const ear = box(1, 4.2, 2.6, color);
      ear.position.set(side * 4.6, 5.8, 0.4);
      ear.rotation.z = side * 0.15;
      g.add(ear);
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

// A 3D player wearing the look: cape or wings on the back, halo and hat on the head, the aura around the body.
export default function LockerPreview({ skin, slim, look, cape, wings }: { skin: string; slim: boolean; look: Look; cape: string | null; wings: string | null }) {
  const box_ = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const extras = useRef<{ halo?: THREE.Group; hat?: THREE.Group; aura?: THREE.Group }>({});
  const lookRef = useRef(look);
  lookRef.current = look;

  useEffect(() => {
    if (!canvas.current || !box_.current) return;
    const v = new SkinViewer({ canvas: canvas.current, width: box_.current.clientWidth || 320, height: box_.current.clientHeight || 420, zoom: 0.78, fov: 40 });
    v.controls.enableZoom = false;
    v.controls.enablePan = false;
    v.autoRotate = true;
    v.autoRotateSpeed = 0.6;
    v.playerWrapper.rotation.y = Math.PI + 0.5; // start from behind, so the cape / wings show
    v.globalLight.intensity = 3;
    v.cameraLight.intensity = 0.7;
    const idle = new IdleAnimation();
    v.animation = idle;
    viewer.current = v;
    const ro = new ResizeObserver(() => box_.current && v.setSize(box_.current.clientWidth, box_.current.clientHeight));
    ro.observe(box_.current);

    // the aura: a pool of glowing dots moved every frame
    const aura = new THREE.Group();
    const dots: THREE.Mesh[] = [];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), glow(0xffffff, 0));
      dots.push(m);
      aura.add(m);
    }
    v.playerObject.add(aura);
    extras.current.aura = aura;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const l = lookRef.current;
      // feet of the model: skinview3d's player is 32 units tall, centred on 0
      const unit = 16;
      const feet = -16;
      let i = 0;
      if (l.aura !== "none") {
        auraPoints(l.aura, now, (x, y, z, size, bright, t) => {
          const d = dots[i++];
          if (!d) return;
          d.visible = true;
          d.position.set(x * unit, feet + y * unit, z * unit);
          d.scale.setScalar(Math.max(0.35, size * unit * 0.8));
          const mat = d.material as THREE.MeshBasicMaterial;
          mat.color = colourAt(l.auraColor, t, now);
          mat.opacity = Math.max(0, Math.min(1, bright));
        });
      }
      for (; i < dots.length; i++) dots[i].visible = false;
      // wings: the elytra shape held out to the sides and beating, like the client (WingsFeature.java)
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
      // orbiting sparks of the halo
      const halo = extras.current.halo;
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
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      v.dispose();
      viewer.current = null;
      extras.current = {};
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (skin) v.loadSkin(skin, { model: slim ? "slim" : "default" });
    else v.loadSkin(null);
  }, [skin, slim]);

  // cape or wings (wings win, like in game)
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (wings) v.loadCape(wings, { backEquipment: "elytra" });
    else if (cape) v.loadCape(cape, { backEquipment: "cape" });
    else v.loadCape(null);
  }, [cape, wings]);

  // halo + hat on the head
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const head = v.playerObject.skin.head;
    for (const k of ["halo", "hat"] as const) {
      const old = extras.current[k];
      if (old) {
        head.remove(old);
        delete extras.current[k];
      }
    }
    if (look.halo !== "none") {
      extras.current.halo = makeHalo(look.halo, look.haloColor & 0xffffff);
      head.add(extras.current.halo);
    }
    if (look.hat !== "none") {
      extras.current.hat = makeHat(look.hat, look.hatColor & 0xffffff);
      head.add(extras.current.hat);
    }
  }, [look.halo, look.haloColor, look.hat, look.hatColor]);

  return (
    <div ref={box_} className="skin-model locker-model">
      <canvas ref={canvas} />
    </div>
  );
}
