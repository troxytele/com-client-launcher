"use strict";
// comclient.xyz/r/<name>: an invite link. Tells the server who sent this computer (kept 7 days), so the new
// player and their friend both get points once the new player has played an hour.
(() => {
  const { API, avatarUrl, face } = window.CC;
  const $ = (id) => document.getElementById(id);
  const who = decodeURIComponent(location.pathname.replace(/^\/r\/?/, "").replace(/\/$/, ""));
  if (!who) return;
  fetch(API + "/public/ref/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ who }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((p) => {
      document.title = `${p.name} invited you · Com Client`;
      $("inv-title").textContent = `${p.name} invited you`;
      const img = $("inv-face");
      if (p.avatar) {
        img.src = avatarUrl(p.uuid, p.avatar);
        img.hidden = false;
      } else {
        const c = face(p.uuid, 84);
        c.className = "inv-face";
        img.replaceWith(c);
      }
      const gift = $("inv-gift");
      gift.textContent = `◆ +${p.welcome} points for you after ${p.play_hours} hour${p.play_hours === 1 ? "" : "s"} of play`;
      gift.hidden = false;
    })
    .catch(() => {});
})();
