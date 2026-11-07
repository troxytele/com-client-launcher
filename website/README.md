# comclient.xyz

The Com Client website: plain HTML, CSS and JS, no build step. Hosted on Cloudflare Pages.

- `index.html`: home (features, screenshots, cosmetics, launcher, FAQ, download)
- `changelog.html`: launcher changelog
- `assets/shots/`: real in-game and launcher screenshots (WebP)
- `_headers`: security headers (CSP, HSTS, no framing) and caching

The Download buttons ask GitHub for the newest launcher release and link straight to its `.exe`.
If GitHub can't be reached, they fall back to the releases page.

## Cloudflare Pages settings

- Framework preset: None
- Build command: (empty)
- Build output directory: `website`
