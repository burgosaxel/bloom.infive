// firebase.js (module, CDN)
// Works on GitHub Pages / static hosting.
// Exposes BOTH module exports and window globals for nav.js.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

// Your Firebase configuration (from Firebase Console)
const firebaseConfig = {
  apiKey: "AIzaSyAXv7cIJLaMbFon-3GyMixJdgAFfoob_qE",
  authDomain: "bloom-in-five.firebaseapp.com",
  projectId: "bloom-in-five",
  storageBucket: "bloom-in-five.firebasestorage.app",
  messagingSenderId: "684423939743",
  appId: "1:684423939743:web:a37667b6b29154beef44aa",
  measurementId: "G-R6FJ4K8JWG"
};

// Init
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Module exports (admin pages can import these)
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  ref,
  uploadBytes,
  getDownloadURL
};

// Globals (nav.js uses these)
window.fb = { app, auth, db, storage, Timestamp };
window.fbFns = {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  ref,
  uploadBytes,
  getDownloadURL
};
