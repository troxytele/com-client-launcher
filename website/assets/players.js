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
  };

  function show(by) {
    board.textContent = "";
    board.append(el("p", "loading", "Loading…"));
    get("/public/leaderboard?by=" + by)
      .then((d) => {
        board.textContent = "";
        if (!d.rows.length) {
          board.append(el("p", "loading", "Nobody here yet. Play with Com Client and you could be first!"));
          return;
        }
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
          names.append(n, el("small", null, (r.username ? "@" + r.username + " · " : "") + "Level " + r.level));
          a.append(names, el("span", "value", COLS[by][1](r)));
          board.append(a);
        });
      })
      .catch((e) => {
        board.textContent = "";
        board.append(el("p", "loading", "Couldn't load the leaderboard: " + e.message + ". The server may be waking up, try again in a moment."));
      });
  }

  document.querySelectorAll(".board-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".board-tabs .tab").forEach((x) => x.classList.toggle("on", x === t));
      show(t.dataset.by);
    }),
  );
  document.getElementById("find").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("find-name").value.trim().replace(/^@/, "");
    if (v) location.href = "/u/" + encodeURIComponent(v);
  });
  show("playtime");
})();
