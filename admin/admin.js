// admin/admin.js (module)
// Admin portal: login + manage posts/pages/affiliate/profile
// Requires /firebase.js (root) to export needed items.

import {
  auth, db, storage,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, Timestamp, serverTimestamp,
  ref, uploadBytes, getDownloadURL
} from "../firebase.js";

const THEME_KEY = "bloomTheme";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function pickEl(...selectors) {
  for (const s of selectors) {
    const el = $(s);
    if (el) return el;
  }
  return null;
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  const btn = pickEl("#themeToggle", "#themeBtn");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.title = theme === "dark" ? "Switch to light" : "Switch to dark";
    btn.setAttribute("aria-label", btn.title);
  }
}

function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "dark"; // default you liked
}

function msg(el, text, kind = "") {
  if (!el) return;
  el.textContent = text || "";
  el.style.color = kind === "bad" ? "#ffb3b3" : kind === "ok" ? "#b7ffcf" : "";
}

function show(el, yes) {
  if (!el) return;
  el.style.display = yes ? "" : "none";
}

function activateTab(tab) {
  $$(".tabBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".pane").forEach(p => p.classList.toggle("active", p.id === `pane-${tab}`));
}

function toTimestampFromLocalInput(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function toLocalInputValue(dateObj) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(dateObj);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(ts) {
  try {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}

function slugifyTitle(t) {
  return (t || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---- Editors ----
let postEditor = null;
let pageEditor = null;

function initEditors() {
  if (window.Quill && !postEditor) {
    postEditor = new window.Quill("#editor", {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["link", "blockquote", "code-block"],
          [{ align: [] }],
          ["clean"]
        ]
      }
    });
  }

  if (window.Quill && !pageEditor) {
    pageEditor = new window.Quill("#pageEditor", {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["link", "blockquote", "code-block"],
          [{ align: [] }],
          ["clean"]
        ]
      }
    });
  }
}

// ---- Auth ----
async function onLogin(e) {
  e.preventDefault();

  // Support both old/new IDs
  const emailEl = pickEl("#email", "#emailInput");
  const passEl = pickEl("#password", "#passInput");
  const out = pickEl("#loginMsg");

  const email = emailEl?.value?.trim();
  const pass = passEl?.value || "";

  if (!email || !pass) {
    msg(out, "Enter email + password.", "bad");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    msg(out, "Signed in.", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Login failed.", "bad");
  }
}

async function onLogout() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
  }
}

// ---- Posts ----
let editingPostId = null;

function openPostForm(open) {
  show($("#postEditorWrap"), !!open);
}

function clearPostForm() {
  editingPostId = null;
  $("#postTitle").value = "";
  $("#tags").value = "";
  $("#status").value = "draft";
  $("#publishAt").value = "";
  if (postEditor) postEditor.root.innerHTML = "";
  msg($("#postMsg"), "");
}

