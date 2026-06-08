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
const ICON_SUN = "\u2600\uFE0F";  // â˜€ï¸
const ICON_MOON = "\uD83C\uDF19"; // ðŸŒ™
const ADMIN_LEAD_SEQUENCE_ENDPOINTS = [
  "/api/adminLeadMagnetSequence",
  "https://us-central1-bloom-in-five.cloudfunctions.net/adminLeadMagnetSequence",
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const PAGE_KEYS = ["activities", "newsletter"];
const LEAD_MAGNET_CONFIG_REF = ["site", "leadMagnetSequenceConfig"];
const LEAD_EMAIL_DEFAULTS = {
  1: {
    subject: "Floreciendo en la Espera by Bloom.inFive - Journal Gratis",
    preheader: "Journal gratis de Bloom.inFive",
    buttonLabel: "Descargar mi journal",
    buttonUrl: "{downloadUrl}",
    bodyText: `Hola {firstName},

Que alegria tenerte aqui! Gracias por unirte a este espacio donde hablamos de fe, motivacion y como vivir cada dia con proposito, incluso en medio del caos de la vida diaria.

Mi nombre es Angelika, y quiero compartir contigo todo lo que he aprendido caminando con Dios y tratando de equilibrar la maternidad, la familia y mis suenos.

Pronto recibiras inspiracion, tips practicos, reflexiones y algunas sorpresas que tengo preparadas para ti, pero hoy quiero empezar con algo simple.

Un pequeno recordatorio: No tienes que ser perfecta para crecer, para seguir, para florecer. Cada dia cuenta, y este es tu espacio seguro para hacerlo a tu ritmo.

Descarga tu journal gratis aqui:
{downloadUrl}

Me encantaria que me respondieras a este email o en Instagram contandome un poquito de ti: que te trajo aqui y que esperas encontrar en este espacio?

Gracias por estar aqui. Estoy emocionada de acompanarte en este camino.

Con carino,
Angelika`,
  },
  2: {
    subject: "Un pedacito de mi historia",
    preheader: "Por que existe Bloom.inFive",
    buttonLabel: "",
    buttonUrl: "",
    bodyText: `Hola {firstName},

Queria contarte rapidamente que es Bloom in Five y por que existe.

Este espacio nacio cuando Dios toco mi corazon y me quito el miedo de mostrar la vida tal como es: real, imperfecta, pero llena de proposito.

Somos una familia militar de cinco y entre mudanzas, temporadas dificiles y muchas transiciones, hemos aprendido que aun en lo incierto Dios sigue siendo fiel.

Bloom significa florecer donde Dios nos planta, incluso cuando no entendemos el proceso.

Por eso aqui comparto nuestra vida sin filtros, con amor y con la intencion de que otras personas puedan sentirse acompanadas, vistas y menos solas en su propio proceso.

Gracias por estar aqui.

Angelika`,
  },
  3: {
    subject: "Para la mama que se siente cansada hoy",
    preheader: "Un recordatorio corto para hoy",
    buttonLabel: "",
    buttonUrl: "",
    bodyText: `Hola {firstName},

Si hoy te sientes cansada, quiero recordarte algo sencillo: Dios no te esta pidiendo perfeccion. El te esta invitando a venir a El tal como estas.

A veces la maternidad se siente como una lista que nunca termina. Pero tu valor no esta en todo lo que logras hacer en un dia. Tu valor ya esta seguro en Dios.

Hoy intenta hacer una cosa pequena con amor: respirar profundo, orar en voz bajita, tomar agua, abrazar a tus hijos, o descansar sin culpa cinco minutos.

No estas atrasada. Estas caminando. Y aun en este dia, Dios esta contigo.

Con carino,
Angelika`,
  },
  4: {
    subject: "Cosas sencillas que me ayudan como mama",
    preheader: "Favoritos sencillos para la rutina",
    buttonLabel: "",
    buttonUrl: "",
    bodyText: `Hola {firstName},

Hoy queria compartirte algunas cosas sencillas que me ayudan como mama. No son cosas magicas, pero si pequenos apoyos que hacen la rutina un poquito mas ligera.

Favoritos para mama:
{momFavoritesUrl}

Favoritos de fe:
{faithFavoritesUrl}

Rutina y hogar:
{homeRoutineUrl}

Solo toma lo que te sirva en esta temporada. A veces lo pequeno tambien es una forma de cuidarnos.

Con carino,
Angelika`,
  },
  5: {
    subject: "Estoy creando algo especial para mamas",
    preheader: "Una invitacion suave para mamas",
    buttonLabel: "Ver acceso temprano",
    buttonUrl: "{momlyUrl}",
    bodyText: `Hola {firstName},

Estoy creando algo especial para mamas: Momly.

La idea nacio de una necesidad muy real: tener un espacio que ayude a organizar la vida familiar sin perder de vista lo que mas importa.

Todavia esta creciendo, pero si te gustaria enterarte primero y ser parte del acceso temprano, puedes anotarte aqui:
{momlyUrl}

Gracias por caminar conmigo estos dias. Oro que este espacio siga siendo de animo, fe y compania para ti.

Con carino,
Angelika`,
  },
};

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

    msg(out, "Saved âœ…", "ok");
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
    meta.textContent = `${(d.status || "draft")} â€¢ ${formatDate(d.publishAt)}`;

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
    msg(out, "Saved âœ…", "ok");
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
    msg(out, "Saved âœ…", "ok");
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

    msg(out, "Saved âœ…", "ok");
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

    msg(out, "Uploaded âœ…", "ok");
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

  const logs = snap.docs.map((docSnap) => docSnap.data() || {});
  const postTitleMap = await getPostTitleMap(
    logs
      .filter((d) => (d.entity || "").toString() === "post")
      .map((d) => (d.entityId || "").toString())
  );

  host.innerHTML = "";
  logs.forEach((d) => {
    let entityLabel = (d.entityId || "").toString();
    if ((d.entity || "").toString() === "post" && entityLabel) {
      entityLabel = postTitleMap.get(entityLabel) || entityLabel;
    }
    const row = document.createElement("div");
    row.className = "listItem";
    row.innerHTML = `
      <div style="min-width:0;">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(d.action || "action")} - ${escapeHtml(d.entity || "")} ${escapeHtml(entityLabel)}
        </div>
        <div class="muted fine" style="margin-top:4px;">
          ${escapeHtml(d.actorEmail || "")} - ${escapeHtml(formatDate(d.createdAt) || "")}
        </div>
      </div>
    `;
    host.appendChild(row);
  });
}

