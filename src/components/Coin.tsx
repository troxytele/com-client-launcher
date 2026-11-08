import { useId } from "react";

/** The Com Client points coin: a gold coin with the C. */
export default function Coin({ size = 16, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={"coin " + className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id + "r"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD866" />
          <stop offset="0.55" stopColor="#E59B1C" />
          <stop offset="1" stopColor="#A9600B" />
        </linearGradient>
        <radialGradient id={id + "f"} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#FFF3B8" />
          <stop offset="0.45" stopColor="#FFD04A" />
          <stop offset="1" stopColor="#E8A11E" />
        </radialGradient>
        <linearGradient id={id + "m"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B8700F" />
          <stop offset="1" stopColor="#8A4E06" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="33.5" r="29" fill="#7A4205" opacity="0.55" />
      <circle cx="32" cy="32" r="29" fill={`url(#${id}r)`} />
      <circle cx="32" cy="32" r="23.5" fill={`url(#${id}f)`} />
      <circle cx="32" cy="32" r="23.5" fill="none" stroke="#C47F12" strokeWidth="1.6" opacity="0.7" />
      {size >= 24 && <circle cx="32" cy="32" r="19.5" fill="none" stroke="#FFF6CC" strokeWidth="1" opacity="0.55" strokeDasharray="2 2.6" />}
      <path d="M41.2 23.6 A12.4 12.4 0 1 0 41.2 40.4" fill="none" stroke="#FFF1B0" strokeWidth="7.2" strokeLinecap="round" transform="translate(0.7 1)" opacity="0.8" />
      <path d="M41.2 23.6 A12.4 12.4 0 1 0 41.2 40.4" fill="none" stroke={`url(#${id}m)`} strokeWidth="7.2" strokeLinecap="round" />
      <ellipse cx="22" cy="17" rx="9" ry="4.2" fill="#FFFFFF" opacity="0.55" transform="rotate(-28 22 17)" />
    </svg>
  );
}
