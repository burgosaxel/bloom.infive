"use strict";

const admin = require("firebase-admin");
admin.initializeApp();

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineString, defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const nodemailer = require("nodemailer");
const { google } = require("googleapis");

// -----------------------
// Params / Secrets (NO functions.config())
// -----------------------
const GMAIL_CLIENT_ID = defineString("GMAIL_CLIENT_ID");
const GMAIL_CLIENT_SECRET = defineSecret("GMAIL_CLIENT_SECRET");

// This should be your Workspace sender, e.g. info@bloominfive.blog
const GMAIL_SENDER = defineString("GMAIL_SENDER");

// Your PUBLIC website base (used in links)
const SITE_URL = defineString("SITE_URL");

// The callback path (function name) - we keep it consistent:
const OAUTH_CALLBACK_PATH = "oauthCallback";

// -----------------------
// Helpers
// -----------------------
function functionBaseUrl(req) {
  // Works for Cloud Functions URL like:
  // https://us-central1-bloom-in-five.cloudfunctions.net/oauthStart
  const proto = req.get("x-forwarded-proto") || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function buildOAuthClient(redirectUri) {
  return new google.auth.OAuth2(
    GMAIL_CLIENT_ID.value(),
    GMAIL_CLIENT_SECRET.value(),
    redirectUri
  );
}

async function getStoredRefreshToken() {
  const snap = await admin.firestore().doc("site/email").get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return data.refreshToken || null;
}

async function saveRefreshToken(refreshToken, meta = {}) {
  await admin.firestore().doc("site/email").set(
    {
      refreshToken,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...meta,
    },
    { merge: true }
  );
}

async function getAccessTokenFromRefreshToken(oauth2Client, refreshToken) {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  // googleapis returns either string or object depending on version
  const at = await oauth2Client.getAccessToken();
  return typeof at === "string" ? at : at?.token;
}

function buildWelcomeHtml({ email }) {
  const site = SITE_URL.value() || "https://bloominfive.blog";
  const safeEmail = (email || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111;">
    <h2 style="margin:0 0 12px;">Welcome to BLOOM.INFIVE 🌿</h2>
    <p style="margin:0 0 10px;">Thanks for subscribing${safeEmail ? `, <b>${safeEmail}</b>` : ""}.</p>
    <p style="margin:0 0 10px;">You’ll get new posts, upcoming releases, and faith-rooted updates.</p>
    <p style="margin:16px 0 0;">
      Visit the site: <a href="${site}">${site}</a>
    </p>
    <p style="margin:18px 0 0;color:#555;font-size:12px;">
      If you didn’t request this, you can ignore this email.
    </p>
  </div>`;
}

// -----------------------
// 1) Health check
// -----------------------
exports.health = onRequest({ region: "us-central1" }, (req, res) => {
  res.status(200).send("OK");
});

// -----------------------
// 2) OAuth Start (admin-only link you open manually)
// -----------------------
exports.oauthStart = onRequest(
  {
    region: "us-central1",
    secrets: [GMAIL_CLIENT_SECRET],
  },
  async (req, res) => {
    try {
      const base = functionBaseUrl(req);
      const redirectUri = `${base}/${OAUTH_CALLBACK_PATH}`;

      const oauth2Client = buildOAuthClient(redirectUri);

      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/gmail.send"],
      });

      res.status(302).set("Location", url).send("Redirecting…");
    } catch (err) {
      logger.error(err);
      res.status(500).send("Failed to start OAuth.");
    }
  }
);

// -----------------------
// 3) OAuth Callback (saves refresh token to Firestore)
// -----------------------
exports.oauthCallback = onRequest(
  {
    region: "us-central1",
    secrets: [GMAIL_CLIENT_SECRET],
  },
  async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.status(400).send("Missing ?code=");

      const base = functionBaseUrl(req);
      const redirectUri = `${base}/${OAUTH_CALLBACK_PATH}`;
      const oauth2Client = buildOAuthClient(redirectUri);

      const { tokens } = await oauth2Client.getToken(String(code));
      const refreshToken = tokens.refresh_token;

      if (!refreshToken) {
        return res
          .status(400)
          .send("No refresh_token returned. Try again with prompt=consent.");
      }

      await saveRefreshToken(refreshToken, {
        tokenSource: "oauthCallback",
      });

      res
        .status(200)
        .send(
          "✅ Gmail connected! You can close this tab and test a newsletter signup."
        );
    } catch (err) {
      logger.error(err);
      res.status(500).send("OAuth callback failed.");
    }
  }
);

// -----------------------
// 4) Firestore Trigger: Send welcome email when subscriber created
// Collection must be: subscribers
// -----------------------
exports.sendWelcomeEmail = onDocumentCreated(
  {
    region: "us-central1",
    document: "subscribers/{subId}",
    secrets: [GMAIL_CLIENT_SECRET],
  },
  async (event) => {
    const data = event.data?.data() || {};
    const email = (data.email || "").toString().trim().toLowerCase();
    if (!email) return;

    // Avoid sending twice if your code re-writes / merges
    // (optional safety check)
    if (data.welcomeSent === true) return;

    const sender = GMAIL_SENDER.value();
    if (!sender) {
      logger.error("Missing GMAIL_SENDER param.");
      return;
    }

    const refreshToken = await getStoredRefreshToken();
    if (!refreshToken) {
      logger.error("No refresh token saved. Visit /oauthStart first.");
      return;
    }

    // Build OAuth client using the *live* function URL
    // We can build it without req here by using the known cloudfunctions host format.
    // Safer: store the redirectUri used during OAuth in Firestore, but this works fine:
    // https://us-central1-PROJECT.cloudfunctions.net/oauthCallback
    const redirectUri = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/${OAUTH_CALLBACK_PATH}`;
    const oauth2Client = buildOAuthClient(redirectUri);

    const accessToken = await getAccessTokenFromRefreshToken(
      oauth2Client,
      refreshToken
    );
    if (!accessToken) {
      logger.error("Failed to get access token from refresh token.");
      return;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: sender,
        clientId: GMAIL_CLIENT_ID.value(),
        clientSecret: GMAIL_CLIENT_SECRET.value(),
        refreshToken,
        accessToken,
      },
    });

    const subject = "Welcome to BLOOM.INFIVE 🌿";
    const html = buildWelcomeHtml({ email });

    try {
      await transporter.sendMail({
        from: `BLOOM.INFIVE <${sender}>`,
        to: email,
        subject,
        html,
      });

      // Mark sent so we don’t double-send
      await event.data.ref.set(
        {
          welcomeSent: true,
          welcomeSentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      logger.info("Welcome email sent:", email);
    } catch (err) {
      logger.error("Failed to send email:", err);
    }
  }
);
