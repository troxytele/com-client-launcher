import { useEffect, useRef } from "react";
import { EARS, earPalette, auraPoints } from "../../website-src/helpers.js";

// The Locker card pictures, drawn the same way as the client's Locker (LockerScreen.java): glowing halos made of soft
// dots, the aura shapes seen from the side, and the flat hat pictures. Each card is a small animated canvas.

const W = 96;
const H = 72;

type Draw = (ctx: CanvasRenderingContext2D, now: number) => void;

function rgba(rgb: number, a: number) {
  return `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${Math.max(0, Math.min(1, a))})`;
}

/** The client's soft round "radial" texture: a dot that fades out to its edge. */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: number, a: number) {
  if (a <= 0 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(rgb, a));
  g.addColorStop(0.45, rgba(rgb, a * 0.55));
  g.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

/** 0..1 hue -> rgb, like the client's Fx.hue (saturation 0.65, full brightness). */
function hue(h: number) {
  h -= Math.floor(h);
  const s = 0.65;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = 1 - s;
  const q = 1 - s * f;
  const t = 1 - s * (1 - f);
  const [r, g, b] = [
    [1, t, p],
    [q, 1, p],
    [p, 1, t],
    [p, q, 1],
    [t, p, 1],
    [1, p, q],
  ][i % 6];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** A canvas that redraws every frame while it is on screen. */
function Art({ draw }: { draw: Draw }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(cv);
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawRef.current(ctx, performance.now());
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="cosmetic-art" style={{ width: W, height: H }} />;
}

// ------------------------------------------------------------------ halos

/** A glowing ellipse made of soft dots; tilt leans it, phase spins the bright spot. */
function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, tilt: number, rgb: number, a: number, phase: number) {
  const n = 44;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = Math.cos(ang) * rx;
    const y = Math.sin(ang) * ry + x * tilt * 0.5;
    const front = 0.55 + 0.45 * Math.sin(ang);
    const shine = 0.75 + 0.25 * Math.cos(ang - phase);
    dot(ctx, cx + x, cy + y, 4, rgb, 0.55 * front * shine * a);
    dot(ctx, cx + x, cy + y, 1.6, 0xffffff, 0.5 * front * a);
  }
}

export function HaloArt({ id, color }: { id: string; color: number }) {
  return (
    <Art
      draw={(ctx, now) => {
        ctx.globalCompositeOperation = "lighter";
        const t = now / 1000;
        const cx = W / 2;
        const cy = H / 2;
        const r = 30;
        const ry = r * 0.32;
        const rgb = color & 0xffffff;
        dot(ctx, cx, cy, r * 1.3, rgb, 0.1);
        if (id === "double") {
          ellipse(ctx, cx, cy, r * 0.9, ry, 0.35, rgb, 1, t * 0.6);
          ellipse(ctx, cx, cy, r, ry, -0.35, rgb, 1, -t * 0.5);
        } else if (id === "crown") {
          ellipse(ctx, cx, cy, r, ry, 0, rgb, 1, 0);
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + t * 0.2;
            const sx = cx + Math.cos(ang) * r;
            const sy = cy + Math.sin(ang) * ry;
            const h = (i % 2 === 0 ? 0.42 : 0.26) * r;
            const front = 0.55 + 0.45 * Math.sin(ang);
            for (let k = 0; k < 5; k++) dot(ctx, sx, sy - (h * k) / 4, 3.2 * (1 - k / 6), rgb, (0.85 - k * 0.15) * front);
          }
        } else if (id === "wreath") {
          // holly wreath: green leaves, red berries, a gold bell at the front
          ctx.globalCompositeOperation = "source-over";
          const n = 18;
          const pts = [];
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + t * 0.2;
            pts.push({ i, ang, z: Math.sin(ang) });
          }
          pts.sort((p, q) => p.z - q.z);
          for (const p of pts) {
            const x = cx + Math.cos(p.ang) * r;
            const y = cy + Math.sin(p.ang) * ry;
            const shade = 0.7 + 0.3 * p.z;
            rrect(ctx, x - 5, y - 4, 10, 8, 2, rgba(mix(p.i % 2 === 0 ? 0x1e7a3a : 0x2e9a4a, 0x000000, 1 - shade), 1));
            if (p.i % 3 === 0) rrect(ctx, x - 2, y - 7, 4, 4, 1.5, rgba(mix(0xe0262e, 0x000000, 1 - shade), 1));
          }
          rrect(ctx, cx - 3.5, cy + ry - 2, 7, 7, 2, rgba(0xf2c230, 1));
        } else if (id === "orbit") {
          ellipse(ctx, cx, cy, r, ry, 0, rgb, 0.45, 0);
          for (let i = 0; i < 3; i++) {
            for (let k = 0; k < 5; k++) {
              const ang = t * 1.8 + (i * Math.PI * 2) / 3 - k * 0.12;
              dot(ctx, cx + Math.cos(ang) * r, cy + Math.sin(ang) * ry, 5 * (1 - k * 0.16), 0xffffff, 1 - k * 0.2);
            }
          }
        } else {
          ellipse(ctx, cx, cy, r, ry, 0, rgb, 1, 0);
        }
      }}
    />
  );
}

