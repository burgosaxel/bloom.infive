// ===== Helpers: base path that works on GitHub Pages + locally =====
function getBasePath() {
  // If you're using a custom domain (bloominfive.blog), base is "/"
  // If you ever use github.io/<repo>, this auto-detects "/<repo>/"
  const parts = window.location.pathname.split("/").filter(Boolean);

  // If running on localhost (Live Server), base is "/"
  const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  if (isLocal) return "/";

  // If custom domain -> usually root
  // If GitHub pages project site -> first part is repo name
  // We'll detect "blog" / "pages" / "admin" and assume repo root is before them.
  if (parts.length === 0) return "/";

  // If your site is hosted at root with custom domain, keep "/"
  // If hosted at github.io/<repo>/..., base = "/<repo>/"
  // Heuristic: if first segment is not one of your known folders, treat it as repo name
  const knownFolders = new Set(["blog", "pages", "admin", "partials"]);
  const first = parts[0];
  if (knownFolders.has(first)) return "/";

  return `/${first}/`;
}

const BASE = getBasePath();

// ===== Inject nav.html into every page =====
async function loadNav() {
  const mount = document.getElementById("navMount");
  if (!mount) return;

  try {
    const res = await fetch(`${BASE}nav.html`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load nav.html (${res.status})`);
    const html = await res.text();
    mount.innerHTML = html;

    // After nav loads, wire up menu + theme + blog dropdown list
    wireNavInteractions();
    populateBlogDropdown();
  } catch (err) {
    console.error("Nav load error:", err);
  }
}

// ===== Wire up interactions after nav is injected =====
function wireNavInteractions() {
  const menuBtn = document.getElementById("menuBtn");
  const navLinks = document.getElementById("navLinks");
  const themeToggle = document.getElementById("themeToggle");

  // Mobile menu toggle
  menuBtn?.addEventListener("click", () => {
    navLinks?.classList.toggle("open");
  });

  // Theme toggle
  const root = document.documentElement;

  function getSystemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function updateToggleIcon() {
    const isDark = root.getAttribute("data-theme") === "dark";
    if (themeToggle) themeToggle.textContent = isDark ? "☀️" : "🌙";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    updateToggleIcon();
  }

  const saved = localStorage.getItem("theme");
  if (saved) {
    applyTheme(saved);
  } else {
    root.setAttribute("data-theme", getSystemTheme());
    updateToggleIcon();
  }

  themeToggle?.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") || getSystemTheme();
    applyTheme(current === "dark" ? "light" : "dark");
  });

  // Fix brand link to always go home
  const homeLink = document.querySelector("[data-home-link]");
  if (homeLink) homeLink.setAttribute("href", `${BASE}index.html`);
}

// ===== Populate Blog dropdown titles (optional) =====
// If you already build blog titles from Firestore elsewhere, keep that.
// This version tries to find a global `window.getNavBlogTitles()` if you created one.
// Otherwise it safely does nothing.
async function populateBlogDropdown() {
  const list = document.getElementById("navBlogList");
  if (!list) return;

  // If you already have a function to get titles, use it.
  if (typeof window.getNavBlogTitles === "function") {
    try {
      const items = await window.getNavBlogTitles();
      list.innerHTML = "";
      items.forEach((p) => {
        const a = document.createElement("a");
        a.href = p.url;
        a.textContent = p.title;
        list.appendChild(a);
      });
    } catch (e) {
      console.warn("Could not populate blog dropdown:", e);
    }
  }
}

// Run
loadNav();
