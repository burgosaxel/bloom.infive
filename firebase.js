// firebase.js  (ES module + window globals)

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

const firebaseConfig = {
  apiKey: "AIzaSyAXv7cIJLaMbFon-3GyMixJdgAFfoob_qE",
  authDomain: "bloom-in-five.firebaseapp.com",
  projectId: "bloom-in-five",
  storageBucket: "bloom-in-five.firebasestorage.app",
  messagingSenderId: "684423939743",
  appId: "1:684423939743:web:a37667b6b29154beef44aa",
  measurementId: "G-R6FJ4K8JWG",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Globals for nav.js
window.fb = { app, auth, db, storage };

window.fbFns = {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,

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

  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};

// Named exports for modules
export {
  app,
  auth,
  db,
  storage,

  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,

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

  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};
