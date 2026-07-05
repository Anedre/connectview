/**
 * manage-scheduled-exports — CRUD de los exports programados (#7) + "generar
 * ahora". Function URL pública; identidad por JWT de Cognito (scoped al tenant).
 *
 *  GET                          → lista los jobs del tenant
 *  POST  (job)                  → crea/actualiza un job (calcula nextRunAt)
 *  POST  {action:"runNow", id}  → invoca al runner YA (async)
 *  DELETE ?exportId=…           → borra un job
 */
import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "node:crypto";
import { getIdentity, isLegacyTenant } from "../_shared/cognitoAuth";

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});
const TABLE = process.env.EXPORTS_TABLE || "connectview-scheduled-exports";
const RUNNER = process.env.RUNNER_FUNCTION || "connectview-scheduled-export-runner";
const HDRS = { "Content-Type": "application/json" };

const DATASETS = ["leads"];
const FREQS = ["daily", "weekly", "monthly"];

// SEC-A5: allowlist opcional de dominios de destino de los exports. Un export manda
// una planilla de LEADS (PII) a emails arbitrarios → vector de exfiltración. Si se
// configura EXPORT_ALLOWED_DOMAINS (CSV, p.ej. "novasys.com.pe,udep.edu.pe"), todo
// destinatario debe pertenecer a uno de esos dominios. Sin configurar, sólo aplica
// el gate de rol Admin (no rompe la config actual del cliente).
const ALLOWED_DOMAINS = (process.env.EXPORT_ALLOWED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** Dominio (parte tras la @) de un email, en minúsculas. "" si no parsea. */
function emailDomain(addr: string): string {
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : "";
}

function nextRun(freq: string, hourUtc: number): string {
  const now = Date.now();
  const d = new Date(now);
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0, 0),
  );
  if (next.getTime() <= now) {
    if (freq === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else if (freq === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: HDRS, body: "" };

  // SEC-A5: gate de rol. Programar/ejecutar un export = mandar una planilla de leads
  // (PII) por email → operación privilegiada. Antes cualquier usuario autenticado del
  // tenant podía crear un job (o `runNow`) hacia un correo externo arbitrario
  // (exfiltración). Exigimos el grupo Cognito "Admins" (patrón list-users). El
  // Function URL es auth=NONE → identidad validada acá.
  let identity;
  try {
    identity = await getIdentity(event?.headers);
  } catch {
    return { statusCode: 401, headers: HDRS, body: JSON.stringify({ error: "no autenticado" }) };
  }
  const tenantId = identity?.tenantId || "";
  if (!tenantId)
    return { statusCode: 401, headers: HDRS, body: JSON.stringify({ error: "no autenticado" }) };
  if (!identity.groups?.includes("Admins"))
    return {
      statusCode: 403,
      headers: HDRS,
      body: JSON.stringify({ error: "Solo un Admin puede gestionar los exports programados." }),
    };
  const legacy = isLegacyTenant(tenantId);

  try {
    if (method === "GET") {
      const scan = await dynamo.send(new ScanCommand({ TableName: TABLE }));
      let rows = (scan.Items || []).map((i) => unmarshall(i));
      if (!legacy) rows = rows.filter((r) => r.tenantId === tenantId);
      rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      return { statusCode: 200, headers: HDRS, body: JSON.stringify({ exports: rows }) };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");

      // Generar ahora (dispara el runner async).
      if (body.action === "runNow") {
        const exportId = String(body.exportId || "");
        if (!exportId)
          return {
            statusCode: 400,
            headers: HDRS,
            body: JSON.stringify({ error: "exportId requerido" }),
          };
        const cur = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { exportId: { S: exportId } } }),
        );
        if (!cur.Item)
          return { statusCode: 404, headers: HDRS, body: JSON.stringify({ error: "no existe" }) };
        const row = unmarshall(cur.Item);
        if (!legacy && row.tenantId !== tenantId)
          return { statusCode: 403, headers: HDRS, body: JSON.stringify({ error: "ajeno" }) };
        await lambda.send(
          new InvokeCommand({
            FunctionName: RUNNER,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({ runNow: exportId })),
          }),
        );
        return {
          statusCode: 202,
          headers: HDRS,
          body: JSON.stringify({ ok: true, running: exportId }),
        };
      }

      // Upsert.
      const dataset = DATASETS.includes(body.dataset) ? body.dataset : "leads";
      const frequency = FREQS.includes(body.frequency) ? body.frequency : "daily";
      const hourUtc = Math.max(0, Math.min(23, Number(body.hourUtc) || 13));
      const recipients = Array.isArray(body.recipients)
        ? body.recipients
            .map((s: unknown) => String(s).trim())
            .filter((s: string) => /\S+@\S+\.\S+/.test(s))
        : [];
      if (recipients.length === 0)
        return {
          statusCode: 400,
          headers: HDRS,
          body: JSON.stringify({ error: "al menos un destinatario válido" }),
        };
      // SEC-A5: si hay allowlist de dominios, todos los destinatarios deben cumplirla.
      if (ALLOWED_DOMAINS.length > 0) {
        const bad = recipients.filter((r: string) => !ALLOWED_DOMAINS.includes(emailDomain(r)));
        if (bad.length > 0)
          return {
            statusCode: 400,
            headers: HDRS,
            body: JSON.stringify({
              error: `destinatarios fuera de dominios permitidos: ${bad.join(", ")}`,
            }),
          };
      }

      const exportId = body.exportId ? String(body.exportId) : randomUUID();
      const isNew = !body.exportId;
      const now = new Date().toISOString();
      const item: Record<string, unknown> = {
        exportId,
        tenantId,
        name: String(body.name || "Export").slice(0, 80),
        dataset,
        frequency,
        hourUtc,
        recipients,
        enabled: body.enabled !== false,
        nextRunAt: body.nextRunAt || nextRun(frequency, hourUtc),
        updatedAt: now,
      };
      if (isNew) item.createdAt = now;
      else {
        // preservar campos de corrida previos
        const cur = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { exportId: { S: exportId } } }),
        );
        if (cur.Item) {
          const prev = unmarshall(cur.Item);
          if (!legacy && prev.tenantId !== tenantId)
            return { statusCode: 403, headers: HDRS, body: JSON.stringify({ error: "ajeno" }) };
          item.createdAt = prev.createdAt || now;
          item.lastRunAt = prev.lastRunAt;
          item.lastStatus = prev.lastStatus;
        }
      }
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(item, { removeUndefinedValues: true }),
        }),
      );
      return { statusCode: 200, headers: HDRS, body: JSON.stringify({ ok: true, export: item }) };
    }

    if (method === "DELETE") {
      const exportId = String(event.queryStringParameters?.exportId || "");
      if (!exportId)
        return {
          statusCode: 400,
          headers: HDRS,
          body: JSON.stringify({ error: "exportId requerido" }),
        };
      const cur = await dynamo.send(
        new GetItemCommand({ TableName: TABLE, Key: { exportId: { S: exportId } } }),
      );
      if (cur.Item) {
        const row = unmarshall(cur.Item);
        if (!legacy && row.tenantId !== tenantId)
          return { statusCode: 403, headers: HDRS, body: JSON.stringify({ error: "ajeno" }) };
      }
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { exportId: { S: exportId } } }),
      );
      return { statusCode: 200, headers: HDRS, body: JSON.stringify({ ok: true }) };
    }

    return {
      statusCode: 405,
      headers: HDRS,
      body: JSON.stringify({ error: "método no permitido" }),
    };
  } catch (err) {
    console.error("manage-scheduled-exports error:", err);
    return {
      statusCode: 500,
      headers: HDRS,
      body: JSON.stringify({ error: err instanceof Error ? err.message : "error" }),
    };
  }
};
