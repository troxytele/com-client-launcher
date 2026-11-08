"use strict";
// comclient.xyz/admin: overview, players, badges and backups. The key stays in this tab only (sessionStorage).
(() => {
  const { API, el, hours, roleBadges } = window.CC;
  const $ = (id) => document.getElementById(id);
  let key = "";
  try {
    key = sessionStorage.getItem("cc-admin") || "";
  } catch {}

  async function call(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: { "X-Admin-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await r.json();
    } catch {}
    if (!r.ok) throw new Error((data && data.detail) || `Error ${r.status}`);
    return data;
  }

  const ago = (t) => {
    if (!t) return "never";
    const s = Date.now() / 1000 - t;
    if (s < 120) return "just now";
    if (s < 7200) return Math.round(s / 60) + " min ago";
    if (s < 172800) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  };

  function msg(text, bad) {
    $("adm-msg").textContent = text || "";
    $("adm-msg").classList.toggle("bad", !!bad);
  }

  async function overview() {
    const o = await call("GET", "/admin/overview");
    const stats = $("adm-stats");
    stats.textContent = "";
    for (const [label, value] of [
      ["players", o.players],
      ["online now", o.online],
      ["hours played", o.hours],
      ["public pages", o.public_pages],
      ["chats", o.chats],
      ["feed posts", o.feed],
    ]) {
      const d = el("div", "p-stat glass");
      d.append(el("b", null, Number(value).toLocaleString()), el("span", null, label));
      stats.append(d);
    }
    const db = $("adm-db");
    db.textContent = "";
    db.append(
      el("p", null, `db.json: ${o.db_kb.toLocaleString()} KB · saved ${ago(o.last_saved)}`),
      el("p", o.save_error ? "bad" : "muted", o.save_error ? "Problem: " + o.save_error : "Saving works."),
      el("p", "muted", o.backups.length ? `Backups (last 14 days, in backups/ next to db.json): ${o.backups.join(", ")}` : "No backups yet."),
    );
    const roles = $("adm-roles");
    roles.textContent = "";
    for (const [r, names] of Object.entries(o.roles)) {
      const p = el("p");
      p.append(roleBadges([r]), document.createTextNode(` ${r}: ${names.length ? names.join(", ") : "nobody"}`));
      roles.append(p);
    }
    roles.append(el("p", "muted", "Early Supporter goes to everyone who joined before 2027 by itself."));
  }

  async function players(q = "") {
    const box = $("adm-players");
    box.textContent = "Loading…";
    const d = await call("GET", "/admin/players?q=" + encodeURIComponent(q));
    box.textContent = "";
    box.append(el("p", "muted", `${d.total} found${d.total > 200 ? " (first 200)" : ""}`));
    for (const p of d.players) {
      const row = el("div", "adm-row");
      const name = el("a", null, p.name);
      name.href = "/u/" + encodeURIComponent(p.username || p.name);
      name.target = "_blank";
      const left = el("div", "adm-who");
      const title = el("b");
      title.append(name, roleBadges(p.roles));
      left.append(
        title,
        el("small", null, `${p.username ? "@" + p.username + " · " : ""}Lv ${p.level} · ${hours(p.play_seconds)} · ${p.friends} friends · ${p.online ? "online" : "seen " + ago(p.last_seen)}${p.public ? "" : " · private"}`),
      );
      row.append(left);
      for (const r of ["developer", "tester"]) {
        const on = p.roles.includes(r);
        const b = el("button", "btn small " + (on ? "primary" : "ghost"), (on ? "✓ " : "+ ") + r);
        b.type = "button";
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await call("POST", "/admin/role", { player: p.uuid, role: r, on: !on });
            await players($("adm-q").value.trim());
            overview();
          } catch (e) {
            msg(e.message, true);
            b.disabled = false;
          }
        });
        row.append(b);
      }
      box.append(row);
    }
  }

  async function unlock() {
    msg("Checking…");
    try {
      await overview();
      try {
        sessionStorage.setItem("cc-admin", key);
      } catch {}
      $("adm-login").hidden = true;
      $("adm").hidden = false;
      msg("");
      players();
    } catch (e) {
      key = "";
      try {
        sessionStorage.removeItem("cc-admin");
      } catch {}
      msg(e.message, true);
    }
  }

  $("adm-login").addEventListener("submit", (e) => {
    e.preventDefault();
    key = $("adm-key").value;
    $("adm-key").value = "";
    if (key) unlock();
  });
  $("adm-find").addEventListener("submit", (e) => {
    e.preventDefault();
    players($("adm-q").value.trim()).catch((err) => msg(err.message, true));
  });
  $("adm-backup").addEventListener("click", async () => {
    try {
      const r = await call("POST", "/admin/backup");
      msg(r.file ? "Backup written: " + r.file : "Nothing to back up");
      overview();
    } catch (e) {
      msg(e.message, true);
    }
  });
  $("adm-logout").addEventListener("click", () => {
    key = "";
    try {
      sessionStorage.removeItem("cc-admin");
    } catch {}
    location.reload();
  });
  if (key) unlock();
})();
