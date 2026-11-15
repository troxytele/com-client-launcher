import { useEffect, useState } from "react";

// name tag styles (NameStyles.java): gradient stops; moving ones flow along the name
export const NAME_STYLES: Record<string, { stops: number[]; moving: boolean }> = {
  fire: { stops: [0xffe066, 0xff7a1a, 0xe8202a], moving: true },
  ocean: { stops: [0x8ff6ff, 0x2e9bff, 0x4a4af0], moving: true },
  gold: { stops: [0xb8860b, 0xf2c230, 0xfff4b0, 0xf2c230, 0xb8860b], moving: true },
  toxic: { stops: [0xd8ff3a, 0x3ae86e, 0x0e9f6e], moving: false },
  candy: { stops: [0xff5fa2, 0xffb3d9, 0x8fd8ff], moving: false },
  galaxy: { stops: [0xb57bff, 0x5b6bff, 0xff6bd5, 0xb57bff], moving: true },
  rainbow: { stops: [], moving: true },
  sunset: { stops: [0xff5f6d, 0xffc371], moving: true },
  lava: { stops: [0xff3d00, 0xffb300, 0xff3d00], moving: true },
  mint: { stops: [0xb8ffe0, 0x3fe0a0], moving: false },
  ice: { stops: [0xe0f7ff, 0x8fd3ff, 0xffffff, 0x8fd3ff], moving: true },
  sakura: { stops: [0xffb7d5, 0xfff0f6, 0xff8fbf], moving: true },
  vaporwave: { stops: [0xff71ce, 0x01cdfe, 0xb967ff], moving: true },
  emerald: { stops: [0x0e9f6e, 0x6dffb0, 0x0e9f6e], moving: true },
  blood: { stops: [0x7a0010, 0xe8202a, 0x7a0010], moving: true },
  midnight: { stops: [0xb57bff, 0x5b6bff, 0x1d2a8f], moving: false },
  mono: { stops: [0xffffff, 0x8a8a8a, 0xffffff], moving: true },
  peach: { stops: [0xffb199, 0xffe0c2, 0xff8a80], moving: true },
  forest: { stops: [0x2e7d32, 0x8bc34a, 0x2e7d32], moving: true },
  royal: { stops: [0x3b2a8f, 0xc9a227, 0x3b2a8f], moving: true },
  fire_ice: { stops: [0xff4a1a, 0xffb347, 0x8fd3ff, 0x2e7bff], moving: true },
  cotton_candy: { stops: [0xffb3e6, 0xb3e5ff], moving: true },
  neon: { stops: [0x39ff14, 0xff2bd6, 0x00f0ff], moving: true },
  copper: { stops: [0xb87333, 0xf0b27a, 0x8c4a1e], moving: false },
  shadow: { stops: [0x5a5a6e, 0xc8c8d8, 0x5a5a6e], moving: true },
  bubblegum: { stops: [0xff77c8, 0xffc6e8, 0xff77c8], moving: true },
  ruby: { stops: [0x8e0f2b, 0xff4a6e, 0x8e0f2b], moving: true },
  sapphire: { stops: [0x0f2e8e, 0x4a8bff, 0x0f2e8e], moving: true },
  amethyst: { stops: [0x5a1e8e, 0xc77bff, 0x5a1e8e], moving: true },
  sunrise: { stops: [0xff6a3d, 0xffb347, 0xffe07a], moving: false },
  lime: { stops: [0xb6ff3a, 0x5fd33a], moving: false },
  christmas: { stops: [0xe8262b, 0xffffff, 0x2f8f3a, 0xffffff, 0xe8262b], moving: true },
  candy_cane: { stops: [0xff3a3a, 0xffffff, 0xff3a3a, 0xffffff], moving: true },
  frost: { stops: [0xffffff, 0x9fd6ff, 0x4a8bff, 0x9fd6ff], moving: true },
  gingerbread: { stops: [0x9a5a28, 0xd08a4a, 0xfff4e0], moving: false },
  evergreen: { stops: [0x1f6a2a, 0x5fd36b, 0x1f6a2a], moving: true },
  golden_star: { stops: [0xfff3a0, 0xf2c230, 0xb8860b, 0xf2c230], moving: true },
};
const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
const mixRgb = (a: number, b: number, t: number) => {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

function nameColour(style: { stops: number[]; moving: boolean }, i: number, n: number, now: number) {
  let t = n <= 1 ? 0 : i / (n - 1);
  if (!style.stops.length) return `hsl(${(((t * 0.8 + now / 2500) % 1) * 360).toFixed(0)}, 100%, 70%)`;
  if (style.moving) {
    t = (t * 0.7 + now / 1800) % 1;
    t = t < 0.5 ? t * 2 : 2 - t * 2;
  }
  const st = style.stops;
  const f = t * (st.length - 1);
  const k = Math.min(st.length - 2, Math.floor(f));
  return hex(mixRgb(st[k], st[k + 1], f - k));
}

/** A name in a name tag style, letter by letter like the game (moving styles flow unless `still`). */
export default function NameTag({ style, name, className, still }: { style: string; name: string; className?: string; still?: boolean }) {
  const s = NAME_STYLES[style];
  const [now, setNow] = useState(900);
  useEffect(() => {
    if (!s || still || !s.moving) return;
    let f = 0;
    const loop = (t: number) => {
      setNow(t);
      f = requestAnimationFrame(loop);
    };
    f = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(f);
  }, [style, still]);
  if (!s) return null;
  const letters = [...name];
  return (
    <span className={className}>
      {letters.map((ch, i) => (
        <span key={i} style={{ color: nameColour(s, i, letters.length, now) }}>
          {ch}
        </span>
      ))}
    </span>
  );
}
