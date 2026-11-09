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
