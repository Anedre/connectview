/**
 * emailTracking — tracking 1:1 de email estilo Pardot (Fase 4 · F4.4). Genera un
 * token por envío, inyecta un pixel de apertura y reescribe los links para pasar
 * por el redirect de tracking. La Lambda pública `email-tracking` resuelve el token
 * y registra `email_opened`/`email_clicked` como golpe en el ledger del lead (Pilar
 * 2) → sube el score (2A) → auto-enrola en journeys por segmento (3C). La parte de
 * HTML es PURA (testeable sin AWS).
 */
import { type DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomBytes } from "node:crypto";

const TRACKING_TABLE = process.env.EMAIL_TRACKING_TABLE || "connectview-email-tracking";
const TTL_DAYS = Number(process.env.EMAIL_TRACKING_TTL_DAYS || 30);

export interface EmailTrackingRecord {
  token: string;
  leadId: string;
  tenantId?: string;
  campaignId?: string;
  journeyId?: string;
  emailMessageId?: string;
  subject?: string;
  createdAt: string;
  /** TTL epoch (segundos) — DynamoDB limpia el registro solo. */
  expiresAt: number;
}

/** Token corto y url-safe (16 chars). */
export function newTrackingToken(): string {
  return randomBytes(12).toString("base64url");
}

/** Persiste el token → a quién/qué apunta (para que la Lambda pública lo resuelva). */
export async function storeTrackingToken(
  dynamo: DynamoDBClient,
  rec: Omit<EmailTrackingRecord, "createdAt" | "expiresAt">,
  nowMs: number = Date.now(),
): Promise<void> {
  const item: EmailTrackingRecord = {
    ...rec,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: Math.floor(nowMs / 1000) + TTL_DAYS * 86_400,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: TRACKING_TABLE,
      Item: marshall(item, { removeUndefinedValues: true }),
    }),
  );
}

export async function getTrackingToken(
  dynamo: DynamoDBClient,
  token: string,
): Promise<EmailTrackingRecord | null> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: TRACKING_TABLE, Key: { token: { S: token } } }),
  );
  return r.Item ? (unmarshall(r.Item) as EmailTrackingRecord) : null;
}

/**
 * Inyecta el pixel de apertura + reescribe los `<a href>` http(s) para pasar por
 * el redirect de click. PURA. `base` = Function URL de la Lambda email-tracking
 * (sin barra final). Si no hay base, devuelve el HTML sin tocar (no trackea).
 */
export function buildTrackedHtml(html: string, opts: { token: string; base: string }): string {
  const base = (opts.base || "").replace(/\/$/, "");
  if (!base || !opts.token) return html;
  const t = encodeURIComponent(opts.token);
  // 1) links http(s) → redirect de click (preserva el destino en ?u=)
  let out = html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_m, url) => `href="${base}/click?t=${t}&u=${encodeURIComponent(url)}"`,
  );
  // 2) pixel 1×1 al final del body (o del documento)
  const pixel = `<img src="${base}/pixel?t=${t}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden" />`;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
  return out;
}
