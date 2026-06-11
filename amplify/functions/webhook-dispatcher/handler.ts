/**
 * webhook-dispatcher — entrega durable de webhooks salientes (#17).
 *
 * Reemplaza el "1 intento y listo" del actWebhook de #15 por reintentos
 * exponenciales multi-día con visibilidad. Lambda de DOS entradas:
 *
 *  · SQS (connectview-webhook-queue): cada mensaje es un intento de entrega.
 *      - kind:"new"   → crea la fila de delivery y hace el 1er intento.
 *      - kind:"retry" → carga la fila por deliveryId y reintenta.
 *    Éxito (2xx) → status="delivered". Fallo → status="retrying" con
 *    nextAttemptAt = now + backoff(intento); al agotar maxAttempts →
 *    "exhausted". NO lanzamos en fallo de ENTREGA (eso lo maneja la tabla);
 *    solo un error de PROCESO (bug/timeout) deja que SQS lo mande al DLQ.
 *
 *  · EventBridge tick (rate 5 min): escanea la tabla por status="retrying" con
 *    nextAttemptAt <= now y los RE-ENCOLA a SQS. Esto es lo que da el backoff
 *    multi-día que SQS solo no puede (delay máx 15 min, visibility máx 12 h).
 *
 * Tabla connectview-webhook-deliveries: PK=deliveryId; GSI byStatusNextAttempt
 * (status, nextAttemptAt) para el escaneo del tick; TTL `ttl` para auto-purga.
 */
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const dynamo = new DynamoDBClient({});
const sqs = new SQSClient({});

const TABLE = process.env.DELIVERIES_TABLE || "connectview-webhook-deliveries";
const QUEUE_URL = process.env.WEBHOOK_QUEUE_URL || "";
const STATUS_INDEX = "byStatusNextAttempt";

/**
 * Backoff exponencial (segundos) por número de intento ya realizado.
 * 1m, 5m, 30m, 2h, 6h, 12h, luego 24h por día hasta ~7 días. La longitud
 * del array define maxAttempts (al agotarlo → exhausted).
 */
const BACKOFF_SECONDS = [
  60, 300, 1800, 7200, 21600, 43200,
  86400, 86400, 86400, 86400, 86400, 86400,
];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;
/** TTL: purga filas terminales (delivered/exhausted) a los 30 días. */
const TTL_DAYS = 30;

interface DeliveryRow {
  deliveryId: string;
  tenantId?: string;
  ruleId?: string;
  ruleName?: string;
  url: string;
  payload: string; // JSON serializado
  status: "delivering" | "delivered" | "retrying" | "queued" | "exhausted";
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  lastStatusCode?: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  ttl?: number;
}

interface NewMessage {
  kind: "new";
  url: string;
  payload: unknown;
  tenantId?: string;
  ruleId?: string;
  ruleName?: string;
}
interface RetryMessage {
  kind: "retry";
  deliveryId: string;
}
type QueueMessage = NewMessage | RetryMessage;

function nowIso(): string {
  return new Date().toISOString();
}
function uuid(): string {
  // node20 runtime
  return (globalThis.crypto as Crypto).randomUUID();
}

