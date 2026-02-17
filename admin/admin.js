// admin/admin.js (module)
// Admin portal: login + manage posts/pages/affiliate/profile
// Requires /firebase.js (root) to export needed items.

import {
  auth, db, storage,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  collection, doc, getDoc, getDocs, getCountFromServer, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, Timestamp, serverTimestamp,
  ref, uploadBytes, getDownloadURL
} from "../firebase.js";

const THEME_KEY = "bloomTheme";
const ICON_SUN = "\u2600\uFE0F";  // ☀️
const ICON_MOON = "\uD83C\uDF19"; // 🌙

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const PAGE_KEYS = ["activities", "newsletter"];

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
    btn.textContent = theme === "dark" ? ICON_SUN : ICON_MOON;
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

// ---- Admin Logs ----
function safeMeta(obj) {
  try {
    const s = JSON.stringify(obj || {});
    return s.length > 1000 ? s.slice(0, 1000) : s;
  } catch {
    return "";
  }
}

async function writeAdminLog(action, entity, entityId, metaObj) {
  try {
    const u = auth.currentUser;
    if (!u) return;
    await addDoc(collection(db, "adminLogs"), {
      actorUid: u.uid,
      actorEmail: (u.email || "").toString().slice(0, 254),
      action: (action || "").toString().slice(0, 60),
      entity: (entity || "").toString().slice(0, 60),
      entityId: (entityId || "").toString().slice(0, 200),
      meta: safeMeta(metaObj),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // Logging should never break admin workflows.
    console.warn("adminLogs write failed:", e);
  }
}

// ---- Editors ----
let postEditor = null;
const pageEditors = {};

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

  PAGE_KEYS.forEach((key) => {
    const mountSel = `#pageEditor-${key}`;
    if (!window.Quill || pageEditors[key] || !$(mountSel)) return;
    pageEditors[key] = new window.Quill(mountSel, {
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
  });
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
    await signInWithEmailAndPassword(auth, email.toLowerCase(), pass);
    msg(out, "Signed in.", "ok");
  } catch (err) {
    console.error(err);
    const code = (err && err.code) ? String(err.code) : "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      msg(out, "Login failed: check email/password, and confirm Email/Password sign-in is enabled in Firebase Auth.", "bad");
      return;
    }
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

async function onGoogleLogin() {
  const out = pickEl("#loginMsg");
  msg(out, "");
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error(err);
    const code = (err && err.code) ? String(err.code) : "";
    if (code.includes("popup")) {
      await signInWithRedirect(auth, provider);
      return;
    }
    msg(out, err?.message || "Google login failed.", "bad");
  }
}

async function isAdminUser(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch (e) {
    console.error(e);
    return false;
  }
}

// ---- Posts ----
let editingPostId = null;

function openPostForm(open) {
  show($("#postEditorWrap"), !!open);
  show($("#cancelPostBtn"), !!open);
}

function clearPostForm() {
  editingPostId = null;
  $("#postTitle").value = "";
  const tagsEl = pickEl("#postTags", "#tags");
  const statusEl = pickEl("#postStatus", "#status");
  if (tagsEl) tagsEl.value = "";
  if (statusEl) statusEl.value = "draft";
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
  const tagsEl = pickEl("#postTags", "#tags");
  const statusEl = pickEl("#postStatus", "#status");
  if (tagsEl) tagsEl.value = Array.isArray(d.tags) ? d.tags.join(", ") : "";
  if (statusEl) statusEl.value = d.status || "draft";
  $("#publishAt").value = d.publishAt?.toDate ? toLocalInputValue(d.publishAt.toDate()) : "";
  if (postEditor) postEditor.root.innerHTML = d.contentHtml || d.content || "";

  openPostForm(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deletePost(id) {
  if (!confirm("Delete this post?")) return;
  await deleteDoc(doc(db, "posts", id));
  await writeAdminLog("post_delete", "post", id, {});
  await refreshPosts();
}

function computePublished(status, publishAtTs) {
  if (status === "published") return true;
  if (status === "scheduled" && publishAtTs) return true;
  return false;
}

async function savePost() {
  initEditors();
  const out = $("#postMsg");

  const title = $("#postTitle")?.value?.trim() || "";
  const tags = (pickEl("#postTags", "#tags")?.value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const status = pickEl("#postStatus", "#status")?.value || "draft";
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
    contentHtml: content,
    updatedAt: serverTimestamp()
  };

  try {
    if (editingPostId) {
      await updateDoc(doc(db, "posts", editingPostId), payload);
      await writeAdminLog("post_update", "post", editingPostId, { title, status, tagsCount: tags.length });
    } else {
      payload.createdAt = serverTimestamp();
      const refDoc = await addDoc(collection(db, "posts"), payload);
      editingPostId = refDoc.id;
      await writeAdminLog("post_create", "post", editingPostId, { title, status, tagsCount: tags.length });
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
  const host = pickEl("#postsList", "#postList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading...</div>";

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

async function reconcilePostData() {
  const snap = await getDocs(query(collection(db, "posts"), limit(200)));
  if (snap.empty) return;

  const writes = [];

  snap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const status = (d.status || "").toString().toLowerCase();
    const hasPublishAt = !!d.publishAt;

    let desiredPublished = d.published === true;
    if (status === "published") desiredPublished = true;
    if (status === "scheduled" && hasPublishAt) desiredPublished = true;
    if (status === "draft") desiredPublished = false;

    const patch = {};
    if (d.published !== desiredPublished) patch.published = desiredPublished;
    if (!d.publishAt && status === "published") patch.publishAt = Timestamp.now();
    if (!d.contentHtml && d.content) patch.contentHtml = d.content;

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      writes.push(updateDoc(doc(db, "posts", docSnap.id), patch));
    }
  });

  if (writes.length) await Promise.all(writes);
}

async function migrateLegacyUpcomingBooks() {
  const snap = await getDocs(query(collection(db, "upcomingBooks"), limit(200)));
  if (snap.empty) return;

  const writes = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const target = doc(db, "books", docSnap.id);
    writes.push(
      setDoc(target, {
        title: d.title || "Untitled",
        link: d.link || "",
        coverUrl: d.coverUrl || "",
        summary: d.summary || "",
        status: "upcoming",
        createdAt: d.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true })
    );
  });

  if (writes.length) await Promise.all(writes);
}

// ---- Pages ----
let editingUpcomingId = null;

function openUpcomingForm(open) {
  show($("#upcomingFormWrap"), !!open);
  show($("#cancelUpcomingBtn"), !!open);
}

function clearUpcomingForm() {
  editingUpcomingId = null;
  $("#upcomingTitle").value = "";
  $("#upcomingLink").value = "";
  $("#upcomingCoverUrl").value = "";
  $("#upcomingSummary").value = "";
  $("#upcomingStatus").value = "upcoming";
  msg($("#upcomingMsg"), "");
}

async function openBookInEditor(id) {
  const snap = await getDoc(doc(db, "books", id));
  if (!snap.exists()) return;
  const d = snap.data() || {};
  editingUpcomingId = id;
  $("#upcomingTitle").value = d.title || "";
  $("#upcomingLink").value = d.link || "";
  $("#upcomingCoverUrl").value = d.coverUrl || "";
  $("#upcomingSummary").value = d.summary || "";
  $("#upcomingStatus").value = d.status || "upcoming";
  activateTab("upcoming");
  openUpcomingForm(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function refreshUpcomingBooks() {
  const host = $("#upcomingList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading...</div>";
  const snap = await getDocs(
    query(
      collection(db, "books"),
      where("status", "==", "upcoming"),
      limit(200)
    )
  );

  if (snap.empty) {
    host.innerHTML = "<div class='muted'>No upcoming books yet.</div>";
    return;
  }

  host.innerHTML = "";
  const docs = [...snap.docs].sort((a, b) => {
    const at = a.data()?.createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
    const bt = b.data()?.createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
    return bt - at;
  });
  docs.forEach((docSnap) => {
    const d = docSnap.data() || {};

    const row = document.createElement("div");
    row.className = "listItem";

    const left = document.createElement("div");
    left.style.minWidth = "0";
    left.innerHTML = `
      <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.title || "Untitled")}</div>
      <div class="muted" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.link || "")}</div>
      <div class="muted" style="font-size:13px;">${escapeHtml(d.summary || "")}</div>
    `;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexShrink = "0";

    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openBookInEditor(docSnap.id));

    const delBtn = document.createElement("button");
    delBtn.className = "btn small ghost";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this upcoming book?")) return;
      await deleteDoc(doc(db, "books", docSnap.id));
      await writeAdminLog("book_delete", "book", docSnap.id, { title: d.title || "", status: d.status || "" });
      await refreshUpcomingBooks();
      await refreshPublishedBooks();
    });

    right.appendChild(editBtn);
    right.appendChild(delBtn);
    row.appendChild(left);
    row.appendChild(right);
    host.appendChild(row);
  });
}

async function saveUpcomingBook() {
  const out = $("#upcomingMsg");
  const title = $("#upcomingTitle")?.value?.trim() || "";
  const link = $("#upcomingLink")?.value?.trim() || "";
  const coverUrl = $("#upcomingCoverUrl")?.value?.trim() || "";
  const summary = $("#upcomingSummary")?.value?.trim() || "";
  const status = $("#upcomingStatus")?.value || "upcoming";

  if (!title) {
    msg(out, "Book title is required.", "bad");
    return;
  }

  const payload = { title, link, coverUrl, summary, status, updatedAt: serverTimestamp() };

  try {
    if (editingUpcomingId) {
      await updateDoc(doc(db, "books", editingUpcomingId), payload);
      await writeAdminLog("book_update", "book", editingUpcomingId, { title, status });
    } else {
      payload.createdAt = serverTimestamp();
      const refDoc = await addDoc(collection(db, "books"), payload);
      await writeAdminLog("book_create", "book", refDoc.id, { title, status });
    }
    msg(out, "Saved ✅", "ok");
    openUpcomingForm(false);
    clearUpcomingForm();
    await refreshUpcomingBooks();
    await refreshPublishedBooks();
  } catch (err) {
    console.error(err);
    msg(out, err?.message || "Save failed.", "bad");
  }
}

async function refreshPublishedBooks() {
  const host = $("#publishedBooksList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading...</div>";
  const snap = await getDocs(
    query(
      collection(db, "books"),
      where("status", "==", "published"),
      limit(200)
    )
  );

  if (snap.empty) {
    host.innerHTML = "<div class='muted'>No published books yet.</div>";
    return;
  }

  host.innerHTML = "";
  const docs = [...snap.docs].sort((a, b) => {
    const at = a.data()?.createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
    const bt = b.data()?.createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
    return bt - at;
  });
  docs.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const row = document.createElement("div");
    row.className = "listItem";

    const left = document.createElement("div");
    left.style.minWidth = "0";
    left.innerHTML = `
      <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.title || "Untitled")}</div>
      <div class="muted" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.link || "")}</div>
      <div class="muted" style="font-size:13px;">${escapeHtml(d.summary || "")}</div>
    `;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexShrink = "0";

    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openBookInEditor(docSnap.id));

    const delBtn = document.createElement("button");
    delBtn.className = "btn small ghost";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this published book?")) return;
      await deleteDoc(doc(db, "books", docSnap.id));
      await writeAdminLog("book_delete", "book", docSnap.id, { title: d.title || "", status: d.status || "" });
      await refreshPublishedBooks();
      await refreshUpcomingBooks();
    });

    right.appendChild(editBtn);
    right.appendChild(delBtn);
    row.appendChild(left);
    row.appendChild(right);
    host.appendChild(row);
  });
}

