import { auth, db, storage } from "../firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
  getDoc,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ---------------- DOM ---------------- */
const authBox = document.getElementById("authBox");
const adminBox = document.getElementById("adminBox");
const logoutBtn = document.getElementById("logoutBtn");

const loginForm = document.getElementById("loginForm");
const loginMsg = document.getElementById("loginMsg");
const statusMsg = document.getElementById("statusMsg");

/* Tabs */
const tabBtns = document.querySelectorAll(".tabBtn");
const panes = {
  posts: document.getElementById("pane-posts"),
  pages: document.getElementById("pane-pages"),
  affiliate: document.getElementById("pane-affiliate"),
  profile: document.getElementById("pane-profile"),
};

/* Posts */
const newPostBtn = document.getElementById("newPostBtn");
const cancelPostBtn = document.getElementById("cancelPostBtn");
const postEditorWrap = document.getElementById("postEditorWrap");
const savePostBtn = document.getElementById("savePostBtn");
const postMsg = document.getElementById("postMsg");

const postTitle = document.getElementById("postTitle");
const postTags = document.getElementById("postTags");
const postStatus = document.getElementById("postStatus");
const publishAtEl = document.getElementById("publishAt");
const postsList = document.getElementById("postsList");

/* Pages */
const pageSelect = document.getElementById("pageSelect");
const loadPageBtn = document.getElementById("loadPageBtn");
const savePageBtn = document.getElementById("savePageBtn");
const pageMsg = document.getElementById("pageMsg");

/* Affiliate */
const newLinkBtn = document.getElementById("newLinkBtn");
const cancelLinkBtn = document.getElementById("cancelLinkBtn");
const linkFormWrap = document.getElementById("linkFormWrap");
const saveLinkBtn = document.getElementById("saveLinkBtn");
const linkMsg = document.getElementById("linkMsg");

const linkTitle = document.getElementById("linkTitle");
const linkUrl = document.getElementById("linkUrl");
const linkCategory = document.getElementById("linkCategory");
const linkDesc = document.getElementById("linkDesc");
const linksList = document.getElementById("linksList");

/* Profile */
const profilePreview = document.getElementById("profilePreview");
const profileFile = document.getElementById("profileFile");
const uploadProfileBtn = document.getElementById("uploadProfileBtn");
const profileMsg = document.getElementById("profileMsg");

/* ---------------- Utilities ---------------- */
function esc(s){
  return (s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function parseTags(raw){
  return (raw || "").split(",").map(x => x.trim()).filter(Boolean);
}

function datetimeLocalToTimestamp(val){
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function timestampToDatetimeLocal(ts){
  if (!ts) return "";
  const d = ts.toDate();
  const pad = (n) => String(n).padStart(2,"0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/* ---------------- Quill editors ---------------- */
const quillPost = new Quill("#editor", {
  theme: "snow",
  modules: {
    toolbar: [
      [{ font: [] }, { size: [] }],
      ["bold", "italic", "underline", "strike"],
      [{ color: [] }, { background: [] }],
      [{ header: 1 }, { header: 2 }, "blockquote", "code-block"],
      [{ list: "ordered" }, { list: "bullet" }],
      [{ align: [] }],
      ["link", "image"],
      ["clean"]
    ]
  }
});

const quillPage = new Quill("#pageEditor", {
  theme: "snow",
  modules: {
    toolbar: [
      [{ header: [1,2,3,false] }],
      ["bold", "italic", "underline"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link"],
      ["clean"]
    ]
  }
});

/* Image uploads inside blog posts:
   Clicking the "image" button uploads a file to Storage and inserts its URL. */
const postToolbar = quillPost.getModule("toolbar");
postToolbar.addHandler("image", async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.click();

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      statusMsg.textContent = "Uploading image…";

      const user = auth.currentUser;
      const safeName = file.name.replace(/\s+/g, "-").toLowerCase();
      const path = `post-images/${user.uid}/${Date.now()}-${safeName}`;
      const r = ref(storage, path);

      await uploadBytes(r, file);
      const url = await getDownloadURL(r);

      const range = quillPost.getSelection(true);
      quillPost.insertEmbed(range.index, "image", url, "user");
      quillPost.setSelection(range.index + 1);

      statusMsg.textContent = "Image uploaded.";
    } catch (e) {
      statusMsg.textContent = "Image upload failed: " + e.message;
    }
  };
});

/* ---------------- Tabs ---------------- */
function setTab(name){
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  Object.keys(panes).forEach(k => panes[k].classList.toggle("active", k === name));
}

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

/* ---------------- Auth ---------------- */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    authBox.style.display = "none";
    adminBox.style.display = "block";
    logoutBtn.style.display = "inline-flex";

    bindPosts();
    bindAffiliate();
    await loadProfilePreview();
  } else {
    authBox.style.display = "block";
    adminBox.style.display = "none";
    logoutBtn.style.display = "none";
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginMsg.textContent = "Logged in.";
  } catch (err) {
    loginMsg.textContent = err.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

/* ---------------- POSTS: Create/Edit/Delete + Draft/Scheduled/Published ---------------- */
let editingPostId = null;

function openPostEditor(mode){
  postEditorWrap.style.display = "block";
  cancelPostBtn.style.display = "inline-flex";
  postMsg.textContent = "";
  statusMsg.textContent = mode || "";
}

function closePostEditor(){
  postEditorWrap.style.display = "none";
  cancelPostBtn.style.display = "none";
  postMsg.textContent = "";
  statusMsg.textContent = "";
  editingPostId = null;
}

newPostBtn.addEventListener("click", () => {
  editingPostId = null;
  postTitle.value = "";
  postTags.value = "";
  postStatus.value = "draft";
  publishAtEl.value = "";
  quillPost.setContents([]);
  savePostBtn.textContent = "Save";
  openPostEditor("Creating a new post");
});

cancelPostBtn.addEventListener("click", closePostEditor);

savePostBtn.addEventListener("click", async () => {
  postMsg.textContent = "";

  const title = postTitle.value.trim();
  const tags = parseTags(postTags.value);
  const contentHtml = quillPost.root.innerHTML?.trim() || "";
  const isEmpty = contentHtml === "<p><br></p>" || contentHtml === "";

  const status = postStatus.value; // draft|scheduled|published
  const publishAt = datetimeLocalToTimestamp(publishAtEl.value);

  if (!title || isEmpty) {
    postMsg.textContent = "Title and content are required.";
    return;
  }

  // Enforce publishAt rules:
  // - draft: can be null
  // - scheduled: must have publishAt in the future (or now)
  // - published: must have publishAt (default now)
  let finalPublishAt = publishAt;

  if (status === "scheduled" && !finalPublishAt) {
    postMsg.textContent = "Scheduled posts need a publish date/time.";
    return;
  }

  if (status === "published" && !finalPublishAt) {
    finalPublishAt = Timestamp.now();
  }

  savePostBtn.disabled = true;
  savePostBtn.textContent = editingPostId ? "Saving…" : "Creating…";

  try {
    const data = {
      title,
      tags,
      contentHtml,
      status,
      publishAt: finalPublishAt || null,
      updatedAt: serverTimestamp()
    };

    if (!editingPostId) {
      data.createdAt = serverTimestamp();
      // default publishAt to now for drafts? keep null
      if (status === "draft") data.publishAt = null;
      const refDoc = await addDoc(collection(db, "posts"), data);
      postMsg.textContent = "Saved.";
      statusMsg.textContent = "Post saved.";
      editingPostId = refDoc.id;
      closePostEditor();
    } else {
      await updateDoc(doc(db, "posts", editingPostId), data);
      postMsg.textContent = "Saved changes.";
      statusMsg.textContent = "Post updated.";
      closePostEditor();
    }
  } catch (err) {
    postMsg.textContent = err.message;
  } finally {
    savePostBtn.disabled = false;
    savePostBtn.textContent = "Save";
  }
});

function bindPosts(){
  const q = query(collection(db, "posts"), orderBy("updatedAt", "desc"));

  onSnapshot(q, (snap) => {
    if (snap.empty) {
      postsList.innerHTML = `<p class="muted">No posts yet.</p>`;
      return;
    }

    postsList.innerHTML = snap.docs.map(d => {
      const p = d.data();

      const tmp = document.createElement("div");
      tmp.innerHTML = p.contentHtml || "";
      const plain = (tmp.textContent || "").trim();
      const preview = plain.length > 140 ? plain.slice(0, 140).trimEnd() + "…" : plain;

      const status = p.status || "draft";
      const pill = `<span class="statusPill">${esc(status)}</span>`;
      const when = p.publishAt ? `<span class="statusPill">${esc(timestampToDatetimeLocal(p.publishAt).replace("T"," "))}</span>` : "";

      const tagHtml = (Array.isArray(p.tags) ? p.tags : [])
        .slice(0, 6)
        .map(t => `<span class="tag">${esc(t)}</span>`)
        .join("");

      return `
        <div class="item" data-id="${d.id}">
          <div style="min-width:240px; flex:1;">
            <h3>${esc(p.title || "Untitled")}</h3>
            <p class="muted fine" style="margin:0 0 10px;">${esc(preview)}</p>
            <div class="row" style="gap:8px; margin-bottom:8px;">${pill}${when}</div>
            <div class="row" style="gap:8px; flex-wrap:wrap;">${tagHtml}</div>
          </div>

          <div class="actions">
            <button class="btn small ghost" data-action="edit">Edit</button>
            <button class="btn small ghost" data-action="delete">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  });

  postsList.addEventListener("click", handlePostActions);
}

async function handlePostActions(e){
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const item = btn.closest(".item");
  const id = item?.getAttribute("data-id");
  if (!id) return;

  const action = btn.getAttribute("data-action");

  if (action === "delete") {
    const ok = confirm("Delete this post? This cannot be undone.");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "posts", id));
      statusMsg.textContent = "Post deleted.";
    } catch (err) {
      statusMsg.textContent = err.message;
    }
    return;
  }

  if (action === "edit") {
    const snap = await getDoc(doc(db, "posts", id));
    if (!snap.exists()) {
      statusMsg.textContent = "Post not found.";
      return;
    }

    const p = snap.data();
    editingPostId = id;

    postTitle.value = p.title || "";
    postTags.value = Array.isArray(p.tags) ? p.tags.join(", ") : "";
    postStatus.value = p.status || "draft";
    publishAtEl.value = p.publishAt ? timestampToDatetimeLocal(p.publishAt) : "";
    quillPost.root.innerHTML = p.contentHtml || "<p><br></p>";

    openPostEditor("Editing post");
  }
}

/* ---------------- PAGES: Edit Upcoming/Activities/Newsletter ---------------- */
loadPageBtn.addEventListener("click", loadSelectedPage);
savePageBtn.addEventListener("click", saveSelectedPage);

async function loadSelectedPage(){
  pageMsg.textContent = "Loading…";
  const key = pageSelect.value;

  try {
    const snap = await getDoc(doc(db, "site", key));
    if (!snap.exists()) {
      quillPage.setContents([]);
      pageMsg.textContent = "No content yet. Write it and click Save.";
    } else {
      const d = snap.data();
      quillPage.root.innerHTML = d.contentHtml || "<p><br></p>";
      pageMsg.textContent = "Loaded.";
    }
  } catch (e) {
    pageMsg.textContent = e.message;
  }
}

async function saveSelectedPage(){
  pageMsg.textContent = "";
  const key = pageSelect.value;
  const contentHtml = quillPage.root.innerHTML?.trim() || "";

  try {
    await setDoc(doc(db, "site", key), {
      contentHtml,
      updatedAt: serverTimestamp()
    }, { merge: true });

    pageMsg.textContent = "Saved. Live site updated.";
  } catch (e) {
    pageMsg.textContent = e.message;
  }
}

/* ---------------- AFFILIATE: CRUD ---------------- */
let editingLinkId = null;

function openLinkForm(mode){
  linkFormWrap.style.display = "block";
  cancelLinkBtn.style.display = "inline-flex";
  linkMsg.textContent = mode || "";
}

function closeLinkForm(){
  linkFormWrap.style.display = "none";
  cancelLinkBtn.style.display = "none";
  linkMsg.textContent = "";
  editingLinkId = null;
}

newLinkBtn.addEventListener("click", () => {
  editingLinkId = null;
  linkTitle.value = "";
  linkUrl.value = "";
  linkCategory.value = "";
  linkDesc.value = "";
  openLinkForm("New link");
});

cancelLinkBtn.addEventListener("click", closeLinkForm);

saveLinkBtn.addEventListener("click", async () => {
  linkMsg.textContent = "";

  const title = linkTitle.value.trim();
  const url = linkUrl.value.trim();
  const category = linkCategory.value.trim();
  const description = linkDesc.value.trim();

  if (!title || !url) {
    linkMsg.textContent = "Title and URL are required.";
    return;
  }

  try {
    const data = {
      title, url, category, description,
      updatedAt: serverTimestamp()
    };

    if (!editingLinkId) {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "affiliateLinks"), data);
      linkMsg.textContent = "Saved.";
      closeLinkForm();
    } else {
      await updateDoc(doc(db, "affiliateLinks", editingLinkId), data);
      linkMsg.textContent = "Updated.";
      closeLinkForm();
    }
  } catch (e) {
    linkMsg.textContent = e.message;
  }
});

function bindAffiliate(){
  const q = query(collection(db, "affiliateLinks"), orderBy("updatedAt", "desc"));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      linksList.innerHTML = `<p class="muted">No links yet.</p>`;
      return;
    }

    linksList.innerHTML = snap.docs.map(d => {
      const x = d.data();
      return `
        <div class="item" data-id="${d.id}">
          <div style="min-width:240px; flex:1;">
            <h3>${esc(x.title || "Link")}</h3>
            <p class="muted fine" style="margin:0 0 10px;">${esc(x.description || "")}</p>
            <div class="row" style="gap:8px; flex-wrap:wrap;">
              ${x.category ? `<span class="tag">${esc(x.category)}</span>` : ""}
              <span class="tag">${esc(x.url || "")}</span>
            </div>
          </div>
          <div class="actions">
            <button class="btn small ghost" data-action="edit-link">Edit</button>
            <button class="btn small ghost" data-action="delete-link">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  });

  linksList.addEventListener("click", handleLinkActions);
}

async function handleLinkActions(e){
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const item = btn.closest(".item");
  const id = item?.getAttribute("data-id");
  if (!id) return;

  const action = btn.getAttribute("data-action");

  if (action === "delete-link") {
    const ok = confirm("Delete this link?");
    if (!ok) return;
    await deleteDoc(doc(db, "affiliateLinks", id));
    statusMsg.textContent = "Link deleted.";
    return;
  }

  if (action === "edit-link") {
    const snap = await getDoc(doc(db, "affiliateLinks", id));
    if (!snap.exists()) return;
    const x = snap.data();

    editingLinkId = id;
    linkTitle.value = x.title || "";
    linkUrl.value = x.url || "";
    linkCategory.value = x.category || "";
    linkDesc.value = x.description || "";

    openLinkForm("Editing link");
  }
}

/* ---------------- PROFILE: Upload author photo and store URL in Firestore ---------------- */
async function loadProfilePreview(){
  try {
    const snap = await getDoc(doc(db, "site", "profile"));
    if (snap.exists()) {
      const d = snap.data();
      if (d.photoUrl) profilePreview.src = d.photoUrl;
    }
  } catch {}
}

profileFile.addEventListener("change", () => {
  const file = profileFile.files?.[0];
  if (!file) return;
  profilePreview.src = URL.createObjectURL(file);
});

uploadProfileBtn.addEventListener("click", async () => {
  profileMsg.textContent = "";
  const file = profileFile.files?.[0];
  if (!file) {
    profileMsg.textContent = "Choose a file first.";
    return;
  }

  try {
    profileMsg.textContent = "Uploading…";
    const user = auth.currentUser;
    const safeName = file.name.replace(/\s+/g, "-").toLowerCase();
    const path = `profile/${user.uid}/${Date.now()}-${safeName}`;
    const r = ref(storage, path);

    await uploadBytes(r, file);
    const url = await getDownloadURL(r);

    await setDoc(doc(db, "site", "profile"), {
      photoUrl: url,
      updatedAt: serverTimestamp()
    }, { merge: true });

    profileMsg.textContent = "Uploaded. About page is updated.";
    statusMsg.textContent = "Profile photo updated.";
  } catch (e) {
    profileMsg.textContent = e.message;
  }
});
