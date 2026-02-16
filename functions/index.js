// functions/index.js (CommonJS) - OAuth-only Gmail sending

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
admin.initializeApp();

const { defineString, defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");

// Region
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// ---- Params (non-secrets) ----
const SITE_URL = defineString("SITE_URL");               // https://bloominfive.blog
const GMAIL_SENDER = defineString("GMAIL_SENDER");       // info@bloominfive.blog
const GMAIL_CLIENT_ID = defineString("GMAIL_CLIENT_ID"); // xxx.apps.googleusercontent.com

// ---- Secrets ----
const GMAIL_CLIENT_SECRET = defineSecret("GMAIL_CLIENT_SECRET");
const GMAIL_REFRESH_TOKEN = defineSecret("GMAIL_REFRESH_TOKEN");

// Helper: create OAuth2 client
function oauthClient(req) {
  const redirectUri =
    "https://us-central1-bloom-in-five.cloudfunctions.net/oauthCallback";

  const oAuth2 = new google.auth.OAuth2(
    GMAIL_CLIENT_ID.value(),
    GMAIL_CLIENT_SECRET.value(),
    redirectUri
  );

  // refresh token used server-side to get access tokens
  oAuth2.setCredentials({
    refresh_token: GMAIL_REFRESH_TOKEN.value(),
  });

  return oAuth2;
}

// Helper: Gmail API send
async function sendGmail({ to, subject, text, html }) {
  const auth = oauthClient();
  const gmail = google.gmail({ version: "v1", auth });

  // Build RFC 2822 email
  const boundary = "000000000000000000000";
  const msgParts = [];

  msgParts.push(`From: "BLOOM.INFIVE" <${GMAIL_SENDER.value()}>`);
  msgParts.push(`To: ${to}`);
  msgParts.push(`Subject: ${subject}`);
  msgParts.push("MIME-Version: 1.0");
  msgParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  msgParts.push("");
  msgParts.push(`--${boundary}`);
  msgParts.push('Content-Type: text/plain; charset="UTF-8"');
  msgParts.push("");
  msgParts.push(text || "");
  msgParts.push("");
  msgParts.push(`--${boundary}`);
  msgParts.push('Content-Type: text/html; charset="UTF-8"');
  msgParts.push("");
  msgParts.push(html || "");
  msgParts.push("");
  msgParts.push(`--${boundary}--`);

  const raw = Buffer.from(msgParts.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

// --------------------
// OAuth start endpoint
// --------------------
exports.oauthStart = onRequest({ secrets: [GMAIL_CLIENT_SECRET] }, async (req, res) => {
  try {
    const redirectUri =
      "https://us-central1-bloom-in-five.cloudfunctions.net/oauthCallback";

    const oAuth2 = new google.auth.OAuth2(
      GMAIL_CLIENT_ID.value(),
      GMAIL_CLIENT_SECRET.value(),
      redirectUri
    );

    const url = oAuth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // forces refresh_token
      scope: ["https://www.googleapis.com/auth/gmail.send"],
    });

    res.redirect(url);
  } catch (e) {
    logger.error(e);
    res.status(500).send("oauthStart failed");
  }
});

// ----------------------
// OAuth callback endpoint
// ----------------------
exports.oauthCallback = onRequest(
  { secrets: [GMAIL_CLIENT_SECRET] },
  async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.status(400).send("Missing ?code=");

      const redirectUri =
        "https://us-central1-bloom-in-five.cloudfunctions.net/oauthCallback";

      const oAuth2 = new google.auth.OAuth2(
        GMAIL_CLIENT_ID.value(),
        GMAIL_CLIENT_SECRET.value(),
        redirectUri
      );

      const { tokens } = await oAuth2.getToken(code);

      // IMPORTANT: tokens.refresh_token only appears on first consent (or if prompt:consent)
      if (!tokens.refresh_token) {
        return res
          .status(200)
          .send(
            "No refresh_token returned. Revoke app access in Google Account and try again."
          );
      }

      // Print it ONCE so you can copy/paste into Firebase secret
      logger.warn("COPY THIS REFRESH TOKEN: " + tokens.refresh_token);

      // Also show it in the response so setup isn't blocked by log retrieval issues.
      res.status(200).send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OAuth Success</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 24px; }
    code, pre { background: #f4f4f6; padding: 12px; border-radius: 10px; display: block; overflow: auto; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  </style>
  </head>
  <body>
    <h2>OAuth OK</h2>
    <p>Copy this refresh token and save it as the Firebase Functions secret <strong>GMAIL_REFRESH_TOKEN</strong>.</p>
    <pre id="tok">${tokens.refresh_token}</pre>
    <button id="copy">Copy</button>
    <script>
      document.getElementById('copy').addEventListener('click', async () => {
        const t = document.getElementById('tok').textContent;
        try { await navigator.clipboard.writeText(t); alert('Copied'); }
        catch (e) { prompt('Copy token:', t); }
      });
    </script>
  </body>
</html>
      `);
    } catch (e) {
      logger.error(e);
      const redirectUri =
        "https://us-central1-bloom-in-five.cloudfunctions.net/oauthCallback";
      const extra = {
        message: "OAuth callback failed",
        clientId: GMAIL_CLIENT_ID.value(),
        redirectUri,
        error: e?.message || String(e),
        // Gaxios (googleapis) error payload, if present (safe: does not include secrets)
        responseData: e?.response?.data || null,
      };
      res.status(500).send(
        "<pre>" + JSON.stringify(extra, null, 2) + "</pre>"
      );
    }
  }
);

// -----------------------------------------
// Firestore trigger: send welcome on create
// -----------------------------------------
exports.sendWelcomeEmail = onDocumentWritten(
  {
    document: "subscribers/{subId}",
    secrets: [GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      if (!after) return;

      const email = (after.email || "").toString().trim().toLowerCase();
      const status = after.status || "";
      const alreadySent = !!after.welcomeEmailSentAt;
      const wasAlreadySent = !!before?.welcomeEmailSentAt;

      logger.info("sendWelcomeEmail trigger fired", {
        subId: event.params?.subId || "",
        email,
        status,
        alreadySent,
        wasAlreadySent,
      });

      // Only send once for active subscribers.
      // This also allows retries when a doc already existed before trigger fixes.
      if (!email || status !== "active" || alreadySent || wasAlreadySent) return;

      const subject = "Welcome to BLOOM.INFIVE 💛";
      const text =
        `Hi!\n\n` +
        `Thanks for subscribing to BLOOM.INFIVE.\n` +
        `You’ll get updates when new posts and releases go live.\n\n` +
        `Visit: ${SITE_URL.value()}\n\n` +
        `— Angelika / BLOOM.INFIVE`;

      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;">
          <h2 style="margin:0 0 8px;">Welcome to BLOOM.INFIVE 💛</h2>
          <p style="margin:0 0 12px;">
            Thanks for subscribing! You’ll get updates when new posts and releases go live.
          </p>
          <p style="margin:0 0 18px;">
            <a href="${SITE_URL.value()}" style="color:#111;font-weight:bold;">Visit BLOOM.INFIVE</a>
          </p>
          <p style="margin:0;color:#555;font-size:13px;">
            If you didn’t subscribe, you can ignore this email.
          </p>
        </div>
      `;

      await sendGmail({ to: email, subject, text, html });

      await event.data.after.ref.set(
        {
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      logger.info("Welcome email sent to: " + email);
    } catch (e) {
      logger.error("sendWelcomeEmail failed:", e);
    }
  }
);