async function refreshLeadMagnets() {
  const host = $("#leadMagnetsList");
  if (!host) return;

  await loadLeadMagnetSequenceConfig();
  host.innerHTML = "<div class='muted'>Loading...</div>";

  const snap = await getDocs(
    query(
      collection(db, "leadMagnetSubscribers"),
      orderBy("subscribedAt", "desc"),
      limit(100)
    )
  );

  if (snap.empty) {
    host.innerHTML = "<div class='muted'>No lead magnet subscribers yet.</div>";
    return;
  }

  host.innerHTML = "";
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const fullName = `${d.firstName || ""} ${d.lastName || ""}`.trim() || "(no name)";
    const sequenceStatus = d.sequenceStatus || "not started";
    const nextEmail = d.nextSequenceEmailNumber ? `Email ${d.nextSequenceEmailNumber}` : "-";
    const emailId = d.normalizedEmail || d.email || docSnap.id;
    const row = document.createElement("div");
    row.className = "listItem";
    row.dataset.email = emailId;
    row.innerHTML = `
      <div style="min-width:0;">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(fullName)}
        </div>
        <div class="muted fine" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(d.email || d.normalizedEmail || docSnap.id)}
        </div>
        <div class="muted fine" style="margin-top:4px;">
          ${escapeHtml(d.source || "")} - ${escapeHtml(d.status || "")}
        </div>
        <div class="muted fine" style="margin-top:4px;">
          Sequence: <strong>${escapeHtml(sequenceStatus)}</strong>${d.sequenceHasFailure ? " - failed send" : ""}
        </div>
      </div>
      <div class="muted fine" style="min-width:230px;text-align:right;">
        <div>Subscribed: ${escapeHtml(formatDate(d.subscribedAt) || "")}</div>
        <div>Email 1 sent: ${escapeHtml(formatDate(d.emailSentAt) || "Not yet")}</div>
        <div>Last sequence: ${escapeHtml(formatDate(d.lastSequenceEmailSentAt) || "Not yet")}</div>
        <div>Next: ${escapeHtml(nextEmail)} ${escapeHtml(formatDate(d.nextSequenceEmailDueAt) || "")}</div>
        <div class="leadSequenceActions">
          <select data-lead-action-select="restart" aria-label="Restart sequence step for ${escapeHtml(fullName)}">
            ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">Restart from ${n}</option>`).join("")}
          </select>
          <button class="btn ghost" type="button" data-lead-action="restart">Restart</button>
          <select data-lead-action-select="resend" aria-label="Resend sequence step for ${escapeHtml(fullName)}">
            ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">Step ${n}</option>`).join("")}
          </select>
          <button class="btn ghost" type="button" data-lead-action="resend">Resend</button>
          <div class="muted fine leadSequenceMsg" data-lead-action-msg></div>
        </div>
      </div>
    `;
    row.querySelectorAll("[data-lead-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleLeadSequenceAction(row, btn).catch(console.error));
    });
    host.appendChild(row);
  });
}

async function handleLeadSequenceAction(row, btn) {
  const email = row?.dataset?.email || "";
  const action = btn?.dataset?.leadAction || "";
  const select = row.querySelector(`[data-lead-action-select="${action}"]`);
  const msgEl = row.querySelector("[data-lead-action-msg]");
  const emailNumber = Number(select?.value || 0);
  if (!email || !action || emailNumber < 1 || emailNumber > 5) return;

  const label = action === "restart" ? `Restart from Email ${emailNumber}` : `Resend Email ${emailNumber}`;
  const confirmed = window.confirm(`${label} for ${email}?`);
  if (!confirmed) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = action === "restart" ? "Restarting..." : "Sending...";
  msg(msgEl, "");

  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("You must be signed in as an admin.");

    const data = await postLeadSequenceAction({ action, email, emailNumber, token });

    msg(msgEl, data.message || "Done.", "ok");
    await refreshLeadMagnets();
  } catch (err) {
    console.error(err);
    msg(msgEl, err?.message || "Could not complete action.", "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function postLeadSequenceAction(payload) {
  const body = JSON.stringify({
    action: payload.action,
    email: payload.email,
    emailNumber: payload.emailNumber,
  });
  let lastError = null;

  for (let i = 0; i < ADMIN_LEAD_SEQUENCE_ENDPOINTS.length; i += 1) {
    const url = ADMIN_LEAD_SEQUENCE_ENDPOINTS[i];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${payload.token}`,
        },
        body,
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw ? raw.slice(0, 240) : "" };
      }

      if (res.ok && data.ok !== false) return data;

      const message = data.message || `Sequence action failed (${res.status}).`;
      lastError = new Error(message);
      if (![404, 405].includes(res.status) || i === ADMIN_LEAD_SEQUENCE_ENDPOINTS.length - 1) {
        throw lastError;
      }
    } catch (err) {
      lastError = err;
      if (i === ADMIN_LEAD_SEQUENCE_ENDPOINTS.length - 1) throw err;
    }
  }

  throw lastError || new Error("Sequence action failed.");
}

