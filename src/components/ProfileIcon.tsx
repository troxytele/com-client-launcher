import { useEffect, useState } from "react";
import { api } from "../api";
import logo from "../assets/logo.png";

// Block/item textures come out of the game jar; asked for in small batches and kept for the session.
const cache = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
let queued: string[] = [];
let timer: number | null = null;

function flush() {
  timer = null;
  const names = queued;
  queued = [];
  api
    .icons(names)
    .then((m) => {
      for (const n of names) {
        const url = m[n] ?? "";
        cache.set(n, url);
        waiting.get(n)?.forEach((f) => f(url));
        waiting.delete(n);
      }
    })
    .catch(() => {
      for (const n of names) {
        waiting.get(n)?.forEach((f) => f(""));
        waiting.delete(n);
      }
    });
}

export function iconUrl(name: string): Promise<string> {
  if (!name) return Promise.resolve("");
  if (name.startsWith("data:")) return Promise.resolve(name);
  const hit = cache.get(name);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((res) => {
    const list = waiting.get(name);
    if (list) {
      list.push(res);
      return;
    }
    waiting.set(name, [res]);
    queued.push(name);
    if (timer === null) timer = window.setTimeout(flush, 16);
  });
}

export function useIcon(name: string) {
  const [url, setUrl] = useState(() => (name.startsWith("data:") ? name : cache.get(name) ?? ""));
  useEffect(() => {
    let live = true;
    iconUrl(name).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [name]);
  return url;
}

/** A profile's picture: a Minecraft block/item, an uploaded picture, or the Com Client logo. */
export default function ProfileIcon({ icon, size = 34, className = "" }: { icon: string; size?: number; className?: string }) {
  const url = useIcon(icon || "");
  const pixel = icon.startsWith("item:") || icon.startsWith("block:");
  return (
    <span className={"picon " + className} style={{ width: size, height: size }}>
      {url ? (
        pixel ? (
          <i className="pixel" style={{ backgroundImage: `url(${url})` }} />
        ) : (
          <img src={url} alt="" />
        )
      ) : (
        <img src={logo} alt="" className="logo" />
      )}
    </span>
  );
}
