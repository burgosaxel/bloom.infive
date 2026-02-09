// admin/admin.js (ES module)
// Admin portal: login + manage posts/pages/affiliate/profile
// Requires firebase.js to be configured correctly.

import {
  auth,
  db,
  storage,

  // Auth
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,

  // Firestore
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,

  // Storage (NOTE: ref, not storageRef)
  ref,
  uploadBytes,
  getDownloadURL
} from "../firebase.js";

/* =========================
   THEME
========================= */
const THEME_KEY = "bloomTheme";

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById("themeBtn");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}

function getTheme() {
  return localStorage.getItem(THEME_KEY) || "dark";
}

/* =========================
   HELPERS
========================= */
const $ = (id) => document.getElementById(id);

function show(el, yes) {
  if (el) el.style.display = yes ? "" : "none";
}

function msg(el, text, type = "") {
  if (!el) return;
  el.textContent = text || "";
  el.style.color =
    type === "bad" ? "#ffb3b3" :
    type === "ok" ? "#b7ffcf" : "";
}

function toTimestampFromLocal(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d)) return null;
  return Timestamp.fromDate(d);
}

/* =========================
   AUTH
========================= */
async function onLogin(e) {
  e.preventDefault();

  const email = $("emailInput")?.value.trim();
  const pass = $("passInput")?.value;
  const out = $("loginMsg");

  if (!email || !pass) {
    msg(out, "Enter email + password.", "bad");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    msg(out, "Signed in.", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err.message, "bad");
  }
}

async function onLogout() {
  await signOut(auth);
}

/* =========================
   POSTS
========================= */
let editingPostId = null;

async function savePost() {
  const out = $("postMsg");

  const title = $("postTitle").value.trim();
  const status = $("postStatus").value;
  const publishAt = toTimestampFromLocal($("postPublishAt").value);

  if (!title) {
    msg(out, "Title required.", "bad");
    return;
  }

  const payload = {
    title,
    status,
    publishAt: publishAt || Timestamp.fromDate(new Date()),
    published:
      status === "published" ||
      (status === "scheduled" && publishAt && publishAt.toDate() <= new Date()),
    updatedAt: serverTimestamp()
  };

  try {
    if (editingPostId) {
      await updateDoc(doc(db, "posts", editingPostId), payload);
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "posts"), payload);
    }

    msg(out, "Saved ✅", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err.message, "bad");
  }
}

/* =========================
   PROFILE IMAGE UPLOAD
========================= */
async function uploadProfile() {
  const out = $("profileMsg");
  const file = $("profileFile")?.files?.[0];

  if (!file) {
    msg(out, "Choose an image first.", "bad");
    return;
  }

  try {
    const fileRef = ref(storage, `assets/profile-${Date.now()}-${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);

    await setDoc(
      doc(db, "site", "profile"),
      { photoUrl: url, updatedAt: serverTimestamp() },
      { merge: true }
    );

    $("profilePreview").src = url;
    msg(out, "Uploaded ✅", "ok");
  } catch (err) {
    console.error(err);
    msg(out, err.message, "bad");
  }
}

/* =========================
   BOOT
========================= */
document.addEventListener("DOMContentLoaded", () => {
  setTheme(getTheme());

  $("themeBtn")?.addEventListener("click", () =>
    setTheme(getTheme() === "dark" ? "light" : "dark")
  );

  $("loginForm")?.addEventListener("submit", onLogin);
  $("logoutBtn")?.addEventListener("click", onLogout);
  $("savePostBtn")?.addEventListener("click", savePost);
  $("uploadProfileBtn")?.addEventListener("click", uploadProfile);

  onAuthStateChanged(auth, (user) => {
    show($("authWrap"), !user);
    show($("adminWrap"), !!user);
  });
});