/** POST el payload al endpoint del cliente. 2xx = ok. */
async function deliver(
  url: string,
  payload: unknown
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!/^https?:\/\//.test(url)) return { ok: false, error: "url inválida" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AIRA-Webhooks/1.0",
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
      signal: ac.signal,
    });
    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status };
    return { ok: false, status: r.status, error: `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "fetch falló" };
  } finally {
    clearTimeout(timer);
  }
}

function ttlEpoch(): number {
  return Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
}

/** Aplica el resultado de un intento a la fila y la persiste (UpdateItem). */
async function recordAttempt(
  row: DeliveryRow,
  result: { ok: boolean; status?: number; error?: string }
): Promise<void> {
  const attempts = row.attempts + 1;
  const names: Record<string, string> = {
    "#status": "status",
    "#attempts": "attempts",
    "#updatedAt": "updatedAt",
  };
  const sets = ["#status = :s", "#attempts = :a", "#updatedAt = :u"];
  const vals: Record<string, unknown> = {
    ":s": "",
    ":a": attempts,
    ":u": nowIso(),
  };
  const removes: string[] = [];

  if (result.ok) {
    vals[":s"] = "delivered";
    names["#deliveredAt"] = "deliveredAt";
    sets.push("#deliveredAt = :d");
    vals[":d"] = nowIso();
    names["#code"] = "lastStatusCode";
    sets.push("#code = :c");
    vals[":c"] = result.status ?? 0;
    names["#ttl"] = "ttl";
    sets.push("#ttl = :t");
    vals[":t"] = ttlEpoch();
    removes.push("nextAttemptAt");
  } else {
    names["#err"] = "lastError";
    sets.push("#err = :e");
    vals[":e"] = (result.error || "fallo").slice(0, 500);
    if (result.status !== undefined) {
      names["#code"] = "lastStatusCode";
      sets.push("#code = :c");
      vals[":c"] = result.status;
    }
    if (attempts >= MAX_ATTEMPTS) {
      vals[":s"] = "exhausted";
      names["#ttl"] = "ttl";
      sets.push("#ttl = :t");
      vals[":t"] = ttlEpoch();
      removes.push("nextAttemptAt");
    } else {
      vals[":s"] = "retrying";
      const delay = BACKOFF_SECONDS[attempts] ?? 86400;
      names["#next"] = "nextAttemptAt";
      sets.push("#next = :n");
      vals[":n"] = new Date(Date.now() + delay * 1000).toISOString();
    }
  }

  let expr = "SET " + sets.join(", ");
  if (removes.length) expr += " REMOVE " + removes.join(", ");

  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { deliveryId: { S: row.deliveryId } },
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(vals, { removeUndefinedValues: true }),
    })
  );
}

async function loadRow(deliveryId: string): Promise<DeliveryRow | null> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { deliveryId: { S: deliveryId } } })
  );
  return r.Item ? (unmarshall(r.Item) as DeliveryRow) : null;
}

/** Procesa un mensaje de la cola: nuevo o reintento. */
async function processMessage(msg: QueueMessage): Promise<void> {
  let row: DeliveryRow | null;
  if (msg.kind === "new") {
    row = {
      deliveryId: uuid(),
      tenantId: msg.tenantId,
      ruleId: msg.ruleId,
      ruleName: msg.ruleName,
      url: msg.url,
      payload: typeof msg.payload === "string" ? msg.payload : JSON.stringify(msg.payload),
      status: "delivering",
      attempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await dynamo.send(
      new PutItemCommand({ TableName: TABLE, Item: marshall(row, { removeUndefinedValues: true }) })
    );
  } else {
    row = await loadRow(msg.deliveryId);
    if (!row) return; // fila borrada/expirada → nada que hacer
    if (row.status === "delivered" || row.status === "exhausted") return; // ya terminal
  }
  const result = await deliver(row.url, row.payload);
  await recordAttempt(row, result);
}

/** Tick: re-encola los deliveries "retrying" vencidos. */
async function processTick(): Promise<{ requeued: number }> {
  if (!QUEUE_URL) return { requeued: 0 };
  const now = nowIso();
  let requeued = 0;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const q = await dynamo.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: STATUS_INDEX,
        KeyConditionExpression: "#status = :s AND nextAttemptAt <= :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: marshall({ ":s": "retrying", ":now": now }),
        Limit: 100,
        ExclusiveStartKey: lastKey as never,
      })
    );
    for (const item of q.Items || []) {
      const row = unmarshall(item) as DeliveryRow;
      // Marcar "queued" para que el próximo tick no lo re-encole mientras viaja.
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { deliveryId: { S: row.deliveryId } },
          UpdateExpression: "SET #status = :q, #u = :now REMOVE nextAttemptAt",
          ExpressionAttributeNames: { "#status": "status", "#u": "updatedAt" },
          ExpressionAttributeValues: marshall({ ":q": "queued", ":now": now }),
        })
      );
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({ kind: "retry", deliveryId: row.deliveryId } as RetryMessage),
        })
      );
      requeued++;
    }
    lastKey = q.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return { requeued };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any): Promise<unknown> => {
  // Entrada SQS → uno o más Records.
  if (event?.Records && Array.isArray(event.Records)) {
    for (const rec of event.Records) {
      try {
        const msg = JSON.parse(rec.body) as QueueMessage;
        await processMessage(msg);
      } catch (err) {
        // Error de PROCESO (parseo/bug) → relanzar para que SQS lo mande al DLQ.
        console.error("webhook-dispatcher: fallo de proceso:", err);
        throw err;
      }
    }
    return { ok: true };
  }
  // Entrada EventBridge (tick) o invoke directo.
  const res = await processTick();
  console.log("webhook-dispatcher tick:", res);
  return res;
};
