(function () {
  const THEME_KEY = "bloomTheme"; // "light" | "dark"

  function getMountEl() {
    return document.getElementById("nav-host") || document.getElementById("navMount");
  }

  function pathPrefix() {
    const p = location.pathname;
    if (p.includes("/pages/")) return "../";
    if (p.includes("/blog/")) return "../";
    if (p.includes("/admin/")) return "../";
    return "./";
  }

  function applyTheme(theme) {
    // ✅ This matches your CSS: body.dark { ... }
    const isDark = theme === "dark";
    document.body.classList.toggle("dark", isDark);

    // Optional compatibility hook (doesn't hurt)
    document.documentElement.setAttribute("data-theme", theme);

    localStorage.setItem(THEME_KEY, theme);
  }

  function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "dark"; // your preferred default
  }

  function formatThemeIcon(themeBtn, theme) {
    themeBtn.textContent = (theme === "dark") ? "☀️" : "🌙";
    themeBtn.title = (theme === "dark") ? "Switch to light" : "Switch to dark";
  }

  function isMobile() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  async function injectNav() {
    const mount = getMountEl();
    if (!mount) return;

    // Apply theme early
    const currentTheme = getTheme();
    applyTheme(currentTheme);

    const prefix = pathPrefix();

    const res = await fetch(prefix + "nav.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch nav.html");
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

    function closeAllDropdowns() {
      mount.querySelectorAll(".dropdown.open").forEach(dd => dd.classList.remove("open"));
    }

    function closeMenu() {
      if (navLinks) navLinks.classList.remove("open");
      closeAllDropdowns();
    }

    if (menuBtn && navLinks) {
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navLinks.classList.toggle("open");

        // If closing the hamburger, also close dropdowns
        if (!navLinks.classList.contains("open")) closeAllDropdowns();
      });

      // close menu on link click (mobile)
      navLinks.querySelectorAll("a").forEach(a => {
        a.addEventListener("click", () => {
          if (isMobile()) closeMenu();
        });
      });
    }

    // Mobile dropdown toggles (Blog / Amazon)
    mount.querySelectorAll(".dropdown .dropBtn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        if (!isMobile()) return; // desktop uses hover
        e.preventDefault();
        e.stopPropagation();

        const dd = btn.closest(".dropdown");
        const wasOpen = dd.classList.contains("open");

        // close others first
        closeAllDropdowns();

        // toggle this one
        dd.classList.toggle("open", !wasOpen);
      });
    });

    // Close menu/dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      if (!isMobile()) return;
      if (!mount.contains(e.target)) closeMenu();
    });

    // If we resize to desktop, clear mobile "open" states
    window.addEventListener("resize", () => {
      if (!isMobile()) closeMenu();
    });

    // Theme toggle button
    const themeBtn = mount.querySelector("#themeBtn");
    if (themeBtn) {
      formatThemeIcon(themeBtn, getTheme());
      themeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = (getTheme() === "dark") ? "light" : "dark";
        applyTheme(next);
        formatThemeIcon(themeBtn, next);
      });
    }

    // Load blog titles into dropdown
    loadBlogTitles(prefix, mount).catch(() => {
      const host = mount.querySelector("#blogTitlesMount");
      if (host) host.innerHTML = `<a href="${map.blogIndex}">All Posts</a>`;
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
      const url = `${prefix}blog/post.html?id=${encodeURIComponent(docSnap.id)}`;

      const a = document.createElement("a");
      a.href = url;
      a.textContent = title;
      // (CSS already makes dropdown items not bold, so no inline styles needed)
      host.appendChild(a);
    });
  }

  document.addEventListener("DOMContentLoaded", injectNav);
})();
