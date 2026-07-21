import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  BatchWriteItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * audit-log — colector central de auditoría para pruebas en vivo. Recibe eventos
 * del frontend (errores JS/red/softphone de CUALQUIER PC) y del backend, y los
 * guarda en `connectview-audit` (TTL 7 días). Un GET los devuelve para el panel
 * `/audit`. Function URL pública (auth NONE) — es telemetría de prueba, sin datos
 * sensibles; se puede apagar borrando la función tras la prueba.
 *
 *   POST { sessionId, source, events:[{ts,level,kind,message,detail?}] }
 *   GET  ?sessionId=<id>   → eventos de esa sesión (más nuevos primero)
 *   GET  ?limit=N          → últimos N de todas las sesiones (default 200)
 */
const dynamo = new DynamoDBClient({});
const TABLE = process.env.AUDIT_TABLE || "connectview-audit";
// OJO: NO poner Access-Control-Allow-Origin aquí — el CORS lo maneja la
// Function URL (AllowOrigins=*). Si el handler también lo pone, AWS concatena
// ambos ("*, https://…") y el navegador rechaza la respuesta. Mismo patrón
// que el resto de Lambdas con Function URL del proyecto.
const CORS: Record<string, string> = {
  "Content-Type": "application/json",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || (event?.body ? "POST" : "GET");
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  try {
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const sessionId = String(body.sessionId || "unknown").slice(0, 120);
      const source = String(body.source || "frontend").slice(0, 80);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
      if (events.length === 0) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, saved: 0 }) };
      }
      const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
      let saved = 0;
      for (let i = 0; i < events.length; i += 25) {
        const chunk = events.slice(i, i + 25);
        const puts = chunk.map((e, j) => {
          const ts = String(e.ts || new Date().toISOString());
          const seq = `${ts}#${(i + j).toString().padStart(4, "0")}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const item: Record<string, any> = {
            sessionId: { S: sessionId },
            seq: { S: seq },
            ts: { S: ts },
            source: { S: source },
            level: { S: String(e.level || "info").slice(0, 12) },
            kind: { S: String(e.kind || "log").slice(0, 24) },
            message: { S: String(e.message ?? "").slice(0, 4000) || "(vacío)" },
            expiresAt: { N: String(ttl) },
          };
          if (e.detail !== undefined) {
            try {
              item.detail = { S: JSON.stringify(e.detail).slice(0, 12000) };
            } catch {
              item.detail = { S: String(e.detail).slice(0, 4000) };
            }
          }
          return { PutRequest: { Item: item } };
        });
        await dynamo.send(new BatchWriteItemCommand({ RequestItems: { [TABLE]: puts } }));
        saved += chunk.length;
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, saved }) };
    }

    // GET — panel /audit
    const qs = event?.queryStringParameters || {};
    const limit = Math.min(1000, Math.max(1, parseInt(qs.limit, 10) || 300));
    let items: Record<string, unknown>[] = [];
    if (qs.sessionId) {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "sessionId = :s",
          ExpressionAttributeValues: { ":s": { S: String(qs.sessionId) } },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );
      items = (r.Items || []).map((i) => unmarshall(i));
    } else {
      // BUG-audit P2: paginar completo (antes truncaba a 1 página / Limit 1000).
      // Sin el bucle devolvíamos un subconjunto por orden de hash, no los más
      // recientes. Acumulamos TODAS las páginas y recién ahí ordenamos por ts desc.
      // NOTA: si el volumen creciera mucho, lo ideal sería un GSI por timestamp
      // (el Scan completo se encarece); hoy es telemetría de prueba con TTL 7 días.
      const all: Record<string, unknown>[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const r = await dynamo.send(
          new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }),
        );
        for (const i of r.Items || []) all.push(unmarshall(i));
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      items = all
        .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
        .slice(0, limit);
    }
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, count: items.length, events: items }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    };
  }
};
