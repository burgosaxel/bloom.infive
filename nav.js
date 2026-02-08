(async function () {
  const host = document.getElementById("nav-host");
  if (!host) return;

  const base = getBasePath();

  const res = await fetch(base + "nav.html");
  if (!res.ok) {
    host.innerHTML = `<div class="container muted" style="padding:14px 0;">
      Nav failed to load: ${res.status} ${res.statusText} (tried ${base}nav.html)
    </div>`;
    return;
  }
  host.innerHTML = await res.text();

  wireLinks(base);
  setupMobileMenu();
  setupDropdownClicks();
  await loadBlogTitles(base);

  // ---------------- helpers ----------------

  function getBasePath(){
    const p = window.location.pathname;
    if (p.includes("/blog/") || p.includes("/admin/") || p.includes("/pages/")) return "../";
    return "./";
  }

  function wireLinks(base){
    const brand = host.querySelector("[data-home-link]");
    if (brand) brand.href = base + "index.html";

    const map = {
      about: base + "pages/about.html",
      upcoming: base + "pages/upcoming.html",
      activities: base + "pages/activities.html",
      newsletter: base + "pages/newsletter.html",
      amazon: base + "pages/affiliate.html",
      blogIndex: base + "blog/index.html",
    };

    host.querySelectorAll("[data-link]").forEach(a => {
      const key = a.getAttribute("data-link");
      if (map[key]) a.href = map[key];
    });
  }

  function setupMobileMenu(){
    const menuBtn = document.getElementById("menuBtn");
    const navLinks = document.getElementById("navLinks");
    if (!menuBtn || !navLinks) return;

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = navLinks.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // close when clicking outside
    document.addEventListener("click", () => {
      navLinks.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
      closeAllDropdowns();
    });

    // don’t close when clicking inside the menu
    navLinks.addEventListener("click", (e) => e.stopPropagation());

    // close menu on resize to desktop
    window.addEventListener("resize", () => {
      if (window.innerWidth > 640) {
        navLinks.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
        closeAllDropdowns();
      }
    });
  }

  function setupDropdownClicks(){
    const dropdowns = document.querySelectorAll(".dropdown");
    dropdowns.forEach(dd => {
      const btn = dd.querySelector(".dropBtn");
      if (!btn) return;

      btn.addEventListener("click", (e) => {
        // On desktop hover handles it; on mobile, click toggles
        e.stopPropagation();

        const isOpen = dd.classList.contains("open");
        closeAllDropdowns();
        if (!isOpen) dd.classList.add("open");

        btn.setAttribute("aria-expanded", (!isOpen).toString());
      });
    });

    // prevent closing when clicking inside dropdown menu
    document.querySelectorAll(".dropMenu").forEach(menu => {
      menu.addEventListener("click", (e) => e.stopPropagation());
    });
  }

  function closeAllDropdowns(){
    document.querySelectorAll(".dropdown.open").forEach(x => {
      x.classList.remove("open");
      const btn = x.querySelector(".dropBtn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  async function loadBlogTitles(base){
    const titlesHost = document.getElementById("blogTitles");
    if (!titlesHost) return;

    titlesHost.innerHTML = `<p class="muted" style="margin:6px 10px;">Loading…</p>`;

    try {
      const { db } = await import(base + "firebase.js");
      const fs = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
      const { collection, query, where, orderBy, limit, getDocs, Timestamp } = fs;

      const now = Timestamp.now();

      const q = query(
        collection(db, "posts"),
        where("status", "==", "published"),
        where("publishAt", "<=", now),
        orderBy("publishAt", "desc"),
        limit(10)
      );

      const snap = await getDocs(q);

      if (snap.empty) {
        titlesHost.innerHTML = `<p class="muted" style="margin:6px 10px;">No posts yet.</p>`;
        return;
      }

      titlesHost.innerHTML = snap.docs.map(d => {
        const p = d.data();
        const title = escapeHtml(p.title || "Untitled");
        return `<a href="${base}blog/post.html?id=${d.id}">${title}</a>`;
      }).join("");
    } catch (err) {
      titlesHost.innerHTML = `<p class="muted" style="margin:6px 10px;">Couldn’t load posts.</p>`;
    }
  }

  function escapeHtml(s){
    return (s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;");
  }
})();
