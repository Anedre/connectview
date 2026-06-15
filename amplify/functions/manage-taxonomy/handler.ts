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
 * manage-taxonomy — the single source of truth for disposition trees
 * ("tipificación"). Replaces the per-tool taxonomies the client used to
 * keep in Salesforce / Chattigo / Kommo with ONE canonical, editable tree
 * that every channel's wrap-up consumes.
 *
 * Routes (Function URL, method-based):
 *   GET    ?taxonomyId=ID   → one taxonomy
 *   GET                     → list all taxonomies
 *   POST   { taxonomyId?, name, stages, isDefault? } → upsert
 *   DELETE ?taxonomyId=ID   → delete (cannot delete the default)
 *
 * A "taxonomy" doc:
 *   { taxonomyId, name, isDefault, stages: DispositionStage[], updatedAt }
 * where DispositionStage mirrors src/lib/dispositions.ts:
 *   { id, label, valoracion: "positiva"|"negativa"|"cierre",
 *     description?, salesforceValue?,            // ← maps OUT to SF (roadmap #23)
 *     subStages: [{ id, label, salesforceValue? }] }
 */
// BYO Data Plane (#46): tenant primero (su tabla en su cuenta), fallback Vox.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.TAXONOMIES_TABLE || "connectview-taxonomies";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

const ok = (body: unknown) => ({
  statusCode: 200,
  headers: CORS,
  body: JSON.stringify(body),
});
const bad = (code: number, error: string) => ({
  statusCode: code,
  headers: CORS,
  body: JSON.stringify({ error }),
});

interface SubStage {
  id: string;
  label: string;
  salesforceValue?: string;
}
interface Stage {
  id: string;
  label: string;
  valoracion: "inicial" | "positiva" | "negativa" | "cierre";
  description?: string;
  salesforceValue?: string;
  subStages: SubStage[];
}
interface TaxonomyDoc {
  taxonomyId: string;
  name: string;
  isDefault?: boolean;
  stages: Stage[];
  updatedAt?: string;
  updatedBy?: string;
}

const VALID_VALORACION = new Set(["inicial", "positiva", "negativa", "cierre"]);

/** Validate + clean an incoming taxonomy doc. Throws on structural errors so
 *  a malformed save can't poison the source of truth every channel reads. */
function sanitize(body: Record<string, unknown>): TaxonomyDoc {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("name is required");
  if (!Array.isArray(body.stages) || body.stages.length === 0) {
    throw new Error("stages must be a non-empty array");
  }
  const seenStageIds = new Set<string>();
  const stages: Stage[] = body.stages.map((raw, i) => {
    const s = raw as Record<string, unknown>;
    const label = typeof s.label === "string" ? s.label.trim() : "";
    if (!label) throw new Error(`stage[${i}] missing label`);
    const id =
      typeof s.id === "string" && s.id.trim()
        ? s.id.trim()
        : slug(label);
    if (seenStageIds.has(id)) throw new Error(`duplicate stage id "${id}"`);
    seenStageIds.add(id);
    const valoracion = VALID_VALORACION.has(String(s.valoracion))
      ? (s.valoracion as Stage["valoracion"])
      : "positiva";
    const subsRaw = Array.isArray(s.subStages) ? s.subStages : [];
    const seenSub = new Set<string>();
    const subStages: SubStage[] = subsRaw.map((sr, j) => {
      const ss = sr as Record<string, unknown>;
      const slabel = typeof ss.label === "string" ? ss.label.trim() : "";
      if (!slabel) throw new Error(`stage[${i}].subStage[${j}] missing label`);
      let sid =
        typeof ss.id === "string" && ss.id.trim() ? ss.id.trim() : slug(slabel);
      // de-dup within a stage by suffixing
      let n = 2;
      while (seenSub.has(sid)) sid = `${slug(slabel)}_${n++}`;
      seenSub.add(sid);
      return {
        id: sid,
        label: slabel,
        ...(typeof ss.salesforceValue === "string" && ss.salesforceValue.trim()
          ? { salesforceValue: ss.salesforceValue.trim() }
          : {}),
      };
    });
    return {
      id,
      label,
      valoracion,
      ...(typeof s.description === "string" && s.description.trim()
        ? { description: s.description.trim() }
        : {}),
      ...(typeof s.salesforceValue === "string" && s.salesforceValue.trim()
        ? { salesforceValue: s.salesforceValue.trim() }
        : {}),
      subStages,
    };
  });
  return {
    taxonomyId:
      typeof body.taxonomyId === "string" && body.taxonomyId.trim()
        ? body.taxonomyId.trim()
        : randomUUID(),
    name,
    isDefault: body.isDefault === true,
    stages,
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "item";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method =
    event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // BYO Data Plane (#46): tenant primero, fallback Vox.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  const params = event.queryStringParameters || {};

  try {
    if (method === "GET") {
      if (params.taxonomyId) {
        const res = await dynamo.send(
          new GetItemCommand({
            TableName: TABLE,
            Key: { taxonomyId: { S: params.taxonomyId } },
          })
        );
        return ok({ taxonomy: res.Item ? unmarshall(res.Item) : null });
      }
      // list all
      const res = await dynamo.send(new ScanCommand({ TableName: TABLE }));
      const taxonomies = (res.Items || [])
        .map((it) => unmarshall(it))
        .sort((a, b) =>
          a.isDefault === b.isDefault
            ? String(a.name).localeCompare(String(b.name))
            : a.isDefault
            ? -1
            : 1
        );
      return ok({ taxonomies });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      let doc: TaxonomyDoc;
      try {
        doc = sanitize(body);
      } catch (e) {
        return bad(400, e instanceof Error ? e.message : "invalid taxonomy");
      }
      const item = {
        ...doc,
        updatedAt: new Date().toISOString(),
        updatedBy:
          typeof body.actor === "string" ? body.actor : "unknown",
      };
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
      return ok({ taxonomy: item, saved: true });
    }

    if (method === "DELETE") {
      if (!params.taxonomyId) return bad(400, "taxonomyId required");
      // Guard: don't delete the default tree — every channel falls back to it.
      const cur = await dynamo.send(
        new GetItemCommand({
          TableName: TABLE,
          Key: { taxonomyId: { S: params.taxonomyId } },
        })
      );
      if (cur.Item && unmarshall(cur.Item).isDefault) {
        return bad(409, "Cannot delete the default taxonomy");
      }
      await dynamo.send(
        new DeleteItemCommand({
          TableName: TABLE,
          Key: { taxonomyId: { S: params.taxonomyId } },
        })
      );
      return ok({ deleted: true, taxonomyId: params.taxonomyId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-taxonomy error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