async function loadPage(key) {
  initEditors();
  const out = $(`#pageMsg-${key}`);
  msg(out, "");

  const snap = await getDoc(doc(db, "site", key));
  const d = snap.exists() ? (snap.data() || {}) : {};
  if (pageEditors[key]) pageEditors[key].root.innerHTML = d.contentHtml || d.content || "";
}

async function savePage(key) {
  initEditors();
  const out = $(`#pageMsg-${key}`);
  const content = pageEditors[key] ? pageEditors[key].root.innerHTML : "";

  try {
    await setDoc(doc(db, "site", key), { content, contentHtml: content, updatedAt: serverTimestamp() }, { merge: true });
    await writeAdminLog("page_update", "site", key, { bytes: content.length });
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
  const host = pickEl("#linksList", "#affiliateList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading...</div>";

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
      pickEl("#linkTitle", "#affiliateTitle").value = d.title || "";
      pickEl("#linkUrl", "#affiliateUrl").value = d.url || "";
      pickEl("#linkCategory", "#affiliateCategory").value = d.category || "";
      pickEl("#linkDesc", "#affiliateDesc").value = d.description || d.desc || "";
      show($("#linkFormWrap"), true);
      show($("#cancelLinkBtn"), true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn small ghost";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this link?")) return;
      await deleteDoc(doc(db, "affiliateLinks", docSnap.id));
      await writeAdminLog("affiliate_delete", "affiliateLink", docSnap.id, { title: d.title || "" });
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

  const title = pickEl("#linkTitle", "#affiliateTitle")?.value?.trim() || "";
  const url = pickEl("#linkUrl", "#affiliateUrl")?.value?.trim() || "";
  const category = pickEl("#linkCategory", "#affiliateCategory")?.value?.trim() || "";
  const description = pickEl("#linkDesc", "#affiliateDesc")?.value?.trim() || "";

  if (!title || !url) {
    msg(out, "Title + URL required.", "bad");
    return;
  }

  const payload = { title, url, category, description, desc: description, updatedAt: serverTimestamp() };
  try {
    if (editingLinkId) {
      await updateDoc(doc(db, "affiliateLinks", editingLinkId), payload);
      await writeAdminLog("affiliate_update", "affiliateLink", editingLinkId, { title, category });
    } else {
      payload.createdAt = serverTimestamp();
      const refDoc = await addDoc(collection(db, "affiliateLinks"), payload);
      await writeAdminLog("affiliate_create", "affiliateLink", refDoc.id, { title, category });
    }

    msg(out, "Saved ✅", "ok");
    editingLinkId = null;
    pickEl("#linkTitle", "#affiliateTitle").value = "";
    pickEl("#linkUrl", "#affiliateUrl").value = "";
    pickEl("#linkCategory", "#affiliateCategory").value = "";
    pickEl("#linkDesc", "#affiliateDesc").value = "";
    show($("#linkFormWrap"), false);
    show($("#cancelLinkBtn"), false);
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
    await writeAdminLog("profile_photo_upload", "site", "profile", { bytes: file.size, name: file.name });

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

// ---- Logs / Reports ----
async function refreshLogs() {
  const host = $("#logsList");
  if (!host) return;

  host.innerHTML = "<div class='muted'>Loading...</div>";
  const snap = await getDocs(query(collection(db, "adminLogs"), orderBy("createdAt", "desc"), limit(200)));

  if (snap.empty) {
    host.innerHTML = "<div class='muted'>No logs yet.</div>";
    return;
  }

  host.innerHTML = "";
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const row = document.createElement("div");
    row.className = "listItem";
    row.innerHTML = `
      <div style="min-width:0;">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(d.action || "action")} · ${escapeHtml(d.entity || "")} ${escapeHtml(d.entityId || "")}
        </div>
        <div class="muted fine" style="margin-top:4px;">
          ${escapeHtml(d.actorEmail || "")} · ${escapeHtml(formatDate(d.createdAt) || "")}
        </div>
      </div>
    `;
    host.appendChild(row);
  });
}

function hostFromReferrer(ref) {
  try {
    if (!ref) return "";
    const u = new URL(ref);
    return u.hostname || "";
  } catch {
    return "";
  }
}

async function refreshReports() {
  const mount = $("#reportsMount");
  if (!mount) return;

  mount.innerHTML = "<div class='card'><p class='muted'>Loading...</p></div>";

  const sinceMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const since = Timestamp.fromMillis(sinceMs);

  const q = query(
    collection(db, "analyticsEvents"),
    where("createdAt", ">=", since),
    orderBy("createdAt", "desc"),
    limit(5000)
  );

  const snap = await getDocs(q);
  const events = snap.docs.map((d) => d.data() || {});

  // Newsletter subscriber counts
  let subsTotal = 0;
  let subsActive = 0;
  let subsUnsub = 0;
  try {
    subsTotal = (await getCountFromServer(collection(db, "subscribers"))).data().count || 0;
    subsActive = (await getCountFromServer(query(collection(db, "subscribers"), where("status", "==", "active")))).data().count || 0;
    subsUnsub = (await getCountFromServer(query(collection(db, "subscribers"), where("status", "==", "unsubscribed")))).data().count || 0;
  } catch (e) {
    console.warn("subscriber counts failed:", e);
  }

  if (!events.length) {
    mount.innerHTML = "<div class='card'><p class='muted'>No analytics events yet.</p></div>";
    return;
  }

  const pageViews = events.filter((e) => e.type === "page_view");
  const uniqueClients = new Set(pageViews.map((e) => (e.clientId || "").toString()).filter(Boolean));

  const byPath = new Map();
  for (const e of pageViews) {
    const p = (e.path || "").toString();
    byPath.set(p, (byPath.get(p) || 0) + 1);
  }

  const byRef = new Map();
  for (const e of pageViews) {
    const h = hostFromReferrer((e.referrer || "").toString());
    if (!h) continue;
    byRef.set(h, (byRef.get(h) || 0) + 1);
  }

  const topPages = [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topRefs = [...byRef.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const postViews = events.filter((e) => e.type === "post_view_ok");
  const byPost = new Map();
  for (const e of postViews) {
    const id = (e.postId || "").toString();
    if (!id) continue;
    byPost.set(id, (byPost.get(id) || 0) + 1);
  }
  const topPosts = [...byPost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const bookLikes = events.filter((e) => e.type === "book_like");
  const bookComments = events.filter((e) => e.type === "book_comment");

  mount.innerHTML = `
    <div class="cards2">
      <div class="card">
        <div style="font-weight:800;">Visits</div>
        <div class="muted fine" style="margin-top:6px;">Page views: <strong>${pageViews.length}</strong></div>
        <div class="muted fine">Unique browsers: <strong>${uniqueClients.size}</strong></div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Engagement</div>
        <div class="muted fine" style="margin-top:6px;">Book likes: <strong>${bookLikes.length}</strong></div>
        <div class="muted fine">Book comments: <strong>${bookComments.length}</strong></div>
        <div class="muted fine">Blog post reads: <strong>${postViews.length}</strong></div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Newsletter</div>
        <div class="muted fine" style="margin-top:6px;">Active: <strong>${subsActive}</strong></div>
        <div class="muted fine">Unsubscribed: <strong>${subsUnsub}</strong></div>
        <div class="muted fine">Total: <strong>${subsTotal}</strong></div>
      </div>
    </div>

    <div class="cards2" style="margin-top:14px;">
      <div class="card">
        <div style="font-weight:800; margin-bottom:10px;">Top Pages</div>
        <div class="list">
          ${topPages.map(([p, c]) => `
            <div class="listItem" style="padding:10px 12px;">
              <div style="min-width:0; display:flex; justify-content:space-between; gap:10px; width:100%;">
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p || "(unknown)")}</div>
                <div style="font-weight:800;">${c}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="card">
        <div style="font-weight:800; margin-bottom:10px;">Top Referrers</div>
        <div class="list">
          ${topRefs.map(([h, c]) => `
            <div class="listItem" style="padding:10px 12px;">
              <div style="min-width:0; display:flex; justify-content:space-between; gap:10px; width:100%;">
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(h)}</div>
                <div style="font-weight:800;">${c}</div>
              </div>
            </div>
          `).join("") || `<div class="muted fine">No referrers recorded (direct traffic).</div>`}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px;">
      <div style="font-weight:800; margin-bottom:10px;">Top Blog Posts (by reads)</div>
      <div class="list">
        ${topPosts.map(([id, c]) => `
          <div class="listItem" style="padding:10px 12px;">
            <div style="min-width:0; display:flex; justify-content:space-between; gap:10px; width:100%;">
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(id)}</div>
              <div style="font-weight:800;">${c}</div>
            </div>
          </div>
        `).join("") || `<div class="muted fine">No post reads yet.</div>`}
      </div>
    </div>
  `;
}

// ---- Boot ----
function wireUI() {
  setTheme(getTheme());

  pickEl("#themeToggle", "#themeBtn")?.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  });

  $("#loginForm")?.addEventListener("submit", onLogin);
  $("#googleLoginBtn")?.addEventListener("click", onGoogleLogin);
  $("#logoutBtn")?.addEventListener("click", onLogout);

  // Show/hide password toggle
  const pw = $("#password");
  const toggle = $("#pwToggle");
  if (pw && toggle) {
    const sync = () => {
      const showing = pw.type === "text";
      toggle.textContent = showing ? "Hide" : "Show";
      toggle.title = showing ? "Hide password" : "Show password";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-pressed", showing ? "true" : "false");
    };
    sync();
    toggle.addEventListener("click", () => {
      pw.type = (pw.type === "password") ? "text" : "password";
      sync();
      pw.focus();
    });
  }

  // tabs
  $$(".tabBtn").forEach(btn => btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    activateTab(tab);
    if (tab === "posts") refreshPosts().catch(console.error);
    if (tab === "upcoming") refreshUpcomingBooks().catch(console.error);
    if (tab === "publishedBooks") refreshPublishedBooks().catch(console.error);
    if (PAGE_KEYS.includes(tab)) loadPage(tab).catch(console.error);
    if (tab === "affiliate") refreshLinks().catch(console.error);
    if (tab === "profile") loadProfile().catch(console.error);
    if (tab === "logs") refreshLogs().catch(console.error);
    if (tab === "reports") refreshReports().catch(console.error);
  }));

  // posts
  pickEl("#newPostBtn", "#newPost")?.addEventListener("click", () => {
    initEditors();
    openPostForm(true);
    clearPostForm();
  });
  pickEl("#savePostBtn", "#savePost")?.addEventListener("click", savePost);
  pickEl("#cancelPostBtn")?.addEventListener("click", () => openPostForm(false));

  // upcoming books
  $("#newUpcomingBtn")?.addEventListener("click", () => {
    clearUpcomingForm();
    openUpcomingForm(true);
  });
  $("#saveUpcomingBtn")?.addEventListener("click", saveUpcomingBook);
  $("#cancelUpcomingBtn")?.addEventListener("click", () => {
    openUpcomingForm(false);
    clearUpcomingForm();
  });

  // static pages
  $("#saveActivitiesBtn")?.addEventListener("click", () => savePage("activities"));
  $("#saveNewsletterBtn")?.addEventListener("click", () => savePage("newsletter"));

  // affiliate
  pickEl("#newLinkBtn")?.addEventListener("click", () => {
    editingLinkId = null;
    pickEl("#linkTitle", "#affiliateTitle").value = "";
    pickEl("#linkUrl", "#affiliateUrl").value = "";
    pickEl("#linkCategory", "#affiliateCategory").value = "";
    pickEl("#linkDesc", "#affiliateDesc").value = "";
    show($("#linkFormWrap"), true);
    show($("#cancelLinkBtn"), true);
  });
  pickEl("#saveLinkBtn", "#saveAffiliate")?.addEventListener("click", saveLink);
  pickEl("#cancelLinkBtn")?.addEventListener("click", () => {
    show($("#linkFormWrap"), false);
    show($("#cancelLinkBtn"), false);
  });

  // profile
  pickEl("#uploadProfileBtn", "#uploadProfile")?.addEventListener("click", uploadProfile);

  // logs/reports
  $("#refreshLogsBtn")?.addEventListener("click", () => refreshLogs().catch(console.error));
  $("#refreshReportsBtn")?.addEventListener("click", () => refreshReports().catch(console.error));
}

document.addEventListener("DOMContentLoaded", () => {
  initEditors();
  wireUI();

  const authBox = $("#authBox");
  const adminBox = $("#adminBox");
  const logoutBtn = $("#logoutBtn");
  const loginForm = $("#loginForm");
  const loginMsg = $("#loginMsg");
  const authMsg = $("#authMsg");

  // Complete redirect sign-in flows (mobile-friendly).
  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, async (user) => {
    // Sign out button should be visible whenever a user is signed in.
    show(logoutBtn, !!user);

    if (!user) {
      show(authBox, true);
      show(adminBox, false);
      if (loginForm) loginForm.style.display = "";
      msg(loginMsg, "");
      msg(authMsg, "");
      return;
    }

    // Require admin allowlist membership.
    const ok = await isAdminUser(user.uid);
    if (!ok) {
      show(authBox, true);
      show(adminBox, false);
      if (loginForm) loginForm.style.display = "none";
      msg(loginMsg, "");
      msg(authMsg, `Not authorized for admin. Your UID is: ${user.uid}`, "bad");
      return;
    }

    msg(authMsg, "");
    show(authBox, false);
    show(adminBox, true);

    if (user) {
      activateTab("posts");
      try {
        await reconcilePostData();
        await migrateLegacyUpcomingBooks();
      } catch (err) {
        console.error("Post reconciliation failed:", err);
      }
      refreshPosts().catch(console.error);
      loadProfile().catch(console.error);
    }
  });
});
