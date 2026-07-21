import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo } from "../_shared/tenantConnect";

/**
 * manage-knowledge — Base de conocimiento / FAQ del agente IA (Pilar 8 · R15).
 * Una KB es { kbId, name, entries: [{ id, q, a, tags? }] }. El `bot-runtime`
 * la lee (por `ragKbId`) para anclar al agente (RAG). Misma forma CRUD que
 * `manage-catalog`. BYO Data Plane: tabla del tenant o pooled en Vox.
 *
 * GET    ?kbId=ID  → una · GET → lista
 * POST   { kbId?, name, entries:[{q,a,tags?}] } → upsert
 * DELETE ?kbId=ID
 */
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.KB_TABLE || "connectview-knowledge-bases";
const CORS = { "Content-Type": "application/json" };

const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

interface KbEntry {
  id: string;
  q: string;
  a: string;
  tags?: string[];
}
interface KbDoc {
  kbId: string;
  name: string;
  entries: KbEntry[];
  updatedAt?: string;
  updatedBy?: string;
}

function sanitize(body: Record<string, unknown>): KbDoc {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("name is required");
  const raw = Array.isArray(body.entries) ? body.entries : [];
  const entries: KbEntry[] = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: typeof e.id === "string" && e.id ? e.id : randomUUID(),
      q: typeof e.q === "string" ? e.q.trim() : "",
      a: typeof e.a === "string" ? e.a.trim() : "",
      tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t).trim()).filter(Boolean) : undefined,
    }))
    .filter((e) => e.q !== "" && e.a !== "");
  return {
    kbId: typeof body.kbId === "string" && body.kbId.trim() ? body.kbId.trim() : randomUUID(),
    name,
    entries,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    if (method === "GET") {
      if (params.kbId) {
        const res = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { kbId: { S: params.kbId } } }),
        );
        return ok({ kb: res.Item ? unmarshall(res.Item) : null });
      }
      // BUG-audit P2: paginar completo (antes truncaba a 1 página)
      const items: Record<string, unknown>[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const res = await dynamo.send(
          new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }),
        );
        for (const it of res.Items || []) items.push(unmarshall(it));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      const kbs = items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return ok({ kbs });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      let doc: KbDoc;
      try {
        doc = sanitize(body);
      } catch (e) {
        return bad(400, e instanceof Error ? e.message : "invalid kb");
      }
      const item = {
        ...doc,
        updatedAt: new Date().toISOString(),
        updatedBy: typeof body.actor === "string" ? body.actor : "unknown",
      };
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(item, { removeUndefinedValues: true }),
        }),
      );
      return ok({ kb: item, saved: true });
    }

    if (method === "DELETE") {
      if (!params.kbId) return bad(400, "kbId required");
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { kbId: { S: params.kbId } } }),
      );
      return ok({ deleted: true, kbId: params.kbId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-knowledge error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
