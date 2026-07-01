import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { appendMlInbound, type MlContext } from "../_shared/conversations";
import { parseNotification, resourceKind, mlGet, resolveMlSecret } from "../_shared/mercadolibre";

/**
 * mercadolibre-webhook — inbound de Mercado Libre (F4.1). ML manda un POST
 * `{ resource, user_id, topic }` cuando llega una PREGUNTA (topic `questions`) o
 * un MENSAJE post-venta (topic `messages`). Respondemos 200 rápido (ML reintenta
 * si no), luego hacemos GET del `resource` con el token del tenant y volcamos el
 * texto en el inbox omnicanal (`connectview-conversations`) vía `appendMlInbound`.
 * El agente responde por `manage-conversations` (POST /answers o /messages/packs).
 *
 * Tenant por seller user_id (scan connections `configJson.mercadolibre.userId`).
 * Build-ahead: la validación de firma queda como TODO (necesita el app secret del
 * cliente). Deploy: `deploy-lambda.mjs mercadolibre-webhook` + Function URL pública.
 *
 * Docs: https://developers.mercadolibre.com.ar/en_us/products-receive-notifications
 */
const legacyDynamo = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";

const JSON200 = (b: unknown = { ok: true }) => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(b),
});

/** Tenant cuyo `mercadolibre.userId` (seller) matchea el user_id de la notificación. */
async function findTenant(sellerUserId: string): Promise<{ tenantId: string } | null> {
  if (!sellerUserId) return null;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await legacyDynamo.send(
      new ScanCommand({ TableName: CONNECTIONS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) {
      const row = unmarshall(it) as { tenantId?: string; configJson?: string };
      try {
        const cfg = JSON.parse(row.configJson || "{}");
        if (String(cfg.mercadolibre?.userId || "") === sellerUserId)
          return { tenantId: row.tenantId || "" };
      } catch {
        /* configJson inválido */
      }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

/** Extrae { text, buyerId, itemId } de una PREGUNTA (GET /questions/<id>). */
function fromQuestion(
  q: Record<string, unknown>,
  ctx: MlContext,
): { text: string; buyerId: string; ml: MlContext } | null {
  const text = typeof q.text === "string" ? q.text : "";
  const from = (q.from as { id?: unknown }) || {};
  const buyerId = from.id != null ? String(from.id) : "";
  if (!text || !buyerId) return null;
  return {
    text,
    buyerId,
    ml: { ...ctx, itemId: typeof q.item_id === "string" ? q.item_id : undefined },
  };
}

/** Extrae el último mensaje del comprador de un pack (GET /messages/packs/…). */
function fromMessages(
  data: Record<string, unknown>,
  ctx: MlContext,
): { text: string; buyerId: string; ml: MlContext } | null {
  const sellerId = ctx.sellerId || "";
  const msgs = Array.isArray(data.messages) ? (data.messages as Record<string, unknown>[]) : [];
  // El último mensaje cuyo emisor NO es el seller = lo que escribió el comprador.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const from = (msgs[i].from as { user_id?: unknown }) || {};
    const fromId = from.user_id != null ? String(from.user_id) : "";
    const text = typeof msgs[i].text === "string" ? (msgs[i].text as string) : "";
    if (fromId && fromId !== sellerId && text) {
      return { text, buyerId: fromId, ml: { ...ctx, buyerId: fromId } };
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  // ML no hace el challenge-echo de Meta; un GET de prueba solo espera 200.
  if (method === "GET") return JSON200({ ok: true, service: "mercadolibre-webhook" });

  let body: unknown = {};
  try {
    body = JSON.parse(event?.body || "{}");
  } catch {
    /* cuerpo inválido → igual respondemos 200 (no reintentar basura) */
  }

  const note = parseNotification(body);
  if (!note) return JSON200({ ok: true, ignored: "sin resource/topic" });

  // TODO(cliente): validar la firma / el origen de la notificación (necesita el
  // app secret de la OAuth App de ML). Hoy confiamos en la URL secreta del webhook.

  try {
    const ctx = resourceKind(note.resource);
    if (!ctx) return JSON200({ ok: true, ignored: `topic no soportado: ${note.topic}` });

    const t = await findTenant(note.userId);
    if (!t?.tenantId) {
      console.log(`ML inbound sin tenant para seller=${note.userId} (${note.resource})`);
      return JSON200({ ok: true, ignored: "tenant no encontrado" });
    }

    const secret = await resolveMlSecret(t.tenantId);
    if (!secret?.accessToken) {
      console.log(`ML inbound sin token para tenant=${t.tenantId}`);
      return JSON200({ ok: true, ignored: "tenant sin token ML" });
    }

    const data = (await mlGet(secret.accessToken, note.resource)) as Record<string, unknown>;
    const parsed =
      ctx.kind === "question"
        ? fromQuestion(data, { ...ctx, sellerId: note.userId })
        : fromMessages(data, { ...ctx, sellerId: ctx.sellerId || note.userId });

    if (!parsed) return JSON200({ ok: true, ignored: "sin texto de comprador" });

    await appendMlInbound(legacyDynamo, {
      buyerId: parsed.buyerId,
      text: parsed.text,
      ml: parsed.ml,
      tenantId: t.tenantId,
    });
    console.log(
      `ML inbound: ${ctx.kind} buyer=${parsed.buyerId} tenant=${t.tenantId} (${note.resource})`,
    );
  } catch (e) {
    // Nunca fallamos la respuesta: 200 igual (ML reintenta si ve error).
    console.error("mercadolibre-webhook error:", (e as Error).message);
  }
  return JSON200();
};
