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

  async function ensureFirebase(prefix) {
    // If already present, we're done
    if (window.fb && window.fbFns) return true;

    // Try to load firebase.js as a module (it sets window.fb + window.fbFns)
    try {
      await import(prefix + "firebase.js");
    } catch (e) {
      console.warn("Failed to import firebase.js:", e);
    }

    return !!(window.fb && window.fbFns);
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
      btn.addEventListener("click", () => {
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

    // Ensure Firebase exists, then load blog titles
    const ok = await ensureFirebase(prefix);
    if (!ok) {
      const host = mount.querySelector("#blogTitlesMount");
      if (host) host.innerHTML = `<a href="${map.blogIndex}">View posts</a>`;
      return;
    }

    loadBlogTitles(prefix, mount).catch(() => {
      const host = mount.querySelector("#blogTitlesMount");
      if (host) host.innerHTML = `<a href="${map.blogIndex}">View posts</a>`;
    });
  }

  async function loadBlogTitles(prefix, mount) {
    const { db } = window.fb;
    const { collection, query, where, orderBy, limit, getDocs } = window.fbFns;

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
      a.style.fontWeight = "400";
      host.appendChild(a);
    });
  }

  document.addEventListener("DOMContentLoaded", injectNav);
})();
