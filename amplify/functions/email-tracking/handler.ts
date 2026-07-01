import type { Handler } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { getTrackingToken } from "../_shared/emailTracking";
import { appendLeadHistory, setActiveDynamo } from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";

/**
 * email-tracking — endpoint PÚBLICO (Function URL, sin auth) del tracking de email
 * (Fase 4 · F4.4). Dos rutas:
 *   GET /pixel?t=<token>        → registra `email_opened` (dedup por token) + GIF 1×1.
 *   GET /click?t=<token>&u=<url> → registra `email_clicked` + 302 al destino.
 * El golpe cae en el ledger del lead (Pilar 2) → sube el score (2A) → auto-enrola
 * en journeys por segmento (3C). Token inválido = no-op silencioso (anti-enumeración).
 */
const dynamo = new DynamoDBClient({});
const TRACKING_TABLE = process.env.EMAIL_TRACKING_TABLE || "connectview-email-tracking";

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
    const safe = /^https?:\/\//i.test(url) ? url : "";
    if (token && safe) {
      try {
        const rec = await getTrackingToken(dynamo, token);
        if (rec?.leadId) {
          await logTouch(rec.leadId, rec.tenantId, { type: "email_clicked", url: safe, token });
        }
      } catch (e) {
        console.error("click track error", e);
      }
    }
    if (safe) {
      return {
        statusCode: 302,
        headers: { Location: safe, "Cache-Control": "no-store" },
        body: "",
      };
    }
    return { statusCode: 404, body: "Not found" };
  }

  return { statusCode: 404, body: "Not found" };
};