async function loadLeadMagnetSequenceConfig() {
  const btn = $("#toggleLeadMagnetTestModeBtn");
  const status = $("#leadMagnetTestModeStatus");
  if (!btn && !status) return;

  try {
    const snap = await getDoc(doc(db, ...LEAD_MAGNET_CONFIG_REF));
    const data = snap.exists() ? (snap.data() || {}) : {};
    const enabled = data.testEmailSequenceMode === true;
    if (btn) {
      btn.dataset.enabled = enabled ? "true" : "false";
      btn.textContent = enabled ? "Turn Test Mode Off" : "Turn Test Mode On";
    }
    if (status) {
      status.textContent = enabled
        ? "Test mode ON: sequence emails use minutes."
        : "Test mode OFF: sequence emails use production days.";
      status.style.color = enabled ? "#b07a00" : "";
    }
  } catch (err) {
    console.error(err);
    if (btn) btn.textContent = "Test mode unavailable";
    if (status) status.textContent = err?.message || "Could not load test mode.";
  }
}

async function toggleLeadMagnetTestMode() {
  const btn = $("#toggleLeadMagnetTestModeBtn");
  const status = $("#leadMagnetTestModeStatus");
  if (!btn) return;

  const nextEnabled = btn.dataset.enabled !== "true";
  btn.disabled = true;
  btn.textContent = nextEnabled ? "Turning on..." : "Turning off...";
  if (status) status.textContent = "";

  try {
    await setDoc(doc(db, ...LEAD_MAGNET_CONFIG_REF), {
      testEmailSequenceMode: nextEnabled,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await writeAdminLog("lead_sequence_test_mode", "site", "leadMagnetSequenceConfig", { enabled: nextEnabled });
    await loadLeadMagnetSequenceConfig();
  } catch (err) {
    console.error(err);
    if (status) {
      status.textContent = err?.message || "Could not update test mode.";
      status.style.color = "#ffb3b3";
    }
  } finally {
    btn.disabled = false;
  }
}

function leadEmailTemplate(number, saved = {}) {
  return {
    ...LEAD_EMAIL_DEFAULTS[number],
    ...(saved || {}),
  };
}

function ensureLeadEmailSettingsCards() {
  const wrap = $("#leadEmailSettingsWrap");
  if (!wrap || wrap.dataset.ready === "true") return;

  wrap.innerHTML = "";
  for (let number = 1; number <= 5; number += 1) {
    const card = document.createElement("div");
    card.className = "emailSettingsCard";
    card.dataset.emailNumber = String(number);
    card.innerHTML = `
      <h3>Email ${number}</h3>
      <div class="settingsGrid">
        <div class="settingsField wide">
          <label for="leadEmail${number}Subject">Subject</label>
          <input id="leadEmail${number}Subject" data-email-field="subject" data-email-number="${number}" />
        </div>
        <div class="settingsField wide">
          <label for="leadEmail${number}Preheader">Preheader</label>
          <input id="leadEmail${number}Preheader" data-email-field="preheader" data-email-number="${number}" />
        </div>
        <div class="settingsField">
          <label for="leadEmail${number}ButtonLabel">Button label</label>
          <input id="leadEmail${number}ButtonLabel" data-email-field="buttonLabel" data-email-number="${number}" placeholder="Optional" />
        </div>
        <div class="settingsField">
          <label for="leadEmail${number}ButtonUrl">Button URL or token</label>
          <input id="leadEmail${number}ButtonUrl" data-email-field="buttonUrl" data-email-number="${number}" placeholder="{downloadUrl}, {momlyUrl}, or https://..." />
        </div>
        <div class="settingsField wide">
          <label for="leadEmail${number}Body">Body text</label>
          <textarea id="leadEmail${number}Body" data-email-field="bodyText" data-email-number="${number}"></textarea>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  }
  wrap.dataset.ready = "true";
}

function setLeadSettingsForm(data = {}) {
  const links = data.links || {};
  $("#leadSettingPdfUrl").value = data.pdfDownloadUrl || "";
  $("#leadSettingMomFavoritesUrl").value = links.momFavoritesUrl || "";
  $("#leadSettingFaithFavoritesUrl").value = links.faithFavoritesUrl || "";
  $("#leadSettingHomeRoutineUrl").value = links.homeRoutineUrl || "";
  $("#leadSettingMomlyUrl").value = links.momlyUrl || "";

  const savedEmails = data.emails || {};
  for (let number = 1; number <= 5; number += 1) {
    const template = leadEmailTemplate(number, savedEmails[number] || savedEmails[String(number)]);
    $$(`[data-email-number="${number}"]`).forEach((el) => {
      const field = el.dataset.emailField;
      el.value = template[field] || "";
    });
  }
}

function readLeadSettingsForm() {
  const emails = {};
  for (let number = 1; number <= 5; number += 1) {
    emails[number] = {};
    $$(`[data-email-number="${number}"]`).forEach((el) => {
      const field = el.dataset.emailField;
      emails[number][field] = (el.value || "").trim();
    });
  }

  return {
    pdfDownloadUrl: ($("#leadSettingPdfUrl")?.value || "").trim(),
    links: {
      momFavoritesUrl: ($("#leadSettingMomFavoritesUrl")?.value || "").trim(),
      faithFavoritesUrl: ($("#leadSettingFaithFavoritesUrl")?.value || "").trim(),
      homeRoutineUrl: ($("#leadSettingHomeRoutineUrl")?.value || "").trim(),
      momlyUrl: ($("#leadSettingMomlyUrl")?.value || "").trim(),
    },
    emails,
  };
}

function isUrlOrToken(value) {
  if (!value) return true;
  if (/^\{[a-zA-Z]+Url\}$/.test(value)) return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function validateLeadSettings(settings) {
  if (settings.pdfDownloadUrl && !isUrlOrToken(settings.pdfDownloadUrl)) {
    return "PDF download URL must be a valid URL.";
  }
  for (const [key, value] of Object.entries(settings.links)) {
    if (value && !isUrlOrToken(value)) return `${key} must be a valid URL.`;
  }
  for (let number = 1; number <= 5; number += 1) {
    const email = settings.emails[number];
    if (!email.subject) return `Email ${number} needs a subject.`;
    if (!email.bodyText) return `Email ${number} needs body text.`;
    if (email.buttonUrl && !isUrlOrToken(email.buttonUrl)) return `Email ${number} button URL must be a valid URL or token.`;
  }
  return "";
}

async function openLeadMagnetSettings() {
  const modal = $("#leadMagnetSettingsModal");
  const msgEl = $("#leadMagnetSettingsMsg");
  if (!modal) return;
  ensureLeadEmailSettingsCards();
  msg(msgEl, "Loading...");
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");

  try {
    const snap = await getDoc(doc(db, ...LEAD_MAGNET_CONFIG_REF));
    setLeadSettingsForm(snap.exists() ? (snap.data() || {}) : {});
    msg(msgEl, "");
  } catch (err) {
    console.error(err);
    setLeadSettingsForm({});
    msg(msgEl, err?.message || "Could not load settings.", "bad");
  }
}

function closeLeadMagnetSettings() {
  const modal = $("#leadMagnetSettingsModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

async function saveLeadMagnetSettings() {
  const saveBtn = $("#saveLeadMagnetSettingsBtn");
  const msgEl = $("#leadMagnetSettingsMsg");
  const settings = readLeadSettingsForm();
  const validation = validateLeadSettings(settings);
  if (validation) {
    msg(msgEl, validation, "bad");
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }
  msg(msgEl, "");

  try {
    await setDoc(doc(db, ...LEAD_MAGNET_CONFIG_REF), {
      ...settings,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await writeAdminLog("lead_magnet_settings_update", "site", "leadMagnetSequenceConfig", {
      emails: Object.keys(settings.emails).length,
      hasPdfUrl: Boolean(settings.pdfDownloadUrl),
    });
    await loadLeadMagnetSequenceConfig();
    msg(msgEl, "Saved.", "ok");
  } catch (err) {
    console.error(err);
    msg(msgEl, err?.message || "Could not save settings.", "bad");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Settings";
    }
  }
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

async function getPostTitleMap(postIds) {
  const map = new Map();
  const ids = [...new Set((postIds || []).map((x) => (x || "").toString()).filter(Boolean))];
  if (!ids.length) return map;

  await Promise.all(ids.map(async (id) => {
    try {
      const snap = await getDoc(doc(db, "posts", id));
      if (!snap.exists()) return;
      const d = snap.data() || {};
      const title = (d.title || "").toString().trim();
      if (title) map.set(id, title);
    } catch {
      // Leave ID fallback in UI.
    }
  }));

  return map;
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
  let leadTotal = 0;
  let leadActive = 0;
  let leadEmailed = 0;
  let leadSeqActive = 0;
  let leadSeqCompleted = 0;
  let leadSeqUnsub = 0;
  let leadSeqFailed = 0;
  try {
    subsTotal = (await getCountFromServer(collection(db, "subscribers"))).data().count || 0;
    subsActive = (await getCountFromServer(query(collection(db, "subscribers"), where("status", "==", "active")))).data().count || 0;
    subsUnsub = (await getCountFromServer(query(collection(db, "subscribers"), where("status", "==", "unsubscribed")))).data().count || 0;
    leadTotal = (await getCountFromServer(collection(db, "leadMagnetSubscribers"))).data().count || 0;
    leadActive = (await getCountFromServer(query(collection(db, "leadMagnetSubscribers"), where("status", "==", "active")))).data().count || 0;
    leadEmailed = (await getCountFromServer(query(collection(db, "leadMagnetSubscribers"), where("emailSentAt", ">", Timestamp.fromMillis(0))))).data().count || 0;
    leadSeqActive = (await getCountFromServer(query(collection(db, "leadMagnetSubscribers"), where("sequenceStatus", "==", "active")))).data().count || 0;
    leadSeqCompleted = (await getCountFromServer(query(collection(db, "leadMagnetSubscribers"), where("sequenceStatus", "==", "completed")))).data().count || 0;
    leadSeqUnsub = (await getCountFromServer(query(collection(db, "leadMagnetSubscribers"), where("sequenceStatus", "==", "unsubscribed")))).data().count || 0;
    leadSeqFailed = (await getCountFromServer(query(collection(db, "leadMagnetSubscribers"), where("sequenceHasFailure", "==", true)))).data().count || 0;
  } catch (e) {
    console.warn("subscriber counts failed:", e);
  }

  if (!events.length) {
    mount.innerHTML = `
      <div class="cards2">
        <div class="card"><p class="muted">No analytics events yet.</p></div>
        <div class="card">
          <div style="font-weight:800;">Lead Magnets</div>
          <div class="muted fine" style="margin-top:6px;">Active: <strong>${leadActive}</strong></div>
          <div class="muted fine">Emailed: <strong>${leadEmailed}</strong></div>
          <div class="muted fine">Sequence active: <strong>${leadSeqActive}</strong></div>
          <div class="muted fine">Completed: <strong>${leadSeqCompleted}</strong></div>
          <div class="muted fine">Unsubscribed: <strong>${leadSeqUnsub}</strong></div>
          <div class="muted fine">Failed sends: <strong>${leadSeqFailed}</strong></div>
          <div class="muted fine">Total: <strong>${leadTotal}</strong></div>
        </div>
      </div>
    `;
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
  const postTitleMap = await getPostTitleMap(topPosts.map(([id]) => id));

  const bookLikes = events.filter((e) => e.type === "book_like");
  const bookComments = events.filter((e) => e.type === "book_comment");
  const postLikes = events.filter((e) => e.type === "post_like");
  const postComments = events.filter((e) => e.type === "post_comment");

  mount.innerHTML = `
    <div class="cards2">
      <div class="card">
        <div style="font-weight:800;">Visits</div>
        <div class="muted fine" style="margin-top:6px;">Page views: <strong>${pageViews.length}</strong></div>
        <div class="muted fine">Unique browsers: <strong>${uniqueClients.size}</strong></div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Engagement</div>
        <div class="muted fine" style="margin-top:6px;">Book reactions: <strong>${bookLikes.length}</strong></div>
        <div class="muted fine">Book comments: <strong>${bookComments.length}</strong></div>
        <div class="muted fine">Post reactions: <strong>${postLikes.length}</strong></div>
        <div class="muted fine">Post comments: <strong>${postComments.length}</strong></div>
        <div class="muted fine">Blog post reads: <strong>${postViews.length}</strong></div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Newsletter</div>
        <div class="muted fine" style="margin-top:6px;">Active: <strong>${subsActive}</strong></div>
        <div class="muted fine">Unsubscribed: <strong>${subsUnsub}</strong></div>
        <div class="muted fine">Total: <strong>${subsTotal}</strong></div>
      </div>
      <div class="card">
        <div style="font-weight:800;">Lead Magnets</div>
        <div class="muted fine" style="margin-top:6px;">Active: <strong>${leadActive}</strong></div>
        <div class="muted fine">Emailed: <strong>${leadEmailed}</strong></div>
        <div class="muted fine">Sequence active: <strong>${leadSeqActive}</strong></div>
        <div class="muted fine">Completed: <strong>${leadSeqCompleted}</strong></div>
        <div class="muted fine">Unsubscribed: <strong>${leadSeqUnsub}</strong></div>
        <div class="muted fine">Failed sends: <strong>${leadSeqFailed}</strong></div>
        <div class="muted fine">Total: <strong>${leadTotal}</strong></div>
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
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(postTitleMap.get(id) || id)}</div>
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
    if (tab === "leadMagnets") refreshLeadMagnets().catch(console.error);
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
  $("#refreshLeadMagnetsBtn")?.addEventListener("click", () => refreshLeadMagnets().catch(console.error));
  $("#openLeadMagnetSettingsBtn")?.addEventListener("click", () => openLeadMagnetSettings().catch(console.error));
  $("#closeLeadMagnetSettingsBtn")?.addEventListener("click", closeLeadMagnetSettings);
  $("#cancelLeadMagnetSettingsBtn")?.addEventListener("click", closeLeadMagnetSettings);
  $("#saveLeadMagnetSettingsBtn")?.addEventListener("click", () => saveLeadMagnetSettings().catch(console.error));
  $("#leadMagnetSettingsModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "leadMagnetSettingsModal") closeLeadMagnetSettings();
  });
  $("#toggleLeadMagnetTestModeBtn")?.addEventListener("click", () => toggleLeadMagnetTestMode().catch(console.error));
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

