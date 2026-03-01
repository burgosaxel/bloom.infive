// functions/index.js (CommonJS) - OAuth-only Gmail sending

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

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
const UNSUBSCRIBE_ENDPOINT = "https://us-central1-bloom-in-five.cloudfunctions.net/unsubscribe";

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
  // Secrets sometimes end up with trailing newlines when copied/pasted.
  // Google token endpoint treats that as part of the token and returns invalid_grant.
  const refreshToken = (GMAIL_REFRESH_TOKEN.value() || "").trim();
  oAuth2.setCredentials({
    refresh_token: refreshToken,
  });

  return oAuth2;
}

// Helper: Gmail API send
async function sendGmail({ to, subject, text, html }) {
  const auth = oauthClient();
  const gmail = google.gmail({ version: "v1", auth });

  function sanitizeHeaderValue(v) {
    // Prevent header injection / malformed RFC 5322 headers.
    return (v || "")
      .toString()
      .replace(/[\r\n]+/g, " ")
      .trim();
  }

  function encodeHeaderValue(v) {
    const s = sanitizeHeaderValue(v);
    // RFC 2047 encoded-word for any non-ASCII header values (e.g. emoji).
    // Keep visible ASCII; encode anything else.
    if (/^[\x20-\x7E]*$/.test(s)) return s;
    const b64 = Buffer.from(s, "utf8").toString("base64");
    return `=?UTF-8?B?${b64}?=`;
  }

  // Build RFC 2822 email
  const boundary = "000000000000000000000";
  const msgParts = [];

  msgParts.push(`From: "BLOOM.INFIVE" <${GMAIL_SENDER.value()}>`);
  msgParts.push(`To: ${sanitizeHeaderValue(to)}`);
  msgParts.push(`Subject: ${encodeHeaderValue(subject)}`);
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
      const unsubToken = (after.unsubToken || "").toString();

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

      const sid = (event.params?.subId || "").toString();
      const unsubUrl = (sid && unsubToken)
        ? `${UNSUBSCRIBE_ENDPOINT}?sid=${encodeURIComponent(sid)}&token=${encodeURIComponent(unsubToken)}`
        : "";

      const subject = "Welcome to BLOOM.INFIVE \uD83D\uDC9B";
      const siteUrl = (SITE_URL.value() || "").toString().replace(/\/+$/g, "");
      const blogUrl = siteUrl ? `${siteUrl}/blog/index.html` : "";
      const instagramUrl = "https://www.instagram.com/bloom.infive";
      const pinterestUrl = "http://www.pinterest.com/bloominfive";
      const youtubeUrl = "https://youtube.com/@bloominfive";
      const ctaUrl = siteUrl || blogUrl;

      const text = `
Welcome to BLOOM.INFIVE \uD83D\uDC9B

SPANISH

Que alegria tenerte aqui! Gracias por unirte a este espacio donde hablamos de fe, motivacion y como vivir cada dia con proposito, incluso en medio del caos de la vida diaria.

Mi nombre es Angelika, y quiero compartir contigo todo lo que he aprendido caminando con Dios y tratando de equilibrar la maternidad, la familia y mis suenos.

Pronto recibiras inspiracion, tips practicos, reflexiones y algunas sorpresas que tengo preparadas para ti, pero hoy quiero empezar con algo simple:

Un pequeno recordatorio: No tienes que ser perfecta para crecer, para seguir, para florecer. Cada dia cuenta, y este es tu espacio seguro para hacerlo a tu ritmo.

Me encantaria que me respondieras a este email contandome un poquito de ti: que te trajo aqui y que esperas encontrar en este espacio?

Gracias por estar aqui. Estoy emocionada de acompanarte en este camino.

Con carino,
Angelika

ENGLISH

I'm so happy you're here! Thank you for joining this space where we talk about faith, motivation, and how to live each day with purpose, even in the middle of life's chaos.

My name is Angelika, and I'm excited to share with you what I've learned walking with God while balancing motherhood, family, and my dreams.

Soon you'll receive inspiration, practical tips, reflections, and a few surprises I have in store, but today I want to start simple:

A gentle reminder: You don't have to be perfect to grow, to keep going, or to flourish. Every day counts, and this is your safe space to do it at your own pace.

I'd love for you to reply to this email and share a little about yourself: What brought you here? What are you hoping to find in this space?

Thank you for being here. I'm excited to walk this journey with you.

With love,
Angelika

Visit BLOOM.INFIVE:
${ctaUrl}

Blog:
${blogUrl}

Follow us:
Instagram: ${instagramUrl}
Pinterest: ${pinterestUrl}
YouTube: ${youtubeUrl}

You are receiving this email because you subscribed on BLOOM.INFIVE. If you no longer want these emails, unsubscribe here: ${unsubUrl || "(unsubscribe unavailable)"}
      `.trim();

      const html = `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7e6c4;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7e6c4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #ead9b8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#084c61;padding:34px 24px;text-align:center;">
                <h1 style="margin:0;color:#eef6fb;font-size:34px;line-height:1.2;font-weight:800;">Welcome to BLOOM.INFIVE</h1>
                <p style="margin:10px 0 0;color:#dcecf2;font-size:16px;">Stories born in the middle of motherhood</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 20px;text-align:center;">
                <p style="margin:0 0 14px;font-size:17px;line-height:1.7;color:#1b1b1b;">
                  <strong>Que alegria tenerte aqui!</strong> Gracias por unirte a este espacio donde hablamos de fe, motivacion y como vivir cada dia con proposito, incluso en medio del caos de la vida diaria.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Mi nombre es Angelika, y quiero compartir contigo todo lo que he aprendido caminando con Dios y tratando de equilibrar la maternidad, la familia y mis suenos.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Pronto recibiras inspiracion, tips practicos, reflexiones y algunas sorpresas que tengo preparadas para ti, pero hoy quiero empezar con algo simple.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Un pequeno recordatorio: No tienes que ser perfecta para crecer, para seguir, para florecer. Cada dia cuenta, y este es tu espacio seguro para hacerlo a tu ritmo.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Me encantaria que me respondieras a este email contandome un poquito de ti: que te trajo aqui y que esperas encontrar en este espacio?
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Gracias por estar aqui. Estoy emocionada de acompanarte en este camino.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Con carino,<br/>Angelika
                </p>

                <hr style="border:0;border-top:1px solid #ead9b8;margin:20px 0;" />

                <p style="margin:0 0 14px;font-size:17px;line-height:1.7;color:#1b1b1b;">
                  <strong>I'm so happy you're here!</strong> Thank you for joining this space where we share faith, motivation, and practical encouragement.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  My name is Angelika, and I'm excited to share with you what I've learned walking with God while balancing motherhood, family, and my dreams.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Soon you'll receive inspiration, practical tips, reflections, and a few surprises I have in store, but today I want to start simple.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  A gentle reminder: You don't have to be perfect to grow, to keep going, or to flourish. Every day counts, and this is your safe space to do it at your own pace.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  I'd love for you to reply to this email and share a little about yourself: what brought you here and what are you hoping to find in this space?
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  Thank you for being here. I'm excited to walk this journey with you.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;">
                  With love,<br/>Angelika
                </p>

                <a href="${ctaUrl}" style="display:inline-block;background:#c5431b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:13px;">
                  Visit BLOOM.INFIVE
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 28px;background:#eef4ea;text-align:center;border-top:1px solid #e3eadb;">
                <p style="margin:0 0 12px;font-size:20px;color:#0f2a3a;font-family:Georgia,serif;">Follow us on</p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.8;">
                  <a href="${instagramUrl}" style="color:#0f2a3a;text-decoration:underline;font-weight:700;">Instagram</a>
                  &nbsp;|&nbsp;
                  <a href="${pinterestUrl}" style="color:#0f2a3a;text-decoration:underline;font-weight:700;">Pinterest</a>
                  &nbsp;|&nbsp;
                  <a href="${youtubeUrl}" style="color:#0f2a3a;text-decoration:underline;font-weight:700;">YouTube</a>
                </p>
                <p style="margin:0;color:#4c4c4c;font-size:12px;line-height:1.7;">
                  You are receiving this email because you subscribed on BLOOM.INFIVE.
                  ${unsubUrl ? `If you no longer wish to receive these emails, click here to <a href="${unsubUrl}" style="color:#0f2a3a;text-decoration:underline;">unsubscribe</a>.` : ""}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
      `.trim();

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

function isLivePost(data) {
  if (!data) return false;
  const pub = data.published === true || data.status === "published";
  if (!pub) return false;
  const ms = data.publishAt && typeof data.publishAt.toMillis === "function"
    ? data.publishAt.toMillis()
    : 0;
  return ms > 0 && ms <= Date.now();
}

exports.notifySubscribersOnPostPublished = onDocumentWritten(
  {
    document: "posts/{postId}",
    secrets: [GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    region: "us-central1",
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || null;
      const after = event.data?.after?.data() || null;
      const postRef = event.data?.after?.ref || null;
      const postId = (event.params?.postId || "").toString();

      if (!after || !postRef || !postId) return;
      if (after.notificationSentAt) return;
      if (!isLivePost(after) || isLivePost(before)) return;

      let acquired = false;
      await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(postRef);
        const cur = snap.data() || {};
        if (cur.notificationSentAt || cur.notificationInProgressAt) return;
        tx.set(postRef, {
          notificationInProgressAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        acquired = true;
      });
      if (!acquired) return;

      const title = (after.title || "New blog post").toString().trim();
      const siteUrl = (SITE_URL.value() || "").toString().replace(/\/+$/g, "");
      const postUrl = siteUrl ? `${siteUrl}/blog/post.html?id=${encodeURIComponent(postId)}` : "";
      const blogUrl = siteUrl ? `${siteUrl}/blog/` : "";
      const subject = `New on BLOOM.INFIVE: ${title}`;

      const text = `
A new blog post is now live on BLOOM.INFIVE.

Title:
${title}

Read now:
${postUrl || blogUrl || siteUrl}

You are receiving this email because you subscribed on BLOOM.INFIVE.
      `.trim();

      const html = `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7e6c4;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7e6c4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #ead9b8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#084c61;padding:30px 24px;text-align:center;">
                <h2 style="margin:0;color:#eef6fb;font-size:30px;line-height:1.2;font-weight:800;">New Blog Post</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 26px 30px;text-align:center;">
                <p style="margin:0 0 10px;font-size:16px;color:#333;">A new post is now live on BLOOM.INFIVE:</p>
                <p style="margin:0 0 20px;font-size:24px;line-height:1.35;color:#1b1b1b;font-family:Georgia,serif;"><strong>${title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</strong></p>
                <a href="${postUrl || blogUrl || siteUrl}" style="display:inline-block;background:#c5431b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:13px;">
                  Read Post
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
      `.trim();

      const activeSubs = await admin.firestore()
        .collection("subscribers")
        .where("status", "==", "active")
        .limit(500)
        .get();

      let sent = 0;
      let failed = 0;
      for (const docSnap of activeSubs.docs) {
        const d = docSnap.data() || {};
        const email = (d.email || "").toString().trim().toLowerCase();
        if (!email) continue;
        try {
          await sendGmail({ to: email, subject, text, html });
          sent += 1;
        } catch (e) {
          failed += 1;
          logger.error("post notification send failed", { postId, email, err: e?.message || String(e) });
        }
      }

      await postRef.set({
        notificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
        notificationInProgressAt: admin.firestore.FieldValue.delete(),
        notificationSentCount: sent,
        notificationFailedCount: failed,
      }, { merge: true });

      logger.info("Post notification complete", { postId, sent, failed });
    } catch (e) {
      logger.error("notifySubscribersOnPostPublished failed", e);
    }
  }
);

// Public endpoint used by the email unsubscribe button.
exports.unsubscribe = onRequest(async (req, res) => {
  try {
    const sid = (req.query.sid || "").toString();
    const token = (req.query.token || "").toString();

    if (!sid || !token) {
      res.status(400).send("Missing sid/token.");
      return;
    }

    const ref = admin.firestore().doc(`subscribers/${sid}`);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).send("Subscriber not found.");
      return;
    }

    const data = snap.data() || {};
    const expected = (data.unsubToken || "").toString();
    if (!expected) {
      res.status(400).send("Unsubscribe token not available for this subscriber.");
      return;
    }

    // Constant-time compare to avoid leaking token info.
    const ok = expected.length === token.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));

    if (!ok) {
      res.status(403).send("Invalid token.");
      return;
    }

    await ref.set(
      {
        status: "unsubscribed",
        unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`
      <!doctype html>
      <html lang="en">
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>Unsubscribed</title>
      <body style="font-family:Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6;">
        <h2 style="margin:0 0 10px;">You're unsubscribed.</h2>
        <p style="margin:0 0 18px;">You will no longer receive newsletter emails from BLOOM.INFIVE.</p>
        <p style="margin:0;"><a href="${(SITE_URL.value() || "").toString()}" style="color:#111;font-weight:700;">Return to the site</a></p>
      </body>
      </html>
    `.trim());
  } catch (e) {
    logger.error("unsubscribe failed:", e);
    res.status(500).send("Unsubscribe failed.");
  }
});
