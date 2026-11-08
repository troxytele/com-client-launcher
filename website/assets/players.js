"use strict";
// comclient.xyz/players: leaderboards and player search.
(() => {
  const { el, get, hours, roleBadges, face, avatarUrl, profileUrl } = window.CC;
  const board = document.getElementById("board");

  const COLS = {
    playtime: ["Play time", (r) => hours(r.play_seconds)],
    week: ["This week", (r) => hours(r.week_seconds)],
    level: ["Level", (r) => "Level " + r.level],
    streak: ["Best streak", (r) => r.streak + (r.streak === 1 ? " day" : " days")],
    friends: ["Friends", (r) => r.friends.toLocaleString()],
    newest: ["Joined", (r) => joined(r.created)],
    earned: ["Earned", (r) => window.CC.coins(r.earned || 0, 17)],
    points: ["Points", (r) => window.CC.coins(r.points || 0, 17)],
  };
  let by = "playtime";
  const fq = document.getElementById("f-q");
  const frole = document.getElementById("f-role");
  const ftier = document.getElementById("f-tier");

  function joined(t) {
    if (!t) return "";
    const days = Math.floor((Date.now() / 1000 - t) / 86400);
    if (days < 1) return "Today";
    if (days < 2) return "Yesterday";
    if (days < 31) return days + " days ago";
    return new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const tierText = (r) => (r.tier ? (r.tier_high ? "HT" : "LT") + r.tier : "");
  const filtered = () => !!(fq.value.trim() || frole.value || ftier.value !== "0");

  let seq = 0;
  function show() {
    const mine = ++seq;
    board.textContent = "";
    board.append(el("p", "loading", "Loading…"));
    const qs = new URLSearchParams({ by });
    if (fq.value.trim()) qs.set("q", fq.value.trim());
    if (frole.value) qs.set("role", frole.value);
    if (ftier.value !== "0") qs.set("tier", ftier.value);
    get("/public/leaderboard?" + qs)
      .then((d) => {
        if (mine !== seq) return;
        board.textContent = "";
        if (!d.rows.length) {
          board.append(el("p", "loading", filtered() ? "No players match these filters." : "Nobody here yet. Play with Com Client and you could be first!"));
          return;
        }
        if (filtered()) board.append(el("p", "matches", `${d.matches.toLocaleString()} ${d.matches === 1 ? "player matches" : "players match"}`));
        document.getElementById("board-sub").textContent = `${d.players.toLocaleString()} players use Com Client. Only public profiles are shown.`;
        d.rows.forEach((r, i) => {
          const a = el("a", "row" + (i < 3 ? " top top" + (i + 1) : ""));
          a.href = profileUrl(r);
          a.append(el("span", "rank", String(i + 1)));
          if (r.avatar) {
            const img = el("img", "face");
            img.src = avatarUrl(r.uuid, r.avatar);
            img.alt = "";
            a.append(img);
          } else a.append(face(r.uuid, 36));
          const names = el("span", "names");
          const n = el("b", null, r.name);
          n.append(roleBadges(r.roles));
          if (r.tier) {
            const t = el("span", "tier-pill", tierText(r));
            t.title = "Best PvP tier" + (r.tier_mode ? " (" + r.tier_mode + ")" : "");
            n.append(t);
          }
          names.append(n, el("small", null, (r.username ? "@" + r.username + " · " : "") + "Level " + r.level));
          const v = COLS[by][1](r);
          const cell = el("span", "value");
          cell.append(v);
          a.append(names, cell);
          board.append(a);
        });
      })
      .catch((e) => {
        if (mine !== seq) return;
        board.textContent = "";
        board.append(el("p", "loading", "Couldn't load the leaderboard: " + e.message + ". The server may be waking up, try again in a moment."));
      });
  }

  document.querySelectorAll(".board-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".board-tabs .tab").forEach((x) => x.classList.toggle("on", x === t));
      by = t.dataset.by;
      show();
    }),
  );
  document.getElementById("find").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("find-name").value.trim().replace(/^@/, "");
    if (v) location.href = "/u/" + encodeURIComponent(v);
  });
  let typing = 0;
  fq.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(show, 300);
  });
  frole.addEventListener("change", show);
  ftier.addEventListener("change", show);
  show();

  // top inviters this month
  get("/public/inviters")
    .then((d) => {
      if (!d.rows.length) return;
      document.getElementById("inv-month").textContent = "· " + d.month;
      const list = document.getElementById("inv-list");
      d.rows.forEach((r, i) => {
        const a = el("a", "row" + (i < 3 ? " top top" + (i + 1) : ""));
        a.href = profileUrl(r);
        a.append(el("span", "rank", String(i + 1)));
        if (r.avatar) {
          const img = el("img", "face");
          img.src = avatarUrl(r.uuid, r.avatar);
          img.alt = "";
          a.append(img);
        } else a.append(face(r.uuid, 36));
        const names = el("span", "names");
        const n = el("b", null, r.name);
        n.append(roleBadges(r.roles));
        names.append(n, el("small", null, r.username ? "@" + r.username : ""));
        a.append(names, el("span", "value", r.invites + (r.invites === 1 ? " friend" : " friends")));
        list.append(a);
      });
      document.getElementById("inviters").hidden = false;
    })
    .catch(() => {});
})();
