"use strict";
// A live copy of Com Client's Click GUI (Right Shift in game), built from the client's own layout:
// the same categories, modules, icons, sizes and glass. It's laid out in game units (a 960 x 528 screen at GUI
// scale 2) and scaled to fit, so it stays sharp at any size. Click a card to switch it, use the tabs and search.
window.CCClickGui = (() => {
  const CATS = [
    ["RENDER", "Render", "See the world in a different light", "cat_render"],
    ["COMBAT", "Combat", "Read every fight at a glance", "cat_combat"],
    ["HUD", "HUD", "Everything you want on screen, nothing more", "cat_hud"],
    ["PLAYER", "Player", "Little things that feel good", "cat_player"],
    ["CLIENT", "Client", "Menu, HUD layout and the rest", "settings"],
  ];
  const W = 960;
  const H = 528;
  let modulesPromise = null;
  const loadModules = () => (modulesPromise ||= fetch("/assets/gui/modules.json").then((r) => r.json()));

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const icon = (name, cls) => {
    const i = h("i", "cg-ic " + (cls || ""));
    i.style.setProperty("--ic", `url(/assets/gui/${name}.png)`);
    return i;
  };

  function mount(root, { category = "RENDER", interactive = true } = {}) {
    const screen = h("div", "cg-screen");
    root.append(screen);
    const fit = () => {
      const s = root.clientWidth / W;
      screen.style.transform = `scale(${s})`;
      root.style.setProperty("--cg-h", H * s + "px");
    };
    new ResizeObserver(fit).observe(root);
    fit();

    let mods = [];
    let cat = category;
    let filter = "All";
    let query = "";
    const favs = new Set(["Death Animations", "Glass"]);

    // ---- top bar
    const top = h("div", "cg-top");
    const brand = h("div", "cg-brand");
    const logo = h("img");
    logo.src = "/assets/logo.png";
    logo.alt = "";
    brand.append(logo, h("b", null, "COM CLIENT"));
    const tabs = h("div", "cg-tabs");
    const search = h("label", "cg-search");
    const input = h("input");
    input.placeholder = "Search";
    input.setAttribute("aria-label", "Search modules");
    input.tabIndex = interactive ? 0 : -1;
    search.append(icon("search"), input, h("kbd", null, "/"));
    top.append(brand, tabs, search);

    // ---- heading row
    const head = h("div", "cg-head");
    const title = h("h4");
    const sub = h("p");
    const right = h("div", "cg-right");
    head.append(h("div", null), right);
    head.firstChild.append(title, sub);
    const grid = h("div", "cg-grid");
    const hint = h("div", "cg-hint", "Click to toggle  ·  Right-click for settings  ·  ← → categories  ·  Esc to close");
    screen.append(top, head, grid, hint);

    function drawTabs() {
      tabs.textContent = "";
      for (const [id, name, , ic] of CATS) {
        const b = h("button", "cg-tab" + (id === cat ? " on" : ""));
        b.type = "button";
        b.tabIndex = interactive ? 0 : -1;
        b.setAttribute("aria-label", name);
        b.append(icon(ic), h("span", null, name));
        b.addEventListener("click", () => {
          cat = id;
          query = "";
          input.value = "";
          draw(true);
        });
        tabs.append(b);
      }
    }

    function visible() {
      const q = query.trim().toLowerCase();
      let out = mods.filter((m) => {
        if (q) return q.split(/\s+/).every((w) => (m.name + " " + m.desc + " " + m.cat).toLowerCase().includes(w));
        return filter === "Favourites" ? favs.has(m.name) : m.cat === cat;
      });
      if (filter === "On") out = out.filter((m) => m.on);
      return out.sort((a, b) => favs.has(b.name) - favs.has(a.name));
    }

    function card(m, i) {
      const c = h("div", "cg-card" + (m.on ? " on" : ""));
      c.style.setProperty("--i", i);
      const sq = h("span", "cg-sq");
      sq.append(icon(m.icon));
      const sw = h("span", "cg-switch");
      const tools = h("span", "cg-tools");
      const star = h("span", "cg-star" + (favs.has(m.name) ? " fav" : ""));
      star.append(icon("star"));
      const set = h("span", "cg-set");
      set.append(icon("sliders"));
      tools.append(star, set, sw);
      c.append(sq, tools, h("b", null, m.name), h("small", null, m.desc));
      c.title = m.desc;
      if (interactive) {
        c.tabIndex = 0;
        c.setAttribute("role", "switch");
        c.setAttribute("aria-checked", String(m.on));
        const toggle = () => {
          m.on = !m.on;
          c.classList.toggle("on", m.on);
          c.setAttribute("aria-checked", String(m.on));
          counts();
        };
        c.addEventListener("click", (e) => {
          if (e.target.closest(".cg-star")) {
            favs.has(m.name) ? favs.delete(m.name) : favs.add(m.name);
            star.classList.toggle("fav", favs.has(m.name));
            return;
          }
          toggle();
        });
        c.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        });
      }
      return c;
    }

    function counts() {
      right.textContent = "";
      const list = visible();
      for (const name of ["All", "On", "Favourites"]) {
        const b = h("button", "cg-chip" + (name === filter ? " on" : ""));
        b.type = "button";
        b.tabIndex = interactive ? 0 : -1;
        if (name === "Favourites") b.append(icon("star"));
        b.append(document.createTextNode(name));
        b.addEventListener("click", () => {
          filter = name;
          draw(true);
        });
        right.append(b);
      }
      if (cat !== "CLIENT" || query) {
        const n = h("span", "cg-count");
        n.append(h("i"), document.createTextNode(`${list.filter((m) => m.on).length} of ${list.length} active`));
        right.append(n);
      }
    }

    function draw(animate) {
      const c = CATS.find((x) => x[0] === cat);
      const searching = query.trim() !== "";
      title.textContent = searching ? "Search" : filter === "Favourites" ? "Favourites" : c[1];
      sub.textContent = searching ? `Results for "${query.trim()}"` : filter === "Favourites" ? "Your starred modules from every category" : c[2];
      drawTabs();
      counts();
      grid.textContent = "";
      grid.classList.toggle("anim", !!animate);
      const list = visible();
      list.forEach((m, i) => grid.append(card(m, i)));
      if (!list.length) grid.append(h("p", "cg-empty", filter === "On" ? "Nothing here is switched on" : "Nothing found"));
    }

    input.addEventListener("input", () => {
      query = input.value;
      draw(false);
    });
    if (!interactive) screen.inert = true;

    loadModules().then((m) => {
      // each copy of the GUI gets its own on/off state
      mods = m.map((x) => ({ ...x }));
      draw(false);
    });
    return { setCategory: (id) => { cat = id; draw(true); } };
  }

  return { mount };
})();

document.querySelectorAll("[data-clickgui]").forEach((el) => {
  window.CCClickGui.mount(el, { category: el.dataset.clickgui || "RENDER", interactive: el.dataset.static === undefined });
});
