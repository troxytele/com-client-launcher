// The admin page moved off the public website (it lives on the backend at a secret address now).
// An old copy of /admin stayed in Cloudflare's cache, so answer this path ourselves: always "not found".
export async function onRequest({ request, env }) {
  const page = await env.ASSETS.fetch(new URL("/404", request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
