import type { Handler } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getTrackingToken } from "../_shared/emailTracking";
import { appendLeadHistory, setActiveDynamo } from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";

/**
 * email-tracking — endpoint PÚBLICO (Function URL, sin auth) del tracking de email
 * (Fase 4 · F4.4). Dos rutas:
 *   GET /pixel?t=<token>              → registra `email_opened` (dedup por token) + GIF 1×1.
 *   GET /click?t=<token>&u=<url>&s=<sig> → registra `email_clicked` + 302 al destino.
 * El golpe cae en el ledger del lead (Pilar 2) → sube el score (2A) → auto-enrola
 * en journeys por segmento (3C). Token inválido = no-op silencioso (anti-enumeración).
 *
 * SEC-A4 — open redirect: antes `/click` validaba SÓLO el esquema de `?u=`
 * (`/^https?:/`), no el host → `GET /click?u=https://evil` hacía 302 al sitio del
 * atacante (nuestro dominio como hop de phishing). Fix: el destino se FIRMA con
 * HMAC-SHA256 al generar el email (`buildTrackedHtml`); acá verificamos la firma
 * (`?s=`) constant-time antes de redirigir. Sin firma válida NO hay 302.
 */
const dynamo = new DynamoDBClient({});
const TRACKING_TABLE = process.env.EMAIL_TRACKING_TABLE || "connectview-email-tracking";
// Secreto server-side para firmar/verificar el destino del redirect (SEC-A4).
// DEBE ser el MISMO valor con el que `buildTrackedHtml` firma el link en el
// generador de emails (journey-runner / automation-engine). Ver nota de deploy.
const REDIRECT_SECRET = process.env.EMAIL_TRACKING_SECRET || process.env.VOX_INTERNAL_SECRET || "";

/** HMAC-SHA256 url-safe del destino (mismo esquema que el OAuth state de SF). */
function signRedirect(url: string): string {
  return createHmac("sha256", REDIRECT_SECRET).update(url).digest("base64url");
}

/** Verifica la firma del destino, constant-time. false si no hay secreto/firma o
 *  no coincide. */
function verifyRedirect(url: string, sig: string): boolean {
  if (!REDIRECT_SECRET || !sig) return false;
  const expected = signRedirect(url);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// GIF transparente 1×1 (43 bytes) — base64.
const PIXEL_B64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const pixelResponse = {
  statusCode: 200,
  headers: {
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
  },
  body: PIXEL_B64,
  isBase64Encoded: true,
};

/** Marca el token como abierto de forma atómica; true = primera apertura. */
async function markOpenedOnce(token: string): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TRACKING_TABLE,
        Key: { token: { S: token } },
        UpdateExpression: "SET openedAt = :n",
        ConditionExpression: "attribute_exists(#tk) AND attribute_not_exists(openedAt)",
        ExpressionAttributeNames: { "#tk": "token" },
        ExpressionAttributeValues: { ":n": { S: new Date().toISOString() } },
      }),
    );
    return true;
  } catch {
    return false; // ya abierto, o token inexistente
  }
}

async function logTouch(
  leadId: string,
  tenantId: string | undefined,
  ev: { type: "email_opened" | "email_clicked"; url?: string; token: string },
): Promise<void> {
  setActiveDynamo(dynamo);
  setActiveTenant(tenantId || null);
  await appendLeadHistory(leadId, {
    ts: new Date().toISOString(),
    type: ev.type,
    channel: "Correo",
    direction: "in",
    outcome: ev.type === "email_opened" ? "opened" : "clicked",
    url: ev.url,
    trackingToken: ev.token,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const path = String(event?.rawPath || event?.requestContext?.http?.path || "");
  const q = event?.queryStringParameters || {};
  const token = String(q.t || "");

  // ── /pixel — apertura ──
  if (path.endsWith("/pixel")) {
    if (token) {
      try {
        const rec = await getTrackingToken(dynamo, token);
        if (rec?.leadId && (await markOpenedOnce(token))) {
          await logTouch(rec.leadId, rec.tenantId, { type: "email_opened", token });
        }
      } catch (e) {
        console.error("pixel track error", e);
      }
    }
    return pixelResponse; // SIEMPRE devolvemos el pixel (no revelar validez)
  }

  // ── /click — click en link ──
  if (path.endsWith("/click")) {
    const url = String(q.u || "");
    const sig = String(q.s || "");
    // Esquema http(s): condición NECESARIA pero NO suficiente (era el bug SEC-A4).
    const wellFormed = /^https?:\/\//i.test(url) ? url : "";
    // SEC-A4: sólo redirigimos a un destino con firma HMAC válida. Modo degradado
    // (sin secreto configurado aún): caemos a la validación por esquema con warning,
    // para no romper los links de emails ya enviados mientras se despliega el secreto
    // + el generador firmado. Ver nota de deploy en la cabecera.
    let allowRedirect = wellFormed && verifyRedirect(url, sig);
    if (!allowRedirect && wellFormed && !REDIRECT_SECRET) {
      console.warn(
        "email-tracking: /click sin EMAIL_TRACKING_SECRET configurado — redirect aceptado en modo degradado (SEC-A4)",
      );
      allowRedirect = true;
    }
    // El golpe (email_clicked) se registra si el token es válido y la URL está bien
    // formada, aunque la firma no valide: el click ocurrió; sólo NO seguimos el 302.
    if (token && wellFormed) {
      try {
        const rec = await getTrackingToken(dynamo, token);
        if (rec?.leadId) {
          await logTouch(rec.leadId, rec.tenantId, {
            type: "email_clicked",
            url: wellFormed,
            token,
          });
        }
      } catch (e) {
        console.error("click track error", e);
      }
    }
    if (allowRedirect) {
      return {
        statusCode: 302,
        headers: { Location: wellFormed, "Cache-Control": "no-store" },
        body: "",
      };
    }
    // Destino ausente o firma inválida → no somos un redirector abierto.
    return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: "Invalid link" };
  }

  return { statusCode: 404, body: "Not found" };
};
