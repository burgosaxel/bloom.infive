// /firebase.js  (ES module + window globals)
// Works for:
// - admin portal (imports from ../firebase.js)
// - public scripts (nav.js uses window.fb + window.fbFns)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

// ✅ Your Firebase web config
const firebaseConfig = {
  apiKey: "AIzaSyAXv7cIJLaMbFon-3GyMixJdgAFfoob_qE",
  authDomain: "bloom-in-five.firebaseapp.com",
  projectId: "bloom-in-five",
  storageBucket: "bloom-in-five.firebasestorage.app",
  messagingSenderId: "684423939743",
  appId: "1:684423939743:web:a37667b6b29154beef44aa",
  measurementId: "G-R6FJ4K8JWG",
};

// Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Globals for non-module scripts (nav.js expects these)
window.fb = { app, auth, db, storage };

window.fbFns = {
  // Auth
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,

  // Firestore
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,

  // Storage
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};

// Named exports for module imports (admin/admin.js, etc.)
export {
  app,
  auth,
  db,
  storage,

  // Auth exports
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,

  // Firestore exports
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,

  // Storage exports
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};
