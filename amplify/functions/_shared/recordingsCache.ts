/**
 * recordingsCache — caché de acceso rápido (DynamoDB) para el historial de
 * Grabaciones (#perf Nivel 3). Evita el trabajo pesado de get-contact-history
 * (Customer Profiles + DescribeUser/DescribeQueue) en lecturas repetidas.
 *
 * Tablas (cuenta Novasys, us-east-1):
 *   - connectview-recordings-cache: pk=`<instanceId>#<phone>`, sk=`<contactId>` |
 *     `_meta`. Cada contacto se guarda como JSON en `j`. `_meta` lleva `cachedAt`.
 *   - connectview-name-cache: pk=`<instanceId>#<id>`, `name` — nombres de
 *     agente/cola RESUELTOS, persistentes (el caché en memoria del Lambda se
 *     perdía en cada cold start; este sobrevive).
 *
 * Usa @aws-sdk/client-dynamodb crudo (provisto por el runtime nodejs20); NO
 * depende de @aws-sdk/lib-dynamodb. Todo es best-effort: si DynamoDB falla,
 * devuelve null/no-op y el caller cae al camino lento (nunca rompe la pantalla).
 */
import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { gzipSync, gunzipSync } from "node:zlib";

const ddb = new DynamoDBClient({ maxAttempts: 2 });
const RECORDINGS_TABLE = process.env.RECORDINGS_CACHE_TABLE || "connectview-recordings-cache";
const NAME_TABLE = process.env.NAME_CACHE_TABLE || "connectview-name-cache";
const FRESH_MS = 10 * 60 * 1000; // 10 min de frescura para el historial cacheado
const HARD_TTL_S = 24 * 60 * 60; // 24h: DynamoDB borra el item (limpieza)
const NAME_TTL_S = 7 * 24 * 60 * 60; // nombres: 7 días

/** Lee el historial cacheado de un teléfono. null = miss o caché vieja → el
 *  caller debe recalcular. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readRecordingsCache(tenant: string, phone: string): Promise<any[] | null> {
  if (!tenant || !phone) return null;
  try {
    const pk = `${tenant}#${phone}`;
    const res = await ddb.send(
      new QueryCommand({
        TableName: RECORDINGS_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: pk } },
      })
    );
    const items = res.Items || [];
    if (items.length === 0) return null;
    const meta = items.find((i) => i.sk?.S === "_meta");
    const cachedAt = meta?.cachedAt?.N ? Number(meta.cachedAt.N) : 0;
    if (!cachedAt || Date.now() - cachedAt > FRESH_MS) return null; // stale → miss
    return items
      .filter((i) => i.sk?.S !== "_meta" && i.j?.S)
      .map((i) => JSON.parse(i.j!.S!));
  } catch (e) {
    console.warn("readRecordingsCache failed:", (e as Error)?.message || e);
    return null;
  }
}

/** Guarda el historial de un teléfono (best-effort, fire-and-forget). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeRecordingsCache(tenant: string, phone: string, contacts: any[]): Promise<void> {
  if (!tenant || !phone || !Array.isArray(contacts)) return;
  try {
    const pk = `${tenant}#${phone}`;
    const ttl = Math.floor(Date.now() / 1000) + HARD_TTL_S;
    const reqs = [
      { PutRequest: { Item: { pk: { S: pk }, sk: { S: "_meta" }, cachedAt: { N: String(Date.now()) }, count: { N: String(contacts.length) }, ttl: { N: String(ttl) } } } },
      ...contacts.map((c, i) => ({
        PutRequest: {
          Item: {
            pk: { S: pk },
            sk: { S: String(c?.contactId || `idx_${i}`) },
            j: { S: JSON.stringify(c) },
            ttl: { N: String(ttl) },
          },
        },
      })),
    ];
    for (let i = 0; i < reqs.length; i += 25) {
      await ddb.send(new BatchWriteItemCommand({ RequestItems: { [RECORDINGS_TABLE]: reqs.slice(i, i + 25) } }));
    }
  } catch (e) {
    console.warn("writeRecordingsCache failed:", (e as Error)?.message || e);
  }
}

/** Nombre de agente/cola resuelto desde el caché persistente. null = miss. */
export async function getCachedName(instanceId: string, id: string): Promise<string | null> {
  if (!instanceId || !id) return null;
  try {
    const res = await ddb.send(new GetItemCommand({ TableName: NAME_TABLE, Key: { pk: { S: `${instanceId}#${id}` } } }));
    return res.Item?.name?.S ?? null;
  } catch {
    return null;
  }
}

