// functions/index.js (CommonJS) - OAuth-only Gmail sending

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
const GMAIL_SENDER = defineString("GMAIL_SENDER");       // hello@bloominfive.blog
const GMAIL_CLIENT_ID = defineString("GMAIL_CLIENT_ID"); // xxx.apps.googleusercontent.com
const LEAD_MAGNET_PDF_URL = defineString("LEAD_MAGNET_PDF_URL");
const AMAZON_MOM_FAVORITES_URL = defineString("AMAZON_MOM_FAVORITES_URL", { default: "" });
const AMAZON_FAITH_FAVORITES_URL = defineString("AMAZON_FAITH_FAVORITES_URL", { default: "" });
const AMAZON_HOME_ROUTINE_URL = defineString("AMAZON_HOME_ROUTINE_URL", { default: "" });
const MOMLY_EARLY_ACCESS_URL = defineString("MOMLY_EARLY_ACCESS_URL", { default: "" });
const TEST_EMAIL_SEQUENCE_MODE = defineString("TEST_EMAIL_SEQUENCE_MODE", { default: "false" });
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

  msgParts.push(`From: "Bloom.inFive" <${GMAIL_SENDER.value()}>`);
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

const LEAD_MAGNET_SOURCE = "free-journal: Floreciendo en la Espera";
const LEAD_MAGNET_NAME = "Floreciendo en la Espera";
const LEAD_MAGNET_RATE_LIMIT = 5;
const LEAD_MAGNET_RATE_WINDOW_MS = 60 * 60 * 1000;
const SEQUENCE_LOCK_STALE_MS = 30 * 60 * 1000;
const SEQUENCE_EMAIL_SUBJECTS = {
  1: "Floreciendo en la Espera by Bloom.inFive - Journal Gratis",
  2: "Un pedacito de mi historia",
  3: "Para la mama que se siente cansada hoy",
  4: "Cosas sencillas que me ayudan como mama",
  5: "Estoy creando algo especial para mamas",
};
const SEQUENCE_DUE_DAYS = { 2: 2, 3: 4, 4: 6, 5: 7 };
const SEQUENCE_DUE_TEST_MINUTES = { 2: 2, 3: 4, 4: 6, 5: 7 };
const FALLBACK_AFFILIATE_URL = "https://bloominfive.blog/pages/affiliate.html";
const FALLBACK_MOMLY_URL = "https://bloominfive.blog/";
const DEFAULT_LEAD_MAGNET_EMAILS = {
  1: {
    subject: SEQUENCE_EMAIL_SUBJECTS[1],
    preheader: "Journal gratis de Bloom.inFive",
    buttonLabel: "Descargar mi journal",
    buttonUrl: "{downloadUrl}",
    bodyText: `
Hola {firstName},

Que alegria tenerte aqui! Gracias por unirte a este espacio donde hablamos de fe, motivacion y como vivir cada dia con proposito, incluso en medio del caos de la vida diaria.

Mi nombre es Angelika, y quiero compartir contigo todo lo que he aprendido caminando con Dios y tratando de equilibrar la maternidad, la familia y mis suenos.

Pronto recibiras inspiracion, tips practicos, reflexiones y algunas sorpresas que tengo preparadas para ti, pero hoy quiero empezar con algo simple.

Un pequeno recordatorio: No tienes que ser perfecta para crecer, para seguir, para florecer. Cada dia cuenta, y este es tu espacio seguro para hacerlo a tu ritmo.

Descarga tu journal gratis aqui:
{downloadUrl}

Me encantaria que me respondieras a este email o en Instagram contandome un poquito de ti: que te trajo aqui y que esperas encontrar en este espacio?

Gracias por estar aqui. Estoy emocionada de acompanarte en este camino.

Con carino,
Angelika
    `.trim(),
  },
  2: {
    subject: SEQUENCE_EMAIL_SUBJECTS[2],
    preheader: "Por que existe Bloom.inFive",
    buttonLabel: "",
    buttonUrl: "",
    bodyText: `
Hola {firstName},

Queria contarte rapidamente que es Bloom in Five y por que existe.

Este espacio nacio cuando Dios toco mi corazon y me quito el miedo de mostrar la vida tal como es: real, imperfecta, pero llena de proposito.

Somos una familia militar de cinco y entre mudanzas, temporadas dificiles y muchas transiciones, hemos aprendido que aun en lo incierto Dios sigue siendo fiel.

Bloom significa florecer donde Dios nos planta, incluso cuando no entendemos el proceso.

Por eso aqui comparto nuestra vida sin filtros, con amor y con la intencion de que otras personas puedan sentirse acompanadas, vistas y menos solas en su propio proceso.

Gracias por estar aqui.

Angelika
    `.trim(),
  },
  3: {
    subject: SEQUENCE_EMAIL_SUBJECTS[3],
    preheader: "Un recordatorio corto para hoy",
    buttonLabel: "",
    buttonUrl: "",
    bodyText: `
Hola {firstName},

Si hoy te sientes cansada, quiero recordarte algo sencillo: Dios no te esta pidiendo perfeccion. El te esta invitando a venir a El tal como estas.

A veces la maternidad se siente como una lista que nunca termina. Pero tu valor no esta en todo lo que logras hacer en un dia. Tu valor ya esta seguro en Dios.

Hoy intenta hacer una cosa pequena con amor: respirar profundo, orar en voz bajita, tomar agua, abrazar a tus hijos, o descansar sin culpa cinco minutos.

No estas atrasada. Estas caminando. Y aun en este dia, Dios esta contigo.

Con carino,
Angelika
    `.trim(),
  },
  4: {
    subject: SEQUENCE_EMAIL_SUBJECTS[4],
    preheader: "Favoritos sencillos para la rutina",
    buttonLabel: "",
    buttonUrl: "",
    bodyText: `
Hola {firstName},

Hoy queria compartirte algunas cosas sencillas que me ayudan como mama. No son cosas magicas, pero si pequenos apoyos que hacen la rutina un poquito mas ligera.

Favoritos para mama:
{momFavoritesUrl}

Favoritos de fe:
{faithFavoritesUrl}

Rutina y hogar:
{homeRoutineUrl}

Solo toma lo que te sirva en esta temporada. A veces lo pequeno tambien es una forma de cuidarnos.

Con carino,
Angelika
    `.trim(),
  },
  5: {
    subject: SEQUENCE_EMAIL_SUBJECTS[5],
    preheader: "Una invitacion suave para mamas",
    buttonLabel: "Ver acceso temprano",
    buttonUrl: "{momlyUrl}",
    bodyText: `
Hola {firstName},

Estoy creando algo especial para mamas: Momly.

La idea nacio de una necesidad muy real: tener un espacio que ayude a organizar la vida familiar sin perder de vista lo que mas importa.

Todavia esta creciendo, pero si te gustaria enterarte primero y ser parte del acceso temprano, puedes anotarte aqui:
{momlyUrl}

Gracias por caminar conmigo estos dias. Oro que este espacio siga siendo de animo, fe y compania para ti.

Con carino,
Angelika
    `.trim(),
  },
};

