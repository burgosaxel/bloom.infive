async function loadNav() {
  const host = document.getElementById("nav-host");
  if (!host) return;

  const path = window.location.pathname.replace(/\\/g, "/");
  const depth = (path.includes("/pages/") || path.includes("/blog/") || path.includes("/admin/")) ? 1 : 0;
  const prefix = depth === 1 ? "../" : "./";

  const res = await fetch(prefix + "partials/nav.html");
  host.innerHTML = await res.text();

  const home = host.querySelector("[data-home-link]");
  if (home) home.setAttribute("href", prefix + "index.html");

  host.querySelectorAll("[data-link]").forEach(a => {
    const target = a.getAttribute("data-link");
    a.setAttribute("href", prefix + target);
  });

  wireNavInteractions(host);
  setYear();

  await populateBlogDropdown(host, prefix);
}

function setYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
}

function wireNavInteractions(scope) {
  const menuBtn = scope.querySelector(".menuBtn");
  const navLinks = scope.querySelector(".navLinks");

  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(isOpen));
    });
  }

  scope.querySelectorAll(".dropdown .dropBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const dd = btn.closest(".dropdown");
      const isOpen = dd.classList.contains("open");

      scope.querySelectorAll(".dropdown.open").forEach(x => x.classList.remove("open"));
      if (!isOpen) dd.classList.add("open");
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      scope.querySelectorAll(".dropdown.open").forEach(x => x.classList.remove("open"));
    }
  });

  scope.querySelectorAll(".navLinks a").forEach(a => {
    a.addEventListener("click", () => {
      const navLinks2 = scope.querySelector(".navLinks");
      const menuBtn2 = scope.querySelector(".menuBtn");
      if (navLinks2 && menuBtn2) {
        navLinks2.classList.remove("open");
        menuBtn2.setAttribute("aria-expanded", "false");
      }
    });
  });
}

function esc(s){
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function populateBlogDropdown(scope, prefix){
  const menu = scope.querySelector("#blogMenu");
  if (!menu) return;

  try {
    const { db } = await import(prefix + "firebase.js");
    const firestore = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const { collection, query, where, orderBy, limit, getDocs, Timestamp } = firestore;

    // Only published posts; scheduled posts become published by time check on public pages
    // but for dropdown we show posts that are "published" and publishAt <= now.
    const now = Timestamp.now();

    // This query can require an index if you haven't created it yet.
    const q = query(
      collection(db, "posts"),
      where("status", "==", "published"),
      where("publishAt", "<=", now),
      orderBy("publishAt", "desc"),
      limit(6)
    );

    const snap = await getDocs(q);

    const loading = menu.querySelector("span");
    if (loading) loading.remove();

    if (snap.empty) {
      menu.insertAdjacentHTML("beforeend",
        `<span class="muted fine" style="display:block; padding:10px 10px;">No posts yet.</span>`
      );
      return;
    }

    const itemsHtml = snap.docs.map(d => {
      const p = d.data();
      return `<a href="${prefix}blog/post.html?id=${d.id}">${esc(p.title || "Untitled")}</a>`;
    }).join("");

    menu.insertAdjacentHTML("beforeend", itemsHtml);
  } catch (err) {
    const loading = menu.querySelector("span");
    if (loading) loading.textContent = "Posts unavailable.";
  }
}

loadNav();