async function editPost(id) {
  initEditors();
  const snap = await getDoc(doc(db, "posts", id));
  if (!snap.exists()) return;

  const d = snap.data() || {};
  editingPostId = id;

  $("#postTitle").value = d.title || "";
  $("#tags").value = Array.isArray(d.tags) ? d.tags.join(", ") : "";
  $("#status").value = d.status || "draft";
  $("#publishAt").value = d.publishAt?.toDate ? toLocalInputValue(d.publishAt.toDate()) : "";
  if (postEditor) postEditor.root.innerHTML = d.content || "";

  openPostForm(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deletePost(id) {
  if (!confirm("Delete this post?")) return;
  await deleteDoc(doc(db, "posts", id));
  await refreshPosts();
}

function computePublished(status, publishAtTs) {
  const now = new Date();
  if (status === "published") return true;
  if (status === "scheduled" && publishAtTs && publishAtTs.toDate() <= now) return true;
  return false;
}

async function savePost() {
  initEditors();
  const out = $("#postMsg");

  const title = $("#postTitle")?.value?.trim() || "";
  const tags = ($("#tags")?.value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const status = $("#status")?.value || "draft";
  const publishAtTs = toTimestampFromLocalInput($("#publishAt")?.value || "");
  const content = postEditor ? postEditor.root.innerHTML : "";

  if (!title) {
    msg(out, "Title is required.", "bad");
    return;
  }

  const payload = {
    title,
    slug: slugifyTitle(title),
    tags,
    status,
    published: computePublished(status, publishAtTs || null),
    publishAt: publishAtTs || Timestamp.fromDate(new Date()),
    content,
    updatedAt: serverTimestamp()
  };

  try {
    if (editingPostId) {
      await updateDoc(doc(db, "posts", editingPostId), payload);
    } else {
      payload.createdAt = serverTimestamp();
      const refDoc = await addDoc(collection(db, "posts"), payload);
      editingPostId = refDoc.id;
    }

    msg(out, "Saved ✅", "ok");
    await refreshPosts();
    openPostForm(false);
    clearPostForm();
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Save failed.", "bad");
  }
}

async function refreshPosts() {
  const host = $("#postList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading…</div>";

  const q = query(collection(db, "posts"), orderBy("publishAt", "desc"), limit(60));
  const snap = await getDocs(q);

  if (snap.empty) {
    host.innerHTML = "<div class='muted'>No posts yet.</div>";
    return;
  }

  host.innerHTML = "";
  snap.forEach(docSnap => {
    const d = docSnap.data() || {};

    const row = document.createElement("div");
    row.className = "postItem";

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const t = document.createElement("div");
    t.style.fontWeight = "700";
    t.style.whiteSpace = "nowrap";
    t.style.overflow = "hidden";
    t.style.textOverflow = "ellipsis";
    t.textContent = d.title || "Untitled";

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.style.fontSize = "13px";
    meta.textContent = `${(d.status || "draft")} • ${formatDate(d.publishAt)}`;

    left.appendChild(t);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexShrink = "0";

    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editPost(docSnap.id));

    const delBtn = document.createElement("button");
    delBtn.className = "btn small ghost";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deletePost(docSnap.id));

    right.appendChild(editBtn);
    right.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(right);

    host.appendChild(row);
  });
}

// ---- Pages ----
async function loadPage(key) {
  initEditors();
  msg($("#pageMsg"), "");

  const snap = await getDoc(doc(db, "pages", key));
  const d = snap.exists() ? (snap.data() || {}) : {};
  if (pageEditor) pageEditor.root.innerHTML = d.content || "";
}

async function savePage() {
  initEditors();
  const out = $("#pageMsg");
  const key = $("#pageSelect")?.value || "about";
  const content = pageEditor ? pageEditor.root.innerHTML : "";

  try {
    await setDoc(doc(db, "pages", key), { content, updatedAt: serverTimestamp() }, { merge: true });
    msg(out, "Saved ✅", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Save failed.", "bad");
  }
}

// ---- Affiliate ----
let editingLinkId = null;

function escapeHtml(s) {
  return (s || "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function refreshLinks() {
  const host = $("#affiliateList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading…</div>";

  const q = query(collection(db, "affiliateLinks"), orderBy("updatedAt", "desc"), limit(200));
  const snap = await getDocs(q);

  if (snap.empty) {
    host.innerHTML = "<div class='muted'>No links yet.</div>";
    return;
  }

  host.innerHTML = "";
  snap.forEach(docSnap => {
    const d = docSnap.data() || {};

    const row = document.createElement("div");
    row.className = "listItem";

    const left = document.createElement("div");
    left.style.minWidth = "0";
    left.innerHTML = `
      <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.title || "Link")}</div>
      <div class="muted" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.url || "")}</div>
      <div class="muted" style="font-size:13px;">${escapeHtml(d.category || "")}</div>
    `;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexShrink = "0";

    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      editingLinkId = docSnap.id;
      $("#affiliateTitle").value = d.title || "";
      $("#affiliateUrl").value = d.url || "";
      $("#affiliateCategory").value = d.category || "";
      $("#affiliateDesc").value = d.desc || "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn small ghost";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this link?")) return;
      await deleteDoc(doc(db, "affiliateLinks", docSnap.id));
      await refreshLinks();
    });

    right.appendChild(editBtn);
    right.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(right);

    host.appendChild(row);
  });
}

async function saveLink() {
  const out = $("#affiliateMsg");

  const title = $("#affiliateTitle")?.value?.trim() || "";
  const url = $("#affiliateUrl")?.value?.trim() || "";
  const category = $("#affiliateCategory")?.value?.trim() || "";
  const desc = $("#affiliateDesc")?.value?.trim() || "";

  if (!title || !url) {
    msg(out, "Title + URL required.", "bad");
    return;
  }

  const payload = { title, url, category, desc, updatedAt: serverTimestamp() };
  try {
    if (editingLinkId) {
      await updateDoc(doc(db, "affiliateLinks", editingLinkId), payload);
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "affiliateLinks"), payload);
    }

    msg(out, "Saved ✅", "ok");
    editingLinkId = null;
    $("#affiliateTitle").value = "";
    $("#affiliateUrl").value = "";
    $("#affiliateCategory").value = "";
    $("#affiliateDesc").value = "";
    await refreshLinks();
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Save failed.", "bad");
  }
}

// ---- Profile ----
async function uploadProfile() {
  const out = $("#profileMsg");
  msg(out, "");

  const file = $("#profileFile")?.files?.[0];
  if (!file) {
    msg(out, "Choose an image first.", "bad");
    return;
  }

  try {
    const storageRef = ref(storage, `assets/author-${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    await setDoc(doc(db, "site", "profile"), { photoUrl: url, updatedAt: serverTimestamp() }, { merge: true });

    const img = $("#profilePreview");
    if (img) img.src = url;

    msg(out, "Uploaded ✅", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Upload failed.", "bad");
  }
}

async function loadProfile() {
  const snap = await getDoc(doc(db, "site", "profile"));
  if (!snap.exists()) return;
  const d = snap.data() || {};
  const img = $("#profilePreview");
  if (img && d.photoUrl) img.src = d.photoUrl;
}

// ---- Boot ----
function wireUI() {
  setTheme(getTheme());

  pickEl("#themeToggle", "#themeBtn")?.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  });

  $("#loginForm")?.addEventListener("submit", onLogin);
  $("#logoutBtn")?.addEventListener("click", onLogout);

  // tabs
  $$(".tabBtn").forEach(btn => btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    activateTab(tab);
    if (tab === "posts") refreshPosts().catch(console.error);
    if (tab === "pages") loadPage($("#pageSelect")?.value || "about").catch(console.error);
    if (tab === "affiliate") refreshLinks().catch(console.error);
    if (tab === "profile") loadProfile().catch(console.error);
  }));

  // posts
  $("#newPost")?.addEventListener("click", () => { initEditors(); openPostForm(true); clearPostForm(); });
  $("#savePost")?.addEventListener("click", savePost);

  // pages
  $("#pageSelect")?.addEventListener("change", (e) => loadPage(e.target.value));
  $("#savePage")?.addEventListener("click", savePage);

  // affiliate
  $("#saveAffiliate")?.addEventListener("click", saveLink);

  // profile
  $("#uploadProfile")?.addEventListener("click", uploadProfile);
}

document.addEventListener("DOMContentLoaded", () => {
  initEditors();
  wireUI();

  const authBox = $("#authBox");
  const adminBox = $("#adminBox");

  onAuthStateChanged(auth, (user) => {
    show(authBox, !user);
    show(adminBox, !!user);

    if (user) {
      activateTab("posts");
      refreshPosts().catch(console.error);
      loadProfile().catch(console.error);
    }
  });
});