function escapeHtml(s) {
  return (s || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeEmail(email) {
  return (email || "").toString().trim().toLowerCase();
}

function cleanText(value, maxLen) {
  return (value || "")
    .toString()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function cleanMultiline(value, maxLen) {
  return (value || "")
    .toString()
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function randomTokenHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function isSequenceTestMode() {
  return ["1", "true", "yes", "on"].includes((TEST_EMAIL_SEQUENCE_MODE.value() || "").toString().trim().toLowerCase());
}

async function getLeadMagnetSequenceConfig() {
  try {
    const snap = await admin.firestore().doc("site/leadMagnetSequenceConfig").get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const links = data.links || {};
    const emails = data.emails || {};
    const mergedEmails = {};
    for (let i = 1; i <= 5; i += 1) {
      const saved = emails[i] || emails[String(i)] || {};
      mergedEmails[i] = {
        subject: cleanText(saved.subject || DEFAULT_LEAD_MAGNET_EMAILS[i].subject, 200),
        preheader: cleanText(saved.preheader || DEFAULT_LEAD_MAGNET_EMAILS[i].preheader, 220),
        buttonLabel: cleanText(
          typeof saved.buttonLabel === "string" ? saved.buttonLabel : DEFAULT_LEAD_MAGNET_EMAILS[i].buttonLabel,
          100
        ),
        buttonUrl: cleanText(
          typeof saved.buttonUrl === "string" ? saved.buttonUrl : DEFAULT_LEAD_MAGNET_EMAILS[i].buttonUrl,
          800
        ),
        bodyText: cleanMultiline(saved.bodyText || DEFAULT_LEAD_MAGNET_EMAILS[i].bodyText, 8000),
      };
    }

    return {
      testEmailSequenceMode: typeof data.testEmailSequenceMode === "boolean"
        ? data.testEmailSequenceMode
        : isSequenceTestMode(),
      pdfDownloadUrl: cleanText(data.pdfDownloadUrl || LEAD_MAGNET_PDF_URL.value() || "", 800),
      links: {
        momFavoritesUrl: cleanText(links.momFavoritesUrl || AMAZON_MOM_FAVORITES_URL.value() || FALLBACK_AFFILIATE_URL, 800),
        faithFavoritesUrl: cleanText(links.faithFavoritesUrl || AMAZON_FAITH_FAVORITES_URL.value() || FALLBACK_AFFILIATE_URL, 800),
        homeRoutineUrl: cleanText(links.homeRoutineUrl || AMAZON_HOME_ROUTINE_URL.value() || FALLBACK_AFFILIATE_URL, 800),
        momlyUrl: cleanText(links.momlyUrl || MOMLY_EARLY_ACCESS_URL.value() || FALLBACK_MOMLY_URL, 800),
      },
      emails: mergedEmails,
    };
  } catch (e) {
    logger.warn("lead magnet sequence config read failed", e);
    return {
      testEmailSequenceMode: isSequenceTestMode(),
      pdfDownloadUrl: cleanText(LEAD_MAGNET_PDF_URL.value() || "", 800),
      links: {
        momFavoritesUrl: cleanText(AMAZON_MOM_FAVORITES_URL.value() || FALLBACK_AFFILIATE_URL, 800),
        faithFavoritesUrl: cleanText(AMAZON_FAITH_FAVORITES_URL.value() || FALLBACK_AFFILIATE_URL, 800),
        homeRoutineUrl: cleanText(AMAZON_HOME_ROUTINE_URL.value() || FALLBACK_AFFILIATE_URL, 800),
        momlyUrl: cleanText(MOMLY_EARLY_ACCESS_URL.value() || FALLBACK_MOMLY_URL, 800),
      },
      emails: DEFAULT_LEAD_MAGNET_EMAILS,
    };
  }
}

function timestampFromDate(date) {
  return admin.firestore.Timestamp.fromDate(date);
}

function toDateFromTimestamp(ts, fallback = new Date()) {
  if (ts && typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date && !isNaN(ts.getTime())) return ts;
  return fallback;
}

function sequenceDueAt(startDate, emailNumber, testMode = isSequenceTestMode()) {
  const baseMs = toDateFromTimestamp(startDate).getTime();
  const offset = testMode
    ? (SEQUENCE_DUE_TEST_MINUTES[emailNumber] || 0) * 60 * 1000
    : (SEQUENCE_DUE_DAYS[emailNumber] || 0) * 24 * 60 * 60 * 1000;
  return timestampFromDate(new Date(baseMs + offset));
}

function unsubscribeUrlFor(normalizedEmail, unsubToken) {
  return normalizedEmail && unsubToken
    ? `${UNSUBSCRIBE_ENDPOINT}?sid=${encodeURIComponent(normalizedEmail)}&token=${encodeURIComponent(unsubToken)}`
    : "";
}

function getClientIp(req) {
  const forwarded = (req.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.ip || "";
}

function rateLimitId(ip, email) {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${email}`)
    .digest("hex");
}

function leadMagnetTemplateVars({ firstName, downloadUrl, unsubUrl, sequenceConfig }) {
  const links = sequenceConfig?.links || {};
  return {
    firstName: cleanText(firstName || "amiga", 60),
    downloadUrl: cleanText(downloadUrl || sequenceConfig?.pdfDownloadUrl || "", 800),
    unsubscribeUrl: cleanText(unsubUrl || "", 800),
    momFavoritesUrl: cleanText(links.momFavoritesUrl || AMAZON_MOM_FAVORITES_URL.value() || FALLBACK_AFFILIATE_URL, 800),
    faithFavoritesUrl: cleanText(links.faithFavoritesUrl || AMAZON_FAITH_FAVORITES_URL.value() || FALLBACK_AFFILIATE_URL, 800),
    homeRoutineUrl: cleanText(links.homeRoutineUrl || AMAZON_HOME_ROUTINE_URL.value() || FALLBACK_AFFILIATE_URL, 800),
    momlyUrl: cleanText(links.momlyUrl || MOMLY_EARLY_ACCESS_URL.value() || FALLBACK_MOMLY_URL, 800),
  };
}

function fillLeadMagnetTemplate(value, vars) {
  return (value || "").toString().replace(/\{(firstName|downloadUrl|unsubscribeUrl|momFavoritesUrl|faithFavoritesUrl|homeRoutineUrl|momlyUrl)\}/g, (_m, key) => {
    return vars[key] || "";
  });
}

function configuredEmailTemplate(emailNumber, sequenceConfig) {
  const saved = sequenceConfig?.emails?.[emailNumber] || sequenceConfig?.emails?.[String(emailNumber)] || {};
  return {
    ...DEFAULT_LEAD_MAGNET_EMAILS[emailNumber],
    ...saved,
  };
}

function configuredEmailSubject(emailNumber, sequenceConfig, vars) {
  const template = configuredEmailTemplate(emailNumber, sequenceConfig);
  return cleanText(fillLeadMagnetTemplate(template.subject || SEQUENCE_EMAIL_SUBJECTS[emailNumber], vars), 200);
}

function renderTextAsHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 16px;">${escapeHtml(part).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function configuredLeadMagnetEmail({ emailNumber, firstName, downloadUrl, unsubUrl, sequenceConfig }) {
  const template = configuredEmailTemplate(emailNumber, sequenceConfig);
  const vars = leadMagnetTemplateVars({ firstName, downloadUrl, unsubUrl, sequenceConfig });
  const subject = configuredEmailSubject(emailNumber, sequenceConfig, vars);
  const preheader = fillLeadMagnetTemplate(template.preheader || "", vars);
  const bodyText = fillLeadMagnetTemplate(template.bodyText || DEFAULT_LEAD_MAGNET_EMAILS[emailNumber].bodyText, vars);
  const buttonLabel = fillLeadMagnetTemplate(template.buttonLabel || "", vars).trim();
  const buttonUrl = fillLeadMagnetTemplate(template.buttonUrl || "", vars).trim();
  const safeTitle = escapeHtml(subject);
  const safePreheader = escapeHtml(preheader);
  const safeButtonLabel = escapeHtml(buttonLabel);
  const safeButtonUrl = escapeHtml(buttonUrl);
  const safeUnsubUrl = escapeHtml(vars.unsubscribeUrl);
  const ctaHtml = buttonLabel && buttonUrl
    ? `<p style="margin:0 0 24px;text-align:center;"><a href="${safeButtonUrl}" style="display:inline-block;background:#1f1f1f;color:#fff;text-decoration:none;padding:14px 24px;border-radius:6px;font-weight:800;font-size:15px;">${safeButtonLabel}</a></p>`
    : "";
  const footerText = emailNumber === 1
    ? "Recibes este email porque pediste el journal gratis de Bloom.inFive y te uniste a nuestras notas de inspiracion, recursos y actualizaciones."
    : "Recibes esta secuencia porque pediste el journal gratis de Bloom.inFive.";

  const text = `
${bodyText}

${buttonLabel && buttonUrl ? `${buttonLabel}: ${buttonUrl}` : ""}

${footerText}
${vars.unsubscribeUrl ? `Si ya no quieres recibir estos emails, puedes darte de baja aqui: ${vars.unsubscribeUrl}` : ""}
  `.trim();

  const html = `
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f7e6c4;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7e6c4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #ead9b8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#0f2a3a;padding:30px 24px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-family:Georgia,serif;font-size:28px;line-height:1.2;">${safeTitle}</h1>
                ${safePreheader ? `<p style="margin:10px 0 0;color:#f7e6c4;font-size:15px;">${safePreheader}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px;text-align:left;font-size:16px;line-height:1.7;color:#333;">
                ${renderTextAsHtml(bodyText)}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 28px;background:#eef4ea;text-align:center;border-top:1px solid #e3eadb;">
                <p style="margin:0;color:#4c4c4c;font-size:12px;line-height:1.7;">
                  ${escapeHtml(footerText)}
                  ${safeUnsubUrl ? `Si ya no quieres recibir estos emails, puedes <a href="${safeUnsubUrl}" style="color:#0f2a3a;text-decoration:underline;">darte de baja aqui</a>.` : ""}
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

  return { subject, text, html };
}

function leadMagnetEmail({ firstName, downloadUrl, unsubUrl, sequenceConfig }) {
  if (sequenceConfig?.emails) {
    return configuredLeadMagnetEmail({ emailNumber: 1, firstName, downloadUrl, unsubUrl, sequenceConfig });
  }

  const safeFirstName = escapeHtml(firstName);
  const safeDownloadUrl = escapeHtml(downloadUrl);
  const safeUnsubUrl = escapeHtml(unsubUrl);

  const text = `
Hola ${firstName},

Que alegria tenerte aqui! Gracias por unirte a este espacio donde hablamos de fe, motivacion y como vivir cada dia con proposito, incluso en medio del caos de la vida diaria.

Mi nombre es Angelika, y quiero compartir contigo todo lo que he aprendido caminando con Dios y tratando de equilibrar la maternidad, la familia y mis suenos.

Pronto recibiras inspiracion, tips practicos, reflexiones y algunas sorpresas que tengo preparadas para ti, pero hoy quiero empezar con algo simple.

Un pequeno recordatorio: No tienes que ser perfecta para crecer, para seguir, para florecer. Cada dia cuenta, y este es tu espacio seguro para hacerlo a tu ritmo.

Descarga tu journal gratis aqui:
${downloadUrl}

Me encantaria que me respondieras a este email o en Instagram contandome un poquito de ti: que te trajo aqui y que esperas encontrar en este espacio?

Gracias por estar aqui. Estoy emocionada de acompanarte en este camino.

Con carino,
Angelika

Recibes este email porque pediste el journal gratis de Bloom.inFive y te uniste a nuestras notas de inspiracion, recursos y actualizaciones.
${unsubUrl ? `Si ya no quieres recibir estos emails, puedes darte de baja aqui: ${unsubUrl}` : ""}
  `.trim();

  const html = `
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f7e6c4;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7e6c4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #ead9b8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#0f2a3a;padding:32px 24px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-family:Georgia,serif;font-size:30px;line-height:1.2;">Floreciendo en la Espera</h1>
                <p style="margin:10px 0 0;color:#f7e6c4;font-size:15px;">Journal gratis de Bloom.inFive</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px;text-align:left;">
                <p style="margin:0 0 16px;font-size:17px;line-height:1.7;color:#1b1b1b;">Hola ${safeFirstName},</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#333;">Que alegria tenerte aqui! Gracias por unirte a este espacio donde hablamos de fe, motivacion y como vivir cada dia con proposito, incluso en medio del caos de la vida diaria.</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#333;">Mi nombre es Angelika, y quiero compartir contigo todo lo que he aprendido caminando con Dios y tratando de equilibrar la maternidad, la familia y mis suenos.</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#333;">Pronto recibiras inspiracion, tips practicos, reflexiones y algunas sorpresas que tengo preparadas para ti, pero hoy quiero empezar con algo simple.</p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#333;"><strong>Un pequeno recordatorio:</strong> No tienes que ser perfecta para crecer, para seguir, para florecer. Cada dia cuenta, y este es tu espacio seguro para hacerlo a tu ritmo.</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${safeDownloadUrl}" style="display:inline-block;background:#1f1f1f;color:#fff;text-decoration:none;padding:14px 24px;border-radius:6px;font-weight:800;font-size:15px;">Descargar mi journal</a>
                </p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#333;">Me encantaria que me respondieras a este email o en Instagram contandome un poquito de ti: que te trajo aqui y que esperas encontrar en este espacio?</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#333;">Gracias por estar aqui. Estoy emocionada de acompanarte en este camino.</p>
                <p style="margin:0;font-size:16px;line-height:1.7;color:#333;">Con carino,<br/>Angelika</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 28px;background:#eef4ea;text-align:center;border-top:1px solid #e3eadb;">
                <p style="margin:0;color:#4c4c4c;font-size:12px;line-height:1.7;">
                  Recibes este email porque pediste el journal gratis de Bloom.inFive y te uniste a nuestras notas de inspiracion, recursos y actualizaciones.
                  ${safeUnsubUrl ? `Si ya no quieres recibir estos emails, puedes <a href="${safeUnsubUrl}" style="color:#0f2a3a;text-decoration:underline;">darte de baja aqui</a>.` : ""}
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

  return { text, html };
}

function sequenceEmailLayout({ title, preheader, bodyHtml, bodyText, unsubUrl }) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || "");
  const safeUnsubUrl = escapeHtml(unsubUrl || "");

  const text = `
${title}

${bodyText}

Si no deseas recibir estos emails, puedes darte de baja aqui:
${unsubUrl || "(enlace no disponible)"}
  `.trim();

  const html = `
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f7e6c4;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7e6c4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #ead9b8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#0f2a3a;padding:30px 24px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-family:Georgia,serif;font-size:28px;line-height:1.2;">${safeTitle}</h1>
                ${safePreheader ? `<p style="margin:10px 0 0;color:#f7e6c4;font-size:15px;">${safePreheader}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px;text-align:left;font-size:16px;line-height:1.7;color:#333;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 28px;background:#eef4ea;text-align:center;border-top:1px solid #e3eadb;">
                <p style="margin:0;color:#4c4c4c;font-size:12px;line-height:1.7;">
                  Si no deseas recibir estos emails, puedes ${safeUnsubUrl ? `<a href="${safeUnsubUrl}" style="color:#0f2a3a;text-decoration:underline;">darte de baja aqui</a>` : "darte de baja desde el enlace de tus emails"}.
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

  return { text, html };
}

function sequenceEmailTemplate(emailNumber, data) {
  if (data.sequenceConfig?.emails) {
    return configuredLeadMagnetEmail({
      emailNumber,
      firstName: data.firstName || "amiga",
      downloadUrl: data.sequenceConfig.pdfDownloadUrl || "",
      unsubUrl: data.unsubUrl || "",
      sequenceConfig: data.sequenceConfig,
    });
  }

  const firstName = cleanText(data.firstName || "amiga", 60);
  const safeFirstName = escapeHtml(firstName);
  const unsubUrl = data.unsubUrl || "";
  const linkStyle = "display:inline-block;background:#1f1f1f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:800;font-size:14px;margin:6px 6px 0 0;";

  if (emailNumber === 2) {
    const bodyText = `
Hola ${firstName},

Queria contarte rapidamente que es Bloom in Five y por que existe.

Este espacio nacio cuando Dios toco mi corazon y me quito el miedo de mostrar la vida tal como es: real, imperfecta, pero llena de proposito.

Somos una familia militar de cinco y entre mudanzas, temporadas dificiles y muchas transiciones, hemos aprendido que aun en lo incierto Dios sigue siendo fiel.

Bloom significa florecer donde Dios nos planta, incluso cuando no entendemos el proceso.

Por eso aqui comparto nuestra vida sin filtros, con amor y con la intencion de que otras personas puedan sentirse acompanadas, vistas y menos solas en su propio proceso.

Gracias por estar aqui.

Angelika
    `.trim();
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hola ${safeFirstName},</p>
      <p style="margin:0 0 16px;">Queria contarte rapidamente que es Bloom in Five y por que existe.</p>
      <p style="margin:0 0 16px;">Este espacio nacio cuando Dios toco mi corazon y me quito el miedo de mostrar la vida tal como es: real, imperfecta, pero llena de proposito.</p>
      <p style="margin:0 0 16px;">Somos una familia militar de cinco y entre mudanzas, temporadas dificiles y muchas transiciones, hemos aprendido que aun en lo incierto Dios sigue siendo fiel.</p>
      <p style="margin:0 0 16px;"><strong>Bloom</strong> significa florecer donde Dios nos planta, incluso cuando no entendemos el proceso.</p>
      <p style="margin:0 0 16px;">Por eso aqui comparto nuestra vida sin filtros, con amor y con la intencion de que otras personas puedan sentirse acompanadas, vistas y menos solas en su propio proceso.</p>
      <p style="margin:0;">Gracias por estar aqui.<br/>Angelika</p>
    `;
    return sequenceEmailLayout({ title: SEQUENCE_EMAIL_SUBJECTS[2], preheader: "Por que existe Bloom.inFive", bodyText, bodyHtml, unsubUrl });
  }

  if (emailNumber === 3) {
    const bodyText = `
Hola ${firstName},

Si hoy te sientes cansada, quiero recordarte algo sencillo: Dios no te esta pidiendo perfeccion. El te esta invitando a venir a El tal como estas.

A veces la maternidad se siente como una lista que nunca termina. Pero tu valor no esta en todo lo que logras hacer en un dia. Tu valor ya esta seguro en Dios.

Hoy intenta hacer una cosa pequena con amor: respirar profundo, orar en voz bajita, tomar agua, abrazar a tus hijos, o descansar sin culpa cinco minutos.

No estas atrasada. Estas caminando. Y aun en este dia, Dios esta contigo.

Con carino,
Angelika
    `.trim();
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hola ${safeFirstName},</p>
      <p style="margin:0 0 16px;">Si hoy te sientes cansada, quiero recordarte algo sencillo: Dios no te esta pidiendo perfeccion. El te esta invitando a venir a El tal como estas.</p>
      <p style="margin:0 0 16px;">A veces la maternidad se siente como una lista que nunca termina. Pero tu valor no esta en todo lo que logras hacer en un dia. Tu valor ya esta seguro en Dios.</p>
      <p style="margin:0 0 16px;">Hoy intenta hacer una cosa pequena con amor: respirar profundo, orar en voz bajita, tomar agua, abrazar a tus hijos, o descansar sin culpa cinco minutos.</p>
      <p style="margin:0;">No estas atrasada. Estas caminando. Y aun en este dia, Dios esta contigo.<br/><br/>Con carino,<br/>Angelika</p>
    `;
    return sequenceEmailLayout({ title: SEQUENCE_EMAIL_SUBJECTS[3], preheader: "Un recordatorio corto para hoy", bodyText, bodyHtml, unsubUrl });
  }

  if (emailNumber === 4) {
    const momUrl = AMAZON_MOM_FAVORITES_URL.value() || "https://bloominfive.blog/pages/affiliate.html";
    const faithUrl = AMAZON_FAITH_FAVORITES_URL.value() || "https://bloominfive.blog/pages/affiliate.html";
    const routineUrl = AMAZON_HOME_ROUTINE_URL.value() || "https://bloominfive.blog/pages/affiliate.html";
    const bodyText = `
Hola ${firstName},

Hoy queria compartirte algunas cosas sencillas que me ayudan como mama. No son cosas magicas, pero si pequenos apoyos que hacen la rutina un poquito mas ligera.

Favoritos para mama:
${momUrl}

Favoritos de fe:
${faithUrl}

Rutina y hogar:
${routineUrl}

Solo toma lo que te sirva en esta temporada. A veces lo pequeno tambien es una forma de cuidarnos.

Con carino,
Angelika
    `.trim();
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hola ${safeFirstName},</p>
      <p style="margin:0 0 16px;">Hoy queria compartirte algunas cosas sencillas que me ayudan como mama. No son cosas magicas, pero si pequenos apoyos que hacen la rutina un poquito mas ligera.</p>
      <p style="margin:0 0 18px;">
        <a href="${escapeHtml(momUrl)}" style="${linkStyle}">Favoritos para mama</a>
        <a href="${escapeHtml(faithUrl)}" style="${linkStyle}">Favoritos de fe</a>
        <a href="${escapeHtml(routineUrl)}" style="${linkStyle}">Rutina y hogar</a>
      </p>
      <p style="margin:0;">Solo toma lo que te sirva en esta temporada. A veces lo pequeno tambien es una forma de cuidarnos.<br/><br/>Con carino,<br/>Angelika</p>
    `;
    return sequenceEmailLayout({ title: SEQUENCE_EMAIL_SUBJECTS[4], preheader: "Favoritos sencillos para la rutina", bodyText, bodyHtml, unsubUrl });
  }

  if (emailNumber === 5) {
    const momlyUrl = MOMLY_EARLY_ACCESS_URL.value() || "https://bloominfive.blog/";
    const bodyText = `
Hola ${firstName},

Estoy creando algo especial para mamas: Momly.

La idea nacio de una necesidad muy real: tener un espacio que ayude a organizar la vida familiar sin perder de vista lo que mas importa.

Todavia esta creciendo, pero si te gustaria enterarte primero y ser parte del acceso temprano, puedes anotarte aqui:
${momlyUrl}

Gracias por caminar conmigo estos dias. Oro que este espacio siga siendo de animo, fe y compania para ti.

Con carino,
Angelika
    `.trim();
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hola ${safeFirstName},</p>
      <p style="margin:0 0 16px;">Estoy creando algo especial para mamas: <strong>Momly</strong>.</p>
      <p style="margin:0 0 16px;">La idea nacio de una necesidad muy real: tener un espacio que ayude a organizar la vida familiar sin perder de vista lo que mas importa.</p>
      <p style="margin:0 0 20px;">Todavia esta creciendo, pero si te gustaria enterarte primero y ser parte del acceso temprano, puedes anotarte aqui:</p>
      <p style="margin:0 0 20px;text-align:center;"><a href="${escapeHtml(momlyUrl)}" style="${linkStyle}">Ver acceso temprano</a></p>
      <p style="margin:0;">Gracias por caminar conmigo estos dias. Oro que este espacio siga siendo de animo, fe y compania para ti.<br/><br/>Con carino,<br/>Angelika</p>
    `;
    return sequenceEmailLayout({ title: SEQUENCE_EMAIL_SUBJECTS[5], preheader: "Una invitacion suave para mamas", bodyText, bodyHtml, unsubUrl });
  }

  throw new Error(`Unknown sequence email number: ${emailNumber}`);
}

async function checkLeadMagnetRateLimit(req, normalizedEmail) {
  const ip = getClientIp(req);
  const id = rateLimitId(ip, normalizedEmail);
  const ref = admin.firestore().doc(`leadMagnetRateLimits/${id}`);
  const now = Date.now();

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() || {}) : {};
    const windowStartMs = current.windowStart?.toMillis ? current.windowStart.toMillis() : 0;
    const count = windowStartMs && (now - windowStartMs) < LEAD_MAGNET_RATE_WINDOW_MS
      ? Number(current.count || 0)
      : 0;

    if (count >= LEAD_MAGNET_RATE_LIMIT) {
      throw new Error("rate-limit");
    }

    tx.set(ref, {
      count: count + 1,
      windowStart: count ? current.windowStart : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

exports.subscribeLeadMagnet = onRequest(
  {
    secrets: [GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
    region: "us-central1",
  },
  async (req, res) => {
    const origin = req.get("origin") || "";
    const allowedOrigins = new Set([
      "https://bloominfive.blog",
      "https://www.bloominfive.blog",
      "http://localhost:5000",
      "http://127.0.0.1:5000",
    ]);
    res.set("Access-Control-Allow-Origin", allowedOrigins.has(origin) ? origin : "https://bloominfive.blog");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Metodo no permitido." });
      return;
    }

    try {
      const body = req.body || {};
      const firstName = cleanText(body.firstName, 60);
      const lastName = cleanText(body.lastName, 80);
      const email = cleanText(body.email, 254);
      const normalizedEmail = normalizeEmail(email);
      const userAgent = cleanText(body.userAgent || req.get("user-agent") || "", 220);
      const pageUrl = cleanText(body.pageUrl, 500);
      const sequenceConfig = await getLeadMagnetSequenceConfig();
      const pdfUrl = (sequenceConfig.pdfDownloadUrl || "").toString().trim();

      if (!firstName) {
        res.status(400).json({ ok: false, message: "Escribe tu nombre para enviarte el journal." });
        return;
      }

      if (!isValidEmail(normalizedEmail)) {
        res.status(400).json({ ok: false, message: "Escribe un email valido." });
        return;
      }

      if (!pdfUrl) {
        logger.error("LEAD_MAGNET_PDF_URL is not configured");
        res.status(500).json({ ok: false, message: "La guia todavia no esta configurada. Intentalo mas tarde." });
        return;
      }

      try {
        await checkLeadMagnetRateLimit(req, normalizedEmail);
      } catch (e) {
        if (e?.message === "rate-limit") {
          res.status(429).json({ ok: false, message: "Recibimos varias solicitudes. Intentalo de nuevo mas tarde." });
          return;
        }
        throw e;
      }

      const leadRef = admin.firestore().doc(`leadMagnetSubscribers/${normalizedEmail}`);
      const subRef = admin.firestore().doc(`subscribers/${normalizedEmail}`);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const newsletterToken = randomTokenHex(16);
      let shouldSend = false;
      let unsubToken = "";

      await admin.firestore().runTransaction(async (tx) => {
        const [leadSnap, subSnap] = await Promise.all([tx.get(leadRef), tx.get(subRef)]);
        const leadData = leadSnap.exists ? (leadSnap.data() || {}) : {};
        const subData = subSnap.exists ? (subSnap.data() || {}) : {};

        shouldSend = !leadData.emailSentAt && !leadData.emailSendInProgressAt;
        unsubToken = (subData.unsubToken || newsletterToken).toString();

        tx.set(leadRef, {
          firstName,
          lastName,
          email,
          normalizedEmail,
          source: LEAD_MAGNET_SOURCE,
          leadMagnetName: LEAD_MAGNET_NAME,
          status: "active",
          consent: true,
          userAgent,
          pageUrl,
          subscribedAt: leadData.subscribedAt || now,
          updatedAt: now,
          ...(shouldSend ? { emailSendInProgressAt: now } : {}),
        }, { merge: true });

        tx.set(subRef, {
          email: normalizedEmail,
          status: "active",
          source: subData.source || "site-newsletter",
          leadMagnetSource: LEAD_MAGNET_SOURCE,
          createdAt: subData.createdAt || now,
          updatedAt: now,
          welcomeEmailSentAt: subData.welcomeEmailSentAt || now,
          unsubToken,
        }, { merge: true });
      });

      if (shouldSend) {
        const unsubUrl = unsubToken
          ? unsubscribeUrlFor(normalizedEmail, unsubToken)
          : "";
        const emailRender = leadMagnetEmail({ firstName, downloadUrl: pdfUrl, unsubUrl, sequenceConfig });
        const subject = emailRender.subject || SEQUENCE_EMAIL_SUBJECTS[1];
        const { text, html } = emailRender;

        try {
          await sendGmail({ to: normalizedEmail, subject, text, html });
          const sequenceStartedAt = new Date();
          const sequenceStartedAtTs = timestampFromDate(sequenceStartedAt);
          await leadRef.set({
            emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            emailSendInProgressAt: admin.firestore.FieldValue.delete(),
            emailSendError: admin.firestore.FieldValue.delete(),
            sequenceStatus: "active",
            sequenceHasFailure: false,
            sequenceStartedAt: sequenceStartedAtTs,
            lastSequenceEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            nextSequenceEmailNumber: 2,
            nextSequenceEmailDueAt: sequenceDueAt(sequenceStartedAt, 2, sequenceConfig.testEmailSequenceMode),
            emailsSent: {
              1: {
                subject,
                status: "sent",
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
          }, { merge: true });
        } catch (e) {
          await leadRef.set({
            emailSendInProgressAt: admin.firestore.FieldValue.delete(),
            emailSendError: cleanText(e?.message || String(e), 500),
            emailSendFailedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          throw e;
        }
      }

      res.status(200).json({
        ok: true,
        message: "Listo. Revisa tu email y encontraras tu journal.",
      });
    } catch (e) {
      logger.error("subscribeLeadMagnet failed", e);
      res.status(500).json({ ok: false, message: "No pudimos completar tu suscripcion. Intentalo otra vez." });
    }
  }
);

async function acquireSequenceEmail(ref, nowDate, sequenceConfig) {
  const nowTs = timestampFromDate(nowDate);
  let acquired = null;

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data() || {};
    const normalizedEmail = (data.normalizedEmail || data.email || ref.id).toString().trim().toLowerCase();
    const sequenceStatus = (data.sequenceStatus || "").toString();
    const emailNumber = Number(data.nextSequenceEmailNumber || 0);
    const dueAt = data.nextSequenceEmailDueAt;

    if (sequenceStatus !== "active") return;
    if (emailNumber < 2 || emailNumber > 5) return;
    if (!dueAt || !dueAt.toMillis || dueAt.toMillis() > nowDate.getTime()) return;

    const sentEntry = ((data.emailsSent || {})[emailNumber] || {});
    if (sentEntry.status === "sent") {
      const nextNumber = emailNumber + 1;
      tx.set(ref, nextNumber > 5 ? {
        sequenceStatus: "completed",
        nextSequenceEmailNumber: admin.firestore.FieldValue.delete(),
        nextSequenceEmailDueAt: admin.firestore.FieldValue.delete(),
        updatedAt: nowTs,
      } : {
        nextSequenceEmailNumber: nextNumber,
        nextSequenceEmailDueAt: sequenceDueAt(data.sequenceStartedAt || nowDate, nextNumber, sequenceConfig.testEmailSequenceMode),
        updatedAt: nowTs,
      }, { merge: true });
      return;
    }

    if (sentEntry.status === "sending") {
      const startedMs = sentEntry.startedAt?.toMillis ? sentEntry.startedAt.toMillis() : 0;
      if (startedMs && (nowDate.getTime() - startedMs) < SEQUENCE_LOCK_STALE_MS) return;
    }

    const subRef = admin.firestore().doc(`subscribers/${normalizedEmail}`);
    const subSnap = await tx.get(subRef);
    const subData = subSnap.exists ? (subSnap.data() || {}) : {};
    const unsubToken = (subData.unsubToken || randomTokenHex(16)).toString();

    if ((subData.status || "") === "unsubscribed") {
      tx.set(ref, {
        sequenceStatus: "unsubscribed",
        updatedAt: nowTs,
      }, { merge: true });
      return;
    }

    if (!subData.unsubToken) {
      tx.set(subRef, {
        email: normalizedEmail,
        status: subData.status || "active",
        source: subData.source || "site-newsletter",
        createdAt: subData.createdAt || nowTs,
        updatedAt: nowTs,
        unsubToken,
      }, { merge: true });
    }

    const subjectVars = leadMagnetTemplateVars({
      firstName: data.firstName || "amiga",
      downloadUrl: sequenceConfig.pdfDownloadUrl || "",
      unsubUrl: unsubscribeUrlFor(normalizedEmail, unsubToken),
      sequenceConfig,
    });
    const subject = configuredEmailSubject(emailNumber, sequenceConfig, subjectVars);
    tx.update(ref, {
      [`emailsSent.${emailNumber}`]: {
        subject,
        status: "sending",
        startedAt: nowTs,
      },
      updatedAt: nowTs,
    });

    acquired = {
      ref,
      data,
      normalizedEmail,
      emailNumber,
      subject,
      unsubToken,
    };
  });

  return acquired;
}

async function markSequenceEmailSent(acquired, sentAtDate, sequenceConfig) {
  const sentAt = timestampFromDate(sentAtDate);
  const emailNumber = acquired.emailNumber;
  const nextNumber = emailNumber + 1;
  const patch = {
    [`emailsSent.${emailNumber}`]: {
      subject: acquired.subject,
      status: "sent",
      sentAt,
    },
    lastSequenceEmailSentAt: sentAt,
    updatedAt: sentAt,
  };

  if (nextNumber > 5) {
    patch.sequenceStatus = "completed";
    patch.nextSequenceEmailNumber = admin.firestore.FieldValue.delete();
    patch.nextSequenceEmailDueAt = admin.firestore.FieldValue.delete();
  } else {
    patch.nextSequenceEmailNumber = nextNumber;
    patch.nextSequenceEmailDueAt = sequenceDueAt(acquired.data.sequenceStartedAt || sentAtDate, nextNumber, sequenceConfig.testEmailSequenceMode);
  }

  await acquired.ref.update(patch);
}

async function markSequenceEmailFailed(acquired, error) {
  const nowTs = admin.firestore.FieldValue.serverTimestamp();
  await acquired.ref.update({
    [`emailsSent.${acquired.emailNumber}`]: {
      subject: acquired.subject,
      status: "failed",
      failedAt: nowTs,
      error: cleanText(error?.message || String(error), 500),
    },
    sequenceHasFailure: true,
    updatedAt: nowTs,
  });
}

exports.sendLeadMagnetSequenceEmails = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "us-central1",
    secrets: [GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN],
  },
  async () => {
    const nowDate = new Date();
    const dueNow = timestampFromDate(nowDate);
    const sequenceConfig = await getLeadMagnetSequenceConfig();
    const snap = await admin.firestore()
      .collection("leadMagnetSubscribers")
      .where("nextSequenceEmailDueAt", "<=", dueNow)
      .limit(50)
      .get();

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const docSnap of snap.docs) {
      const acquired = await acquireSequenceEmail(docSnap.ref, nowDate, sequenceConfig);
      if (!acquired) {
        skipped += 1;
        continue;
      }

      try {
        const unsubUrl = unsubscribeUrlFor(acquired.normalizedEmail, acquired.unsubToken);
        const { text, html } = sequenceEmailTemplate(acquired.emailNumber, {
          ...acquired.data,
          unsubUrl,
          sequenceConfig,
        });
        await sendGmail({
          to: acquired.normalizedEmail,
          subject: acquired.subject,
          text,
          html,
        });
        await markSequenceEmailSent(acquired, new Date(), sequenceConfig);
        sent += 1;
      } catch (e) {
        failed += 1;
        logger.error("lead magnet sequence send failed", {
          email: acquired.normalizedEmail,
          emailNumber: acquired.emailNumber,
          err: e?.message || String(e),
        });
        await markSequenceEmailFailed(acquired, e);
      }
    }

    logger.info("Lead magnet sequence run complete", { due: snap.size, sent, skipped, failed });
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

    const leadRef = admin.firestore().doc(`leadMagnetSubscribers/${sid}`);
    const leadSnap = await leadRef.get();
    if (leadSnap.exists) {
      await leadRef.set({
        sequenceStatus: "unsubscribed",
        status: "unsubscribed",
        unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

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
