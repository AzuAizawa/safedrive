var SAFEDRIVE_EMAIL_WEBHOOK_VERSION = "2026-08-02.1";

function buildJsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  var configuredSecret = PropertiesService
    .getScriptProperties()
    .getProperty("SAFEDRIVE_WEBHOOK_SECRET");

  return buildJsonResponse({
    ok: true,
    service: "SafeDrive Gmail webhook",
    version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
    secretConfigured: Boolean(configuredSecret),
  });
}

function doPost(event) {
  try {
    var expectedSecret = PropertiesService
      .getScriptProperties()
      .getProperty("SAFEDRIVE_WEBHOOK_SECRET");

    if (!expectedSecret) {
      return buildJsonResponse({
        ok: false,
        error: "Webhook secret is not configured",
        version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
      });
    }

    var rawBody = event && event.postData ? event.postData.contents : "";
    var payload = JSON.parse(rawBody || "{}");

    if (payload.secret !== expectedSecret) {
      return buildJsonResponse({
        ok: false,
        error: "Unauthorized",
        version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
      });
    }

    var recipient = String(payload.to || "").trim();
    var subject = String(payload.subject || "").trim();
    var messageBody = String(payload.body || "").trim();
    var idempotencyKey = String(payload.idempotencyKey || "").trim();
    var validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!validEmail.test(recipient) || recipient.length > 254) {
      return buildJsonResponse({
        ok: false,
        error: "Invalid recipient",
        version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
      });
    }

    if (!subject || subject.length > 250) {
      return buildJsonResponse({
        ok: false,
        error: "Invalid subject",
        version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
      });
    }

    if (!messageBody || messageBody.length > 10000) {
      return buildJsonResponse({
        ok: false,
        error: "Invalid message body",
        version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
      });
    }

    var deliveryCache = CacheService.getScriptCache();
    var cacheKey = idempotencyKey
      ? "sent:" + Utilities.base64EncodeWebSafe(
          Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idempotencyKey)
        ).slice(0, 80)
      : "";
    if (cacheKey && deliveryCache.get(cacheKey) === "1") {
      return buildJsonResponse({
        ok: true,
        duplicateSuppressed: true,
        version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
      });
    }

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: messageBody,
      name: "SafeDrive Support",
    });

    if (cacheKey) {
      deliveryCache.put(cacheKey, "1", 21600);
    }

    return buildJsonResponse({
      ok: true,
      version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
    });
  } catch (error) {
    console.error(error);
    return buildJsonResponse({
      ok: false,
      error: "Email delivery failed",
      version: SAFEDRIVE_EMAIL_WEBHOOK_VERSION,
    });
  }
}
