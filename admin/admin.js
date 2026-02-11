// admin/admin.js (module)
// Admin portal: login + manage posts/pages/affiliate/profile
// Requires ../firebase.js (ES module) with named exports.

import {
  auth, db, storage,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, Timestamp, serverTimestamp,
  storageRef, uploadBytes, getDownloadURL
} from "../firebase.js";

const THEME_KEY = "bloomTheme";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function msg(el, text, kind = "") {
  if (!el) return;
  el.textContent = text || "";
  el.style.color = kind === "bad" ? "#ffb3b3" : kind === "ok" ? "#b7ffcf" : "";
}

function show(el, yes) {
  if (!el) return;
  el.style.display = yes ? "" : "none";
}

// ---------- Theme ----------
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  const btn = $("#themeBtn"); // optional if you add one later
  if (btn) {
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.title = theme === "dark" ? "Switch to light" : "Switch to dark";
  }
}

function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

// ---------- Helpers ----------
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

function escapeHtml(s) {
  return (s || "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---------- Quill editors ----------
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

// ---------- Auth ----------
async function onLogin(e) {
  e.preventDefault();

  const email = $("#email")?.value?.trim();
  const pass = $("#password")?.value || "";
  const out = $("#loginMsg");

  if (!email || !pass) {
    msg(out, "Enter email + password.", "bad");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    msg(out, "Signed in ✅", "ok");
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

// ---------- Tabs ----------
function activateTab(tab) {
  $$(".tabBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".pane").forEach(p => p.classList.toggle("active", p.id === `pane-${tab}`));
}

// ---------- Posts ----------
let editingPostId = null;

function openPostForm(open) {
  show($("#postEditorWrap"), !!open);
  show($("#cancelPostBtn"), !!open);
}

function clearPostForm() {
  editingPostId = null;
  $("#postTitle").value = "";
  $("#postTags").value = "";
  $("#postStatus").value = "draft";
  $("#publishAt").value = "";
  if (postEditor) postEditor.root.innerHTML = "";
  msg($("#postMsg"), "");
}

function computePublished(status, publishAtTs) {
  const now = new Date();
  if (status === "published") return true;
  if (status === "scheduled" && publishAtTs && publishAtTs.toDate() <= now) return true;
  return false;
}

async function editPost(id) {
  initEditors();
  const snap = await getDoc(doc(db, "posts", id));
  if (!snap.exists()) return;

  const d = snap.data() || {};
  editingPostId = id;

  $("#postTitle").value = d.title || "";
  $("#postTags").value = Array.isArray(d.tags) ? d.tags.join(", ") : "";
  $("#postStatus").value = d.status || "draft";
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

async function savePost() {
  initEditors();
  const out = $("#postMsg");

  const title = $("#postTitle")?.value?.trim() || "";
  const tags = ($("#postTags")?.value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const status = $("#postStatus")?.value || "draft";
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
  const host = $("#postsList");
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
    row.className = "item";

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.whiteSpace = "nowrap";
    title.style.overflow = "hidden";
    title.style.textOverflow = "ellipsis";
    title.textContent = d.title || "Untitled";

    const meta = document.createElement("div");
    meta.className = "muted fine";
    meta.textContent = `${(d.status || "draft")} • ${formatDate(d.publishAt)}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "actions";

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

// ---------- Pages ----------
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
  const key = $("#pageSelect")?.value || "upcoming";
  const content = pageEditor ? pageEditor.root.innerHTML : "";

  try {
    await setDoc(doc(db, "pages", key), { content, updatedAt: serverTimestamp() }, { merge: true });
    msg(out, "Saved ✅", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Save failed.", "bad");
  }
}

// ---------- Affiliate ----------
let editingLinkId = null;

function openLinkForm(open) {
  show($("#linkFormWrap"), !!open);
  show($("#cancelLinkBtn"), !!open);
}

function clearLinkForm() {
  editingLinkId = null;
  $("#linkTitle").value = "";
  $("#linkUrl").value = "";
  $("#linkCategory").value = "";
  $("#linkDesc").value = "";
  msg($("#linkMsg"), "");
}

async function refreshLinks() {
  const host = $("#linksList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading…</div>";

  // orderBy serverTimestamp fields can be tricky; use updatedAt if present, fallback to createdAt if needed
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
    row.className = "item";

    const left = document.createElement("div");
    left.style.minWidth = "0";
    left.innerHTML = `
      <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(d.title || "Link")}
      </div>
      <div class="muted fine" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(d.url || "")}
      </div>
      <div class="muted fine">${escapeHtml(d.category || "")}</div>
    `;

    const right = document.createElement("div");
    right.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      editingLinkId = docSnap.id;
      $("#linkTitle").value = d.title || "";
      $("#linkUrl").value = d.url || "";
      $("#linkCategory").value = d.category || "";
      $("#linkDesc").value = d.desc || "";
      openLinkForm(true);
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
  const out = $("#linkMsg");
  const title = $("#linkTitle")?.value?.trim() || "";
  const url = $("#linkUrl")?.value?.trim() || "";
  const category = $("#linkCategory")?.value?.trim() || "";
  const desc = $("#linkDesc")?.value?.trim() || "";

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
    openLinkForm(false);
    clearLinkForm();
    await refreshLinks();
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Save failed.", "bad");
  }
}

// ---------- Profile ----------
async function uploadProfile() {
  const out = $("#profileMsg");
  msg(out, "");

  const file = $("#profileFile")?.files?.[0];
  if (!file) {
    msg(out, "Choose an image first.", "bad");
    return;
  }

  try {
    const sRef = storageRef(storage, `assets/author-${Date.now()}-${file.name}`);
    await uploadBytes(sRef, file);
    const url = await getDownloadURL(sRef);

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

// ---------- Boot / Wire UI ----------
function wireUI() {
  setTheme(getTheme());
  $("#themeBtn")?.addEventListener("click", () => setTheme(getTheme() === "dark" ? "light" : "dark"));

  $("#loginForm")?.addEventListener("submit", onLogin);
  $("#logoutBtn")?.addEventListener("click", onLogout);

  // tabs
  $$(".tabBtn").forEach(btn => btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    activateTab(tab);

    if (tab === "posts") refreshPosts().catch(console.error);
    if (tab === "pages") loadPage($("#pageSelect")?.value || "upcoming").catch(console.error);
    if (tab === "affiliate") refreshLinks().catch(console.error);
    if (tab === "profile") loadProfile().catch(console.error);
  }));

  // posts
  $("#newPostBtn")?.addEventListener("click", () => {
    initEditors();
    clearPostForm();
    openPostForm(true);
  });

  $("#cancelPostBtn")?.addEventListener("click", () => {
    openPostForm(false);
    clearPostForm();
  });

  $("#savePostBtn")?.addEventListener("click", savePost);

  // pages
  $("#loadPageBtn")?.addEventListener("click", () => loadPage($("#pageSelect")?.value || "upcoming"));
  $("#savePageBtn")?.addEventListener("click", savePage);

  // affiliate
  $("#newLinkBtn")?.addEventListener("click", () => {
    clearLinkForm();
    openLinkForm(true);
  });

  $("#cancelLinkBtn")?.addEventListener("click", () => {
    openLinkForm(false);
    clearLinkForm();
  });

  $("#saveLinkBtn")?.addEventListener("click", saveLink);

  // profile
  $("#uploadProfileBtn")?.addEventListener("click", uploadProfile);
}

document.addEventListener("DOMContentLoaded", () => {
  initEditors();
  wireUI();

  const authBox = $("#authBox");
  const adminBox = $("#adminBox");
  const logoutBtn = $("#logoutBtn");

  onAuthStateChanged(auth, (user) => {
    show(authBox, !user);
    show(adminBox, !!user);
    show(logoutBtn, !!user);

    if (user) {
      activateTab("posts");
      refreshPosts().catch(console.error);
      loadProfile().catch(console.error);
    }
  });
});
