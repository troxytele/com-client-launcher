// Cloudflare Pages Function for comclient.xyz/s/<id>: the screenshot page, with the picture itself in the link
// preview (Discord, X, WhatsApp...). Browsers get the plain page and load everything themselves.
const API = "https://com-client.onrender.com";

const PREVIEW_BOTS = /discordbot|twitterbot|facebookexternalhit|whatsapp|telegrambot|slackbot|linkedinbot|skypeuripreview|redditbot|embedly|googlebot|bingbot|applebot|iframely|vkshare|pinterest/i;

const esc = (s) => String(s).replace(/[<>"&]/g, "");

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL("/s", url));
  const id = String((params.path || [])[0] || "");
  if (!/^[A-Za-z0-9]{6,12}$/.test(id)) return page;
  if (!PREVIEW_BOTS.test(request.headers.get("user-agent") || "")) return page;

  let s = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const headers = env.EDGE_KEY ? { "X-Edge-Key": env.EDGE_KEY, "X-Visitor-IP": request.headers.get("cf-connecting-ip") || "" } : {};
    const r = await fetch(`${API}/shots/${id}`, { signal: ctl.signal, headers, cf: { cacheTtl: 300, cacheEverything: true } });
    clearTimeout(timer);
    if (r.ok) s = await r.json();
  } catch {
    // asleep or unreachable: plain page
  }
  if (!s) return page;

  const title = esc(`${s.name}'s screenshot · Com Client`);
  const desc = esc(`Shared from Com Client by ${s.name}`);
  const image = `${API}/shots/${id}/image`;
  const canonical = `https://comclient.xyz/s/${id}`;
  const set = (attr, value) => ({ element: (e) => e.setAttribute(attr, value) });
  return new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', set("content", desc))
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:description"]', set("content", desc))
    .on('meta[property="og:image"]', set("content", image))
    .on('meta[property="og:url"]', set("content", canonical))
    .on('link[rel="canonical"]', set("href", canonical))
    .on("head", { element: (e) => e.append(`<meta property="og:image:width" content="${s.w}"><meta property="og:image:height" content="${s.h}">`, { html: true }) })
    .transform(page);
}
