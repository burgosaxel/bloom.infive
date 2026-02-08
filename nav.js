// ===== Base path helper (works on custom domain + GitHub Pages + localhost) =====
function getBasePath() {
  const isLocal =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";

  if (isLocal) return "/";

  // If using a custom domain, you're usually at root
  // If using github.io/<repo>/, first segment is repo name
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "/";

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
    mount.innerHTML = await res.text();

    wireNavInteractions();
    populateBlogDropdown(); // optional, only runs if you provide getNavBlogTitles()
  } catch (err) {
    console.error("Nav load error:", err);
  }
}

// ===== Wire up menu + theme after nav mounts =====
function wireNavInteractions() {
  const menuBtn = document.getElementById("menuBtn");
  const navLinks = document.getElementById("navLinks");
  const themeToggle = document.getElementById("themeToggle");

  // Mobile menu
  menuBtn?.addEventListener("click", () => {
    navLinks?.classList.toggle("open");
  });

  // Close menu when tapping a link (mobile)
  navLinks?.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    navLinks.classList.remove("open");
  });

  // Brand always home (base-aware)
  const homeLink = document.querySelector("[data-home-link]");
  if (homeLink) homeLink.setAttribute("href", `${BASE}index.html`);

  // ===== THEME TOGGLE (fixed) =====
  const root = document.documentElement;

  function updateToggleIcon() {
    const isDark = root.getAttribute("data-theme") === "dark";
    if (themeToggle) themeToggle.textContent = isDark ? "☀️" : "🌙";
  }

  function applyTheme(theme) {
    // Force explicit theme so it never "falls back" into prefers-color-scheme
    root.setAttribute("data-theme", theme); // "dark" or "light"
    localStorage.setItem("theme", theme);
    updateToggleIcon();
  }

  // Init theme
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") {
    applyTheme(saved);
  } else {
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    applyTheme(system);
  }

  // Toggle click
  themeToggle?.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

// ===== Optional blog dropdown population =====
// If you already have a function in blog/index.html that exposes titles,
// you can provide this globally:
//
// window.getNavBlogTitles = async () => [{ title, url }, ...]
//
async function populateBlogDropdown() {
  const list = document.getElementById("navBlogList");
  if (!list) return;

  if (typeof window.getNavBlogTitles !== "function") return;

  try {
    const items = await window.getNavBlogTitles();
    // keep first section (All Posts + divider), then append titles
    // We will append after the divider.
    const divider = list.querySelector(".dropDivider");
    if (!divider) return;

    // Remove any previously injected items after divider
    const all = Array.from(list.children);
    const dividerIndex = all.indexOf(divider);
    all.slice(dividerIndex + 1).forEach((n) => n.remove());

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

// Run
loadNav();