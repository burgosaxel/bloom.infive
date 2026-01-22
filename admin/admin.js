import { auth, db } from "../firebase.js";
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
  where,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ---------- DOM ---------- */
const authBox = document.getElementById("authBox");
const adminBox = document.getElementById("adminBox");
const logoutBtn = document.getElementById("logoutBtn");

const loginForm = document.getElementById("loginForm");
const loginMsg = document.getElementById("loginMsg");

const newBtn = document.getElementById("newBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const statusMsg = document.getElementById("statusMsg");

const editorWrap = document.getElementById("editorWrap");
const publishBtn = document.getElementById("publishBtn");
const postMsg = document.getElementById("postMsg");

const titleEl = document.getElementById("title");
const tagsEl = document.getElementById("tags");
const postsList = document.getElementById("postsList");

/* ---------- Quill setup ---------- */
const quill = new Quill("#editor", {
  theme: "snow",
  modules: {
    toolbar: [
      [{ font: [] }, { size: [] }],
      ["bold", "italic", "underline", "strike"],
      [{ color: [] }, { background: [] }],
      [{ script: "sub" }, { script: "super" }],
      [{ header: 1 }, { header: 2 }, "blockquote", "code-block"],
      [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
      [{ direction: "rtl" }, { align: [] }],
      ["link", "image"],
      ["clean"]
    ]
  }
});

/* ---------- State ---------- */
let unsubscribePosts = null;
let editingId = null; // if set -> update, else -> create

function esc(s){
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseTags(raw){
  return (raw || "")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);
}

function openEditor(modeText){
  editorWrap.style.display = "block";
  postMsg.textContent = "";
  statusMsg.textContent = modeText || "";
}

function closeEditor(){
  editorWrap.style.display = "none";
  postMsg.textContent = "";
  statusMsg.textContent = "";
  editingId = null;
  cancelEditBtn.style.display = "none";
}

/* ---------- Auth ---------- */
onAuthStateChanged(auth, (user) => {
  if (user) {
    authBox.style.display = "none";
    adminBox.style.display = "block";
    logoutBtn.style.display = "inline-flex";
    bindPostsList(); // start listening
  } else {
    authBox.style.display = "block";
    adminBox.style.display = "none";
    logoutBtn.style.display = "none";
    if (unsubscribePosts) unsubscribePosts();
    unsubscribePosts = null;
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

/* ---------- New / Cancel ---------- */
newBtn.addEventListener("click", () => {
  editingId = null;
  titleEl.value = "";
  tagsEl.value = "";
  quill.setContents([]); // blank
  cancelEditBtn.style.display = "none";
  publishBtn.textContent = "Publish";
  openEditor("Creating a new post");
});

cancelEditBtn.addEventListener("click", () => {
  closeEditor();
});

/* ---------- Publish (Create/Update) ---------- */
publishBtn.addEventListener("click", async () => {
  postMsg.textContent = "";

  const title = titleEl.value.trim();
  const tags = parseTags(tagsEl.value);
  const contentHtml = quill.root.innerHTML?.trim() || "";

  // Quill empty editor is "<p><br></p>"
  const isEmpty = contentHtml === "<p><br></p>" || contentHtml === "";

  if (!title || isEmpty) {
    postMsg.textContent = "Title and content are required.";
    return;
  }

  publishBtn.disabled = true;
  publishBtn.textContent = editingId ? "Saving…" : "Publishing…";

  try {
    if (editingId) {
      await updateDoc(doc(db, "posts", editingId), {
        title,
        tags,
        contentHtml,
        updatedAt: serverTimestamp()
      });
      postMsg.textContent = "Saved changes.";
      closeEditor();
    } else {
      await addDoc(collection(db, "posts"), {
        title,
        tags,
        contentHtml,
        published: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      postMsg.textContent = "Published! It’s live on the public blog.";
      closeEditor();
    }
  } catch (err) {
    postMsg.textContent = err.message;
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = editingId ? "Save" : "Publish";
  }
});

/* ---------- List / Edit / Delete ---------- */
function bindPostsList(){
  if (unsubscribePosts) return;

  const q = query(
    collection(db, "posts"),
    where("published", "==", true),
    orderBy("createdAt", "desc")
  );

  unsubscribePosts = onSnapshot(q, (snap) => {
    if (snap.empty) {
      postsList.innerHTML = `<p class="muted">No posts yet.</p>`;
      return;
    }

    postsList.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const tagHtml = (Array.isArray(p.tags) ? p.tags : [])
        .slice(0, 5)
        .map(t => `<span class="tag">${esc(t)}</span>`)
        .join("");

      // tiny safe preview: strip tags for display
      const tmp = document.createElement("div");
      tmp.innerHTML = p.contentHtml || "";
      const plain = (tmp.textContent || "").trim();
      const preview = plain.length > 120 ? plain.slice(0, 120).trimEnd() + "…" : plain;

      return `
        <div class="adminItem" data-id="${d.id}">
          <div style="min-width:220px; flex:1;">
            <h3>${esc(p.title || "Untitled")}</h3>
            <p class="muted fine" style="margin:0 0 10px;">${esc(preview)}</p>
            <div class="meta">${tagHtml}</div>
          </div>

          <div class="actions">
            <button class="btn small ghost" data-action="edit">Edit</button>
            <button class="btn small ghost" data-action="delete">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }, (err) => {
    postsList.innerHTML = `<p class="muted">Error loading posts: ${esc(err.message)}</p>`;
  });

  postsList.addEventListener("click", handleListClick);
}

async function handleListClick(e){
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const item = btn.closest(".adminItem");
  const id = item?.getAttribute("data-id");
  if (!id) return;

  if (action === "delete") {
    const ok = confirm("Delete this post? This cannot be undone.");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "posts", id));
      statusMsg.textContent = "Deleted.";
    } catch (err) {
      statusMsg.textContent = err.message;
    }
    return;
  }

  if (action === "edit") {
    // Load data from the rendered card (fast) is not reliable for HTML
    // Instead, subscribe list already has it; simplest is to fetch using snapshot cache:
    // We'll read it from DOM text + require manual content? Better: just use a second snapshot read.
    // Minimal approach: fetch current values by opening doc via onSnapshot list cache (not stored).
    // So do a quick dynamic import getDoc here.
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const snap = await getDoc(doc(db, "posts", id));
    if (!snap.exists()) {
      statusMsg.textContent = "Post not found.";
      return;
    }
    const p = snap.data();

    editingId = id;
    titleEl.value = p.title || "";
    tagsEl.value = Array.isArray(p.tags) ? p.tags.join(", ") : "";
    quill.root.innerHTML = p.contentHtml || "<p><br></p>";

    cancelEditBtn.style.display = "inline-flex";
    publishBtn.textContent = "Save";
    openEditor("Editing post");
  }
}
