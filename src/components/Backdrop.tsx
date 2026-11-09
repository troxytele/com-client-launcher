import { useEffect, useMemo, useState } from "react";
import { getLook, onLook } from "../theme";

// The window background: black, a fine dot grid that fades out to the edges, a slow light in the theme colour and
// (unless turned off in Settings) specks of dust drifting up.
export default function Backdrop() {
  const [moving, setMoving] = useState(getLook().stars);
  const [festive, setFestive] = useState(getLook().festive);
  useEffect(
    () =>
      onLook((l) => {
        setMoving(l.stars);
        setFestive(l.festive);
      }),
    [],
  );
  // Christmas look: soft snowflakes falling and swaying
  const snow = useMemo(() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 46 }, () => ({
      x: rnd() * 100,
      s: 2 + Math.round(rnd() * 3),
      o: 0.25 + rnd() * 0.5,
      d: 12 + rnd() * 14,
      delay: -rnd() * 26,
      sway: 10 + rnd() * 30,
      blur: rnd() < 0.3 ? 1 : 0,
    }));
  }, []);

  const dust = useMemo(() => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 34 }, () => ({
      x: rnd() * 100,
      s: rnd() < 0.3 ? 2 : 1,
      o: 0.2 + rnd() * 0.5,
      d: 14 + rnd() * 18,
      delay: -rnd() * 30,
      drift: (rnd() - 0.5) * 60,
    }));
  }, []);

  return (
    <div className="backdrop">
      <div className="dots" />
      <div className="sweep" />
      {festive && moving && (
        <div className="snow">
          {snow.map((p, i) => (
            <i
              key={i}
              style={
                {
                  left: p.x + "%",
                  width: p.s,
                  height: p.s,
                  opacity: p.o,
                  filter: p.blur ? "blur(1px)" : undefined,
                  animationDuration: p.d + "s, " + (3 + (i % 4)) + "s",
                  animationDelay: p.delay + "s, " + p.delay / 3 + "s",
                  "--sway": p.sway + "px",
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
      {festive && <div className="frost" />}
      {moving && !festive && (
        <div className="dust">
          {dust.map((p, i) => (
            <i
              key={i}
              style={
                {
                  left: p.x + "%",
                  width: p.s,
                  height: p.s,
                  opacity: p.o,
                  animationDuration: p.d + "s",
                  animationDelay: p.delay + "s",
                  "--drift": p.drift + "px",
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
