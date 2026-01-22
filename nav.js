async function loadNav() {
  const host = document.getElementById("nav-host");
  if (!host) return;

  const path = window.location.pathname.replace(/\\/g, "/");
  const depth = (path.includes("/pages/") || path.includes("/blog/")) ? 1 : 0;
  const prefix = depth === 1 ? "../" : "./";

  const res = await fetch(prefix + "partials/nav.html");
  const html = await res.text();
  host.innerHTML = html;

  const home = host.querySelector("[data-home-link]");
  if (home) home.setAttribute("href", prefix + "index.html");

  host.querySelectorAll("[data-link]").forEach(a => {
    const target = a.getAttribute("data-link");
    a.setAttribute("href", prefix + target);
  });

  wireNavInteractions(host);
  setYear();
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

loadNav();
