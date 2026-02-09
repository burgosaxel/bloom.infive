(function () {
  const THEME_KEY = "bloomTheme"; // "light" | "dark"

  function getMountEl() {
    return document.getElementById("nav-host") || document.getElementById("navMount");
  }

  function pathPrefix() {
    // Works on /, /pages/*, /blog/*, /admin/*
    const p = location.pathname;
    if (p.includes("/pages/")) return "../";
    if (p.includes("/blog/")) return "../";
    if (p.includes("/admin/")) return "../";
    return "./";
  }

  function setTheme(theme) {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "dark"; // default you liked
  }

  function formatThemeIcon(themeBtn, theme) {
    themeBtn.textContent = (theme === "dark") ? "☀️" : "🌙";
    themeBtn.title = (theme === "dark") ? "Switch to light" : "Switch to dark";
  }

  async function injectNav() {
    const mount = getMountEl();
    if (!mount) return;

    // Apply theme early
    const currentTheme = getTheme();
    setTheme(currentTheme);

    const prefix = pathPrefix();
    const res = await fetch(prefix + "nav.html", { cache: "no-store" });
    const html = await res.text();
    mount.innerHTML = html;

    // Wire links (absolute-by-prefix)
    const homeLink = mount.querySelector("[data-home-link]");
    if (homeLink) homeLink.href = prefix + "index.html";

    const map = {
      about: prefix + "pages/about.html",
      upcoming: prefix + "pages/upcoming.html",
      activities: prefix + "pages/activities.html",
      newsletter: prefix + "pages/newsletter.html",
      blogIndex: prefix + "blog/index.html",
      amazonAffiliate: prefix + "pages/affiliate.html"
    };

    mount.querySelectorAll("[data-link]").forEach(a => {
      const k = a.getAttribute("data-link");
      if (map[k]) a.href = map[k];
    });

    // Hamburger menu
    const menuBtn = mount.querySelector("#menuBtn");
    const navLinks = mount.querySelector("#navLinks");
    if (menuBtn && navLinks) {
      menuBtn.addEventListener("click", () => {
        navLinks.classList.toggle("open");
      });

      // close menu on link click (mobile)
      navLinks.querySelectorAll("a").forEach(a => {
        a.addEventListener("click", () => navLinks.classList.remove("open"));
      });
    }

    // Mobile dropdown toggles
    mount.querySelectorAll(".dropdown .dropBtn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        // only act like "click-to-open" on mobile widths
        if (window.matchMedia("(max-width: 760px)").matches) {
          const dd = btn.closest(".dropdown");
          dd.classList.toggle("open");
        }
      });
    });

    // Theme toggle button
    const themeBtn = mount.querySelector("#themeBtn");
    if (themeBtn) {
      formatThemeIcon(themeBtn, getTheme());
      themeBtn.addEventListener("click", () => {
        const next = (getTheme() === "dark") ? "light" : "dark";
        setTheme(next);
        formatThemeIcon(themeBtn, next);
      });
    }

    // Load blog titles into dropdown
    loadBlogTitles(prefix, mount).catch(() => {
      const host = mount.querySelector("#blogTitlesMount");
      if (host) host.innerHTML = `<a href="${map.blogIndex}">View posts</a>`;
    });
  }

  async function loadBlogTitles(prefix, mount) {
    // Wait for firebase to be ready
    const start = Date.now();
    while ((!window.fb || !window.fbFns) && Date.now() - start < 8000) {
      await new Promise(r => setTimeout(r, 150));
    }
    if (!window.fb || !window.fbFns) return;

    const { db } = window.fb;
    const { collection, query, where, orderBy, limit, getDocs } = window.fbFns;

    // Pull published posts ordered by publishAt desc
    const q = query(
      collection(db, "posts"),
      where("published", "==", true),
      orderBy("publishAt", "desc"),
      limit(8)
    );

    const snap = await getDocs(q);

    const host = mount.querySelector("#blogTitlesMount");
    if (!host) return;

    if (snap.empty) {
      host.innerHTML = `<a href="${prefix}blog/index.html">No posts yet</a>`;
      return;
    }

    host.innerHTML = "";
    snap.forEach(docSnap => {
      const data = docSnap.data() || {};
      const title = (data.title || "Untitled").toString();
      // Your blog viewer likely uses post.html?id=DOCID
      const url = `${prefix}blog/post.html?id=${encodeURIComponent(docSnap.id)}`;

      const a = document.createElement("a");
      a.href = url;
      a.textContent = title;
      a.style.fontWeight = "400";
      host.appendChild(a);
    });
  }

  // Run
  document.addEventListener("DOMContentLoaded", injectNav);
})();
