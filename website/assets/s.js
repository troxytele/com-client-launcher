"use strict";
// comclient.xyz/s/<id>: a screenshot someone shared from the game.
(() => {
  const { API, avatarUrl, face } = window.CC;
  const $ = (id) => document.getElementById(id);
  const id = location.pathname.replace(/^\/s\/?/, "").replace(/\/$/, "");
  const msg = $("shot-msg");
  if (!/^[A-Za-z0-9]{6,12}$/.test(id)) {
    msg.textContent = "This link isn't a Com Client screenshot.";
    return;
  }
  const ago = (t) => {
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  };
  fetch(`${API}/shots/${id}`, { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((s) => {
      const src = `${API}/shots/${id}/image`;
      const img = $("shot-img");
      img.onload = () => msg.remove();
      img.onerror = () => (msg.textContent = "The picture couldn't be loaded.");
      if (s.w && s.h) {
        img.width = s.w;
        img.height = s.h;
      }
      img.src = src;
      document.title = `${s.name}'s screenshot · Com Client`;
      $("shot-name").textContent = s.name;
      $("shot-who").href = `/u/${encodeURIComponent(s.username || s.name)}`;
      const fi = $("shot-face");
      const av = s.avatar ? avatarUrl(s.uuid, s.avatar) : null;
      if (av) {
        fi.src = av;
        fi.hidden = false;
      } else {
        fi.replaceWith(face(s.uuid, 32));
      }
      $("shot-meta").textContent = `${ago(s.at)} · ${s.views.toLocaleString("en")} view${s.views === 1 ? "" : "s"}`;
      $("shot-full").href = src;
      $("shot-copy").onclick = () =>
        navigator.clipboard.writeText(location.href).then(() => {
          $("shot-copy").textContent = "Copied";
          setTimeout(() => ($("shot-copy").textContent = "Copy link"), 1500);
        });
      $("shot-bar").hidden = false;
    })
    .catch((st) => {
      msg.textContent = st === 404 ? "This screenshot is gone (they're kept 30 days)." : "The server is waking up, try again in a moment.";
    });
})();
