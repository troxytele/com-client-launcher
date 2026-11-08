// Cloudflare Pages Function for comclient.xyz/u/<name>: the same page as always, but with the player's name,
// level and skin in the link preview (Discord, X, WhatsApp...). If the API is asleep it just serves the page.
const API = "https://com-client.onrender.com";

const esc = (s) => String(s).replace(/[<>"&]/g, "");

function hours(secs) {
  const h = Math.floor(secs / 3600);
  return h >= 1 ? `${h.toLocaleString("en")} h` : `${Math.max(0, Math.round(secs / 60))} min`;
}

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL("/u", url));
  const name = decodeURIComponent((params.path || [])[0] || "").slice(0, 40);
  if (!name || !/^[\w@.-]+$/.test(name)) return page;

  let p = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${API}/public/player/${encodeURIComponent(name)}`, { signal: ctl.signal, cf: { cacheTtl: 300, cacheEverything: true } });
    clearTimeout(timer);
    if (r.ok) p = await r.json();
  } catch {
    // asleep or unreachable: plain page
  }
  if (!p) return page;

  const roles = { developer: "Developer", tester: "Tester", early: "Early Supporter" };
  const badge = (p.roles || []).map((r) => roles[r]).filter(Boolean)[0];
  const title = esc(`${p.name} · Level ${p.level}${badge ? " · " + badge : ""} · Com Client`);
  const bio = String(p.bio || "").split("\n")[0].slice(0, 90);
  const desc = esc(`${hours(p.play_seconds)} played · ${p.title} · ${p.friends} friends${bio ? " · " + bio : ""}`);
  const image = `https://mc-heads.net/body/${String(p.uuid).replace(/-/g, "")}/right`;
  const canonical = `https://comclient.xyz/u/${encodeURIComponent(p.username || p.name)}`;

  const set = (sel, attr, value) => ({ element: (e) => e.setAttribute(attr, value) });
  return new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', set("", "content", desc))
    .on('meta[property="og:title"]', set("", "content", title))
    .on('meta[property="og:description"]', set("", "content", desc))
    .on('meta[property="og:image"]', set("", "content", image))
    .on('meta[property="og:url"]', set("", "content", canonical))
    .on('link[rel="canonical"]', set("", "href", canonical))
    .transform(page);
}
