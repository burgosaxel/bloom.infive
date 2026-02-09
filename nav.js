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

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "dark"; // your default
  }

  function formatThemeIcon(themeBtn, theme) {
    themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
    themeBtn.title = theme === "dark" ? "Switch to light" : "Switch to dark";
  }

  async function waitForFirebase(maxMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (window.fb && window.fbFns && window.fb.db) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
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

    // Wire links
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

    mount.querySelectorAll("[data-link]").forEach((a) => {
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
      navLinks.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => navLinks.classList.remove("open"));
      });
    }

    // Mobile dropdown toggles (click-to-open only on mobile)
    mount.querySelectorAll(".dropdown .dropBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 760px)").matches) {
          const dd = btn.closest(".dropdown");
          dd.classList.toggle("open");
        }
      });
    });

    // Theme toggle
    const themeBtn = mount.querySelector("#themeBtn");
    if (themeBtn) {
      formatThemeIcon(themeBtn, getTheme());
      themeBtn.addEventListener("click", () => {
        const next = getTheme() === "dark" ? "light" : "dark";
        setTheme(next);
        formatThemeIcon(themeBtn, next);
      });
    }

    // Load blog titles into dropdown
    loadBlogTitles(prefix, mount, map).catch(() => {
      const host = mount.querySelector("#blogTitlesMount");
      if (host) host.innerHTML = `<a href="${map.blogIndex}">View posts</a>`;
    });
  }

  async function loadBlogTitles(prefix, mount, map) {
    const host = mount.querySelector("#blogTitlesMount");
    if (!host) return;

    host.innerHTML = `<a href="${map.blogIndex}">Loading…</a>`;

    const ok = await waitForFirebase(12000);
    if (!ok) {
      host.innerHTML = `<a href="${map.blogIndex}">View posts</a>`;
      return;
    }

    const { db } = window.fb;
    const { collection, query, where, orderBy, limit, getDocs } = window.fbFns;

    const q = query(
      collection(db, "posts"),
      where("published", "==", true),
      orderBy("publishAt", "desc"),
      limit(8)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      host.innerHTML = `<a href="${map.blogIndex}">No posts yet</a>`;
      return;
    }

    host.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const title = (data.title || "Untitled").toString();
      const url = `${prefix}blog/post.html?id=${encodeURIComponent(docSnap.id)}`;

      const a = document.createElement("a");
      a.href = url;
      a.textContent = title;
      a.className = "dropItem"; // CSS can style this, avoids inline hacks
      host.appendChild(a);
    });
  }

  document.addEventListener("DOMContentLoaded", injectNav);
})();
