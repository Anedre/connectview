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
import { requireCapability } from "../_shared/rbac";

/**
 * manage-catalog — Custom Lists / Catálogos (roadmap #30). Arbitrary lookup
 * tables (products, SKUs, price lists, motivos…) the team can reference from
 * leads, the bot, or scripts. A catalog is { catalogId, name, columns[],
 * rows: string[][] }.
 *
 * BYO Data Plane (#46): si el tenant aplicó el template, sus catálogos viven
 * en SU tabla `connectview-catalogs`. Si no, pooled en Vox.
 *
 * GET    ?catalogId=ID  → one · GET → list all
 * POST   { catalogId?, name, columns, rows } → upsert
 * DELETE ?catalogId=ID
 */
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.CATALOGS_TABLE || "connectview-catalogs";
const CORS = { "Content-Type": "application/json" };

const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ error: e }) });

interface CatalogDoc {
  catalogId: string;
  name: string;
  columns: string[];
  rows: string[][];
  updatedAt?: string;
  updatedBy?: string;
}

function sanitize(body: Record<string, unknown>): CatalogDoc {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("name is required");
  const columns = Array.isArray(body.columns)
    ? body.columns.map((c) => String(c).trim()).filter(Boolean)
    : [];
  if (columns.length === 0) throw new Error("at least one column is required");
  const rowsRaw = Array.isArray(body.rows) ? body.rows : [];
  const rows: string[][] = rowsRaw
    .filter((r): r is unknown[] => Array.isArray(r))
    // Normalise each row to the column count (pad/truncate).
    .map((r) =>
      columns.map((_, i) => (r[i] != null ? String(r[i]) : ""))
    )
    // Drop fully-empty rows.
    .filter((r) => r.some((cell) => cell.trim() !== ""));
  return {
    catalogId:
      typeof body.catalogId === "string" && body.catalogId.trim()
        ? body.catalogId.trim()
        : randomUUID(),
    name,
    columns,
    rows,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  // SEC — RBAC server-side: EDITAR catálogos (POST upsert / DELETE) exige
  // `manage_catalogs` (config de admin). GET queda abierto: leads/bot/scripts los
  // LEEN. Function URL auth=NONE → se valida aquí.
  if (method === "POST" || method === "DELETE") {
    const gate = await requireCapability(event?.headers, "manage_catalogs");
    if (!gate.ok) return gate.response;
  }

  // BYO Data Plane (#46): tenant primero, fallback a Vox pooled.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    if (method === "GET") {
      if (params.catalogId) {
        const res = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { catalogId: { S: params.catalogId } } })
        );
        return ok({ catalog: res.Item ? unmarshall(res.Item) : null });
      }
      const res = await dynamo.send(new ScanCommand({ TableName: TABLE }));
      const catalogs = (res.Items || [])
        .map((it) => unmarshall(it))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return ok({ catalogs });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      let doc: CatalogDoc;
      try {
        doc = sanitize(body);
      } catch (e) {
        return bad(400, e instanceof Error ? e.message : "invalid catalog");
      }
      const item = {
        ...doc,
        updatedAt: new Date().toISOString(),
        updatedBy: typeof body.actor === "string" ? body.actor : "unknown",
      };
      await dynamo.send(
        new PutItemCommand({ TableName: TABLE, Item: marshall(item, { removeUndefinedValues: true }) })
      );
      return ok({ catalog: item, saved: true });
    }

    if (method === "DELETE") {
      if (!params.catalogId) return bad(400, "catalogId required");
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { catalogId: { S: params.catalogId } } })
      );
      return ok({ deleted: true, catalogId: params.catalogId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-catalog error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
