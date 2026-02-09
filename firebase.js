// firebase.js (type="module")

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// ✅ Your real Firebase config (from your message)
const firebaseConfig = {
  apiKey: "AIzaSyAXv7cIJLaMbFon-3GyMixJdgAFfoob_qE",
  authDomain: "bloom-in-five.firebaseapp.com",
  projectId: "bloom-in-five",
  storageBucket: "bloom-in-five.firebasestorage.app",
  messagingSenderId: "684423939743",
  appId: "1:684423939743:web:a37667b6b29154beef44aa",
  measurementId: "G-R6FJ4K8JWG"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ✅ Make Firebase available to non-module scripts (like nav.js)
window.fb = { app, auth, db, storage };
window.fbFns = {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp
};
