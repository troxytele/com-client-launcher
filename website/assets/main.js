"use strict";
(() => {
  const REPO = "troxytele/com-client-launcher";
  const RELEASES = `https://github.com/${REPO}/releases`;
  const API = `https://api.github.com/repos/${REPO}/releases`;

  // ---------------------------------------------------------------- phone menu
  const toggle = document.querySelector(".nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("menu-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    document.querySelectorAll(".nav nav a").forEach((a) => a.addEventListener("click", () => document.body.classList.remove("menu-open")));
  }

  // ---------------------------------------------------------------- the hero stage: real screens, one after another
  const stage = document.getElementById("stage");
  if (stage) {
    const tabs = [...stage.querySelectorAll("[role=tab]")];
    const shots = [...stage.querySelectorAll(".shot")];
    const TIME = 6000;
    stage.style.setProperty("--stage-time", TIME + "ms");
    let i = 0;
    let timer = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = (n, user) => {
      i = (n + tabs.length) % tabs.length;
      const id = tabs[i].dataset.tab;
      tabs.forEach((t, k) => {
        t.classList.remove("on");
        t.setAttribute("aria-selected", String(k === i));
      });
      void tabs[i].offsetWidth; // restart the progress line
      tabs[i].classList.add("on");
      shots.forEach((s) => {
        if (s.dataset.shot === id) s.loading = "eager";
        s.classList.toggle("on", s.dataset.shot === id);
      });
      // the next screen starts loading now, so the swap never shows an empty frame
      const next = shots.find((s) => s.dataset.shot === tabs[(i + 1) % tabs.length].dataset.tab);
      if (next) next.loading = "eager";
      clearTimeout(timer);
      if (user || reduce) {
        stage.classList.add("paused");
        return;
      }
      timer = setTimeout(() => show(i + 1), TIME);
    };
    tabs.forEach((t, k) => {
      t.addEventListener("click", () => show(k, true));
      t.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          show(i + (e.key === "ArrowRight" ? 1 : -1), true);
          tabs[i].focus();
        }
      });
    });
    // using the live Click GUI stops the slideshow on it
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".cg")) {
        clearTimeout(timer);
        stage.classList.add("paused");
      }
    });
    // only play while it's on screen
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((e) => {
        if (stage.classList.contains("paused")) return;
        if (e[0].isIntersecting) show(i);
        else clearTimeout(timer);
      }).observe(stage);
    } else show(0);
  }

  // ---------------------------------------------------------------- download button
  const cacheKey = "cc-latest";
  const readCache = () => {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      return c && Date.now() - c.at < 10 * 60 * 1000 ? c : null;
    } catch { return null; }
  };
  const applyLatest = (url, version, size) => {
    if (size) document.querySelectorAll("[data-size]").forEach((s) => { s.textContent = `${(size / 1048576).toFixed(1)} MB`; });
    document.querySelectorAll("[data-download]").forEach((a) => {
      a.href = url;
      if (url.endsWith(".exe")) a.setAttribute("download", "");
    });
    if (version) document.querySelectorAll("[data-version]").forEach((s) => { s.textContent = `Version ${version}`; });
  };
  // before anything loads, the buttons point to the releases page
  applyLatest(`${RELEASES}/latest`);

  const cached = readCache();
  if (cached) applyLatest(cached.url, cached.version, cached.size);
  else {
    fetch(`${API}/latest`, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rel) => {
        const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name) && !/\.sig$/i.test(a.name));
        const msi = (rel.assets || []).find((a) => /\.msi$/i.test(a.name));
        const asset = exe || msi;
        const url = asset ? asset.browser_download_url : rel.html_url;
        const version = String(rel.tag_name || "").replace(/^v/, "");
        if (!/^https:\/\/github\.com\//.test(url)) return;
        const size = asset ? asset.size : 0;
        applyLatest(url, version, size);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ url, version, size, at: Date.now() })); } catch {}
      })
      .catch(() => {});
  }

  // ---------------------------------------------------------------- changelog page
  const list = document.getElementById("releases");
  if (!list) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // tiny, safe markdown: headings, bullet lists, paragraphs. Everything as text, never HTML.
  const strip = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  const renderBody = (md, into) => {
    let ul = null;
    for (const raw of String(md || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { ul = null; continue; }
      if (/^#{1,6}\s/.test(line)) { ul = null; into.append(el("div", "kind", strip(line.replace(/^#+\s*/, "")))); continue; }
      if (/^[-*+]\s/.test(line)) {
        if (!ul) { ul = el("ul"); into.append(ul); }
        ul.append(el("li", null, strip(line.replace(/^[-*+]\s+/, ""))));
        continue;
      }
      ul = null;
      into.append(el("p", "body", strip(line)));
    }
  };

  fetch(`${API}?per_page=30`, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rels) => {
      list.textContent = "";
      const shown = rels.filter((r) => !r.draft);
      if (!shown.length) { list.append(el("p", "loading", "No releases yet.")); return; }
      shown.forEach((rel, i) => {
        const card = el("article", "release glass");
        const head = el("header");
        head.append(el("h3", null, rel.name || rel.tag_name));
        if (i === 0) head.append(el("span", "tag", "LATEST"));
        if (rel.prerelease) head.append(el("span", "tag", "PREVIEW"));
        const t = el("time", null, new Date(rel.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
        t.dateTime = rel.published_at;
        head.append(t);
        card.append(head);
        if (rel.body && rel.body.trim()) renderBody(rel.body, card);
        else card.append(el("p", "body", "Bug fixes and improvements."));
        list.append(card);
      });
    })
    .catch(() => {
      list.textContent = "";
      const p = el("p", "loading", "Couldn't load the changelog right now. ");
      const a = el("a", null, "See it on GitHub");
      a.href = RELEASES;
      a.rel = "noopener";
      p.append(a);
      list.append(p);
    });
})();

// ---------------------------------------------------------------- motion: fade in on scroll, tilt on hover, count up
(() => {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // sections and cards fade up as they scroll in (a little after each other inside a group)
  const REVEAL = ".sec-head, .tile, .stat, .ver-card, .lshot, .launcher-list, .community > *, .news > *, .faq-grid details, .download, .steps li, .dl-info > *, .wn-card, .page-head, .help-grid > *";
  const items = [...document.querySelectorAll(REVEAL)].filter((n) => !n.closest(".hero"));
  if (!still && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach((n) => {
      // anything already on screen when the page opens just shows
      const r = n.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92) return;
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.matches(REVEAL)) : [];
      n.style.setProperty("--d", Math.min(sibs.indexOf(n), 6) * 70 + "ms");
      n.classList.add("reveal");
      io.observe(n);
    });
  }

  // cards lean toward the pointer, with a soft light where it is
  if (fine && !still) {
    document.querySelectorAll(".tile, .ver-card, .news article, .steps li, .wn-card:not(.static), .stat, .dl-card").forEach((card) => {
      card.classList.add("tilt");
      let raf = 0;
      card.addEventListener("pointermove", (e) => {
        if (e.target.closest(".cg, canvas, input")) return; // the live Click GUI and 3D previews stay still
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
          const max = r.width > 600 ? 2 : 5; // big tiles barely move
          card.style.setProperty("--rx", ((0.5 - y) * max).toFixed(2) + "deg");
          card.style.setProperty("--ry", ((x - 0.5) * max).toFixed(2) + "deg");
          card.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
          card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
          card.classList.add("lit");
        });
      });
      card.addEventListener("pointerleave", () => {
        cancelAnimationFrame(raf);
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
        card.classList.remove("lit");
      });
    });
  }

  // numbers count up the first time they're seen
  const count = (b) => {
    const to = Number(b.dataset.count) || 0, suffix = b.dataset.suffix || "";
    if (still || !to) { b.textContent = to.toLocaleString() + suffix; return; }
    const t0 = performance.now(), dur = 1400;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      b.textContent = Math.round(to * e).toLocaleString() + (p === 1 ? suffix : "");
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  window.CCCount = count;
  const nums = document.querySelectorAll("[data-count]");
  if (nums.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.dataset.counted = "1";
        count(e.target);
        io.unobserve(e.target);
      }
    }, { threshold: 0.6 });
    nums.forEach((n) => io.observe(n));
  }
})();
