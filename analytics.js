// analytics.js (ES module)
// Lightweight, privacy-minded event logging for admin reports.

import { db } from "./firebase.js";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const CLIENT_KEY = "bloomAnalyticsId";

function getClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (id) return id;
  id = `anon_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  localStorage.setItem(CLIENT_KEY, id);
  return id;
}

function getUtm() {
  const p = new URLSearchParams(location.search);
  const utm_source = (p.get("utm_source") || "").slice(0, 80);
  const utm_medium = (p.get("utm_medium") || "").slice(0, 80);
  const utm_campaign = (p.get("utm_campaign") || "").slice(0, 80);
  return { utm_source, utm_medium, utm_campaign };
}

export async function logEvent(type, data = {}) {
  try {
    const payload = {
      type: (type || "").toString().slice(0, 40),
      path: (location.pathname || "").toString().slice(0, 200),
      referrer: (document.referrer || "").toString().slice(0, 300),
      clientId: getClientId().slice(0, 120),
      ua: (navigator.userAgent || "").toString().slice(0, 220),
      ...getUtm(),
      ...data,
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, "analyticsEvents"), payload);
  } catch {
    // Do not break page UX for analytics failures.
  }
}

export function logPageView(extra = {}) {
  return logEvent("page_view", extra);
}

