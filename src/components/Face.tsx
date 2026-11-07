// A player's face, cut out of their skin (face + hat layer), pixel-sharp.
export default function Face({ skin, name, size = 32, round }: { skin?: string; name?: string; size?: number; round?: boolean }) {
  const r = round ? "50%" : Math.max(4, size / 5) + "px";
  if (!skin) {
    return (
      <div className="face face-empty" style={{ width: size, height: size, borderRadius: r, fontSize: size * 0.45 }}>
        {(name || "?").slice(0, 1).toUpperCase()}
      </div>
    );
  }
  const layer = (x: number) => ({
    backgroundImage: `url("${skin}")`,
    backgroundSize: `${size * 8}px auto`,
    backgroundPosition: `-${size * x}px -${size}px`,
  });
  return (
    <div className="face" style={{ width: size, height: size, borderRadius: r }}>
      <div className="face-layer" style={layer(1)} />
      <div className="face-layer" style={layer(5)} />
    </div>
  );
}
