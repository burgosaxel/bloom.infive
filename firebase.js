// firebase.js (global helpers for the site)
// IMPORTANT: put your real config here (project bloom-in-five)
window.firebaseConfig = {
  apiKey: "AIzaSyAXv7cIJLaMbFon-3GyMixJdgAFfoob_qE",
  authDomain: "bloom-in-five.firebaseapp.com",
  projectId: "bloom-in-five",
  storageBucket: "bloom-in-five.firebasestorage.app",
  messagingSenderId: "684423939743",
  appId: "1:684423939743:web:a37667b6b29154beef44aa",
  measurementId: "G-R6FJ4K8JWG"
};

(async () => {
  // Load Firebase modules
  const appMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
  const fsMod   = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  const stMod   = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js");

  const app = appMod.initializeApp(window.firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  const storage = stMod.getStorage(app);

  // Expose to window for other scripts
  window.fb = { app, auth, db, storage };
  window.fbFns = {
    // Firestore
    collection: fsMod.collection,
    query: fsMod.query,
    where: fsMod.where,
    orderBy: fsMod.orderBy,
    limit: fsMod.limit,
    getDocs: fsMod.getDocs,
    doc: fsMod.doc,
    getDoc: fsMod.getDoc,
    Timestamp: fsMod.Timestamp
  };
})();