/** Persiste un nombre resuelto (best-effort). */
export async function putCachedName(instanceId: string, id: string, name: string): Promise<void> {
  if (!instanceId || !id || !name) return;
  try {
    const ttl = Math.floor(Date.now() / 1000) + NAME_TTL_S;
    await ddb.send(new PutItemCommand({ TableName: NAME_TABLE, Item: { pk: { S: `${instanceId}#${id}` }, name: { S: name }, ttl: { N: String(ttl) } } }));
  } catch {
    /* best-effort */
  }
}

/* ── Caché de BLOBS grandes (hilo WhatsApp ~378kb, grid de archivos): se guarda
 *    GZIP (cabe en el item de 400kb de DynamoDB) en `connectview-recordings-cache`
 *    con un `pk` namespaced (ej. `thread#<inst>#<phone>`) y sk `_blob`. ── */
const MAX_GZ = 380 * 1024; // margen bajo el límite de 400kb de DynamoDB

/** Lee un blob cacheado (gunzip + parse). null = miss / viejo / no cabía. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readBlobCache(pk: string, freshMs = FRESH_MS): Promise<any | null> {
  if (!pk) return null;
  try {
    const res = await ddb.send(new GetItemCommand({ TableName: RECORDINGS_TABLE, Key: { pk: { S: pk }, sk: { S: "_blob" } } }));
    const it = res.Item;
    if (!it?.gz?.B || !it.cachedAt?.N) return null;
    if (Date.now() - Number(it.cachedAt.N) > freshMs) return null;
    return JSON.parse(gunzipSync(Buffer.from(it.gz.B as Uint8Array)).toString("utf8"));
  } catch (e) {
    console.warn("readBlobCache failed:", (e as Error)?.message || e);
    return null;
  }
}

/** Inserta/actualiza UN contacto en el caché del historial SIN tocar `_meta`
 *  (Fase 2 — materialización por eventos): así se suma al historial ya cacheado
 *  y un recálculo posterior no lo pisa (mismo sk = sobreescritura). Si no había
 *  caché para el teléfono, el item queda y aparece cuando `_meta` esté fresco. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertCachedContact(tenant: string, phone: string, contact: any): Promise<void> {
  if (!tenant || !phone || !contact?.contactId) return;
  try {
    const ttl = Math.floor(Date.now() / 1000) + HARD_TTL_S;
    await ddb.send(new PutItemCommand({
      TableName: RECORDINGS_TABLE,
      Item: { pk: { S: `${tenant}#${phone}` }, sk: { S: String(contact.contactId) }, j: { S: JSON.stringify(contact) }, ttl: { N: String(ttl) } },
    }));
  } catch (e) {
    console.warn("upsertCachedContact failed:", (e as Error)?.message || e);
  }
}

/** Guarda un blob (gzip). Si comprimido no entra en DynamoDB, no cachea (no rompe). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeBlobCache(pk: string, data: any): Promise<void> {
  if (!pk || data == null) return;
  try {
    const gz = gzipSync(Buffer.from(JSON.stringify(data), "utf8"));
    if (gz.length > MAX_GZ) return; // demasiado grande → lo dejamos sin cachear
    const ttl = Math.floor(Date.now() / 1000) + HARD_TTL_S;
    await ddb.send(new PutItemCommand({
      TableName: RECORDINGS_TABLE,
      Item: { pk: { S: pk }, sk: { S: "_blob" }, gz: { B: gz }, cachedAt: { N: String(Date.now()) }, ttl: { N: String(ttl) } },
    }));
  } catch (e) {
    console.warn("writeBlobCache failed:", (e as Error)?.message || e);
  }
}