// ------------------------------------------------------------------ auras

/** The aura around an unseen player, turning slowly; points behind are dimmer. color -1 = rainbow. */
export function AuraArt({ id, color }: { id: string; color: number }) {
  return (
    <Art
      draw={(ctx, now) => {
        ctx.globalCompositeOperation = "lighter";
        const size = 22; // pixels per block
        const feet = H - 6;
        const a = ((now / 40) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        auraPoints(id, now, (x, y, z, sz, bright, t) => {
          const rx = x * cos - z * sin;
          const rz = x * sin + z * cos;
          const front = rz > 0 ? 1 : 0.4;
          const r = Math.max(2, sz * size * 3.2);
          const rgb = id === "snow" || id === "trail_snow" ? 0xeef6ff : id === "trail_hearts" ? (t < 0.5 ? 0xff4f86 : 0xff8fb0) : color === -1 ? hue(t * 0.6 + now / 4000) : color & 0xffffff;
          const k = Math.max(0, Math.min(1, bright)) * front;
          dot(ctx, W / 2 + rx * size, feet - y * size, r, rgb, 0.75 * k);
          dot(ctx, W / 2 + rx * size, feet - y * size, Math.max(1, r * 0.28), 0xffffff, 0.6 * k);
        });
      }}
    />
  );
}

// ------------------------------------------------------------------ hats

function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Flat pictures of the hats, the same shapes as the client's cards. */
export function HatArt({ id, color }: { id: string; color: number }) {
  return (
    <Art
      draw={(ctx) => {
        ctx.globalCompositeOperation = "source-over";
        const cx = W / 2;
        const cy = H / 2 + 6;
        const rgb = color & 0xffffff;
        if (id === "crown") {
          const gold = rgba(0xf2c230, 1);
          const light = rgba(0xffe68a, 1);
          rrect(ctx, cx - 20, cy, 40, 10, 2, gold);
          rrect(ctx, cx - 20, cy + 7, 40, 3, 1, rgba(0xc08a1c, 1));
          const px = [-20, -10.5, -2, 7, 16];
          const ph = [9, 11, 15, 11, 9];
          for (let i = 0; i < px.length; i++) {
            rrect(ctx, cx + px[i], cy - ph[i], 4, ph[i] + 1, 1, gold);
            rrect(ctx, cx + px[i] - 0.5, cy - ph[i] - 3, 5, 4, 2, light);
          }
          rrect(ctx, cx - 3, cy + 2, 6, 5, 1.5, rgba(0xe0304a, 1));
          rrect(ctx, cx - 14, cy + 2.5, 4, 4, 1.5, rgba(0x3a7bff, 1));
          rrect(ctx, cx + 10, cy + 2.5, 4, 4, 1.5, rgba(0x3a7bff, 1));
        } else if (id === "santa") {
          // red cone in steps bending to the side, white brim and pom-pom
          const red = rgba(0xd42a2a, 1);
          const dark = rgba(0xb01e22, 1);
          const white = rgba(0xf4f4f2, 1);
          rrect(ctx, cx - 14, cy - 10, 28, 7, 2, dark);
          rrect(ctx, cx - 11, cy - 17, 24, 8, 2, red);
          rrect(ctx, cx - 6, cy - 23, 20, 7, 2, dark);
          rrect(ctx, cx + 2, cy - 27, 16, 6, 2, red);
          rrect(ctx, cx + 14, cy - 28, 9, 9, 4, white);
          rrect(ctx, cx - 20, cy - 4, 40, 10, 3, white);
          for (let i = 0; i < 6; i++) rrect(ctx, cx - 18 + i * 6.5, cy + 1, 3, 3, 1, rgba(0xd8d8d6, 1));
        } else if (EARS[id]) {
          // the ears in the skin's own pixel style, from the same rows the game uses (front side)
          const ear = EARS[id];
          const pal = earPalette(ear, rgb);
          const px = 3.2;
          const n = ear.rows.length;
          const w = ear.rows[0].length;
          for (const side of [-1, 1]) {
            ctx.save();
            const baseX = cx + side * (ear.x * px + 2);
            const baseY = cy + 8;
            ctx.translate(baseX, baseY);
            ctx.rotate((side * ear.out * Math.PI) / 180);
            for (let r = 0; r < n; r++) {
              for (let c = 0; c < w; c++) {
                const ch = ear.rows[r][c];
                if (ch === ".") continue;
                const col = ch === "L" ? pal[1] : ch === "D" ? pal[2] : ch === "P" ? pal[3] : pal[0];
                const x0 = side > 0 ? (c - w / 2) * px : -(c + 1 - w / 2) * px;
                ctx.fillStyle = rgba(col, 1);
                ctx.fillRect(x0, -(n - r) * px, px + 0.4, px + 0.4);
              }
            }
            ctx.restore();
          }
          rrect(ctx, cx - 22, cy + 8, 44, 3, 1.5, "rgba(255,255,255,0.12)");
        }
      }}
    />
  );
}
