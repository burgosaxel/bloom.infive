const menuBtn = document.getElementById("menuBtn");
const navLinks = document.getElementById("navLinks");
const themeToggle = document.getElementById("themeToggle");
const root = document.documentElement;

/* ---------- Mobile menu ---------- */
menuBtn?.addEventListener("click", () => {
  navLinks.classList.toggle("open");
});

/* ---------- Theme toggle ---------- */
function getSystemTheme(){
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme){
  if(theme === "light"){
    root.setAttribute("data-theme","light");
  }else{
    root.setAttribute("data-theme","dark");
  }
  localStorage.setItem("theme", theme);
  updateToggleIcon();
}

function updateToggleIcon(){
  const isDark = root.getAttribute("data-theme") === "dark";
  if(themeToggle) themeToggle.textContent = isDark ? "☀️" : "🌙";
}

const saved = localStorage.getItem("theme");
if(saved){
  applyTheme(saved);
}else{
  // Default to system (no save)
  root.setAttribute("data-theme", getSystemTheme());
  updateToggleIcon();
}

themeToggle?.addEventListener("click", () => {
  const current = root.getAttribute("data-theme") || getSystemTheme();
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
});