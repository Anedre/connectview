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
 * manage-bot — CRUD for the visual chat-flow builder (roadmap #16, the Kommo
 * "Salesbot" equivalent). A bot is a graph of steps (nodes) + transitions
 * (edges) plus name/status/trigger, stored whole as one item in
 * `connectview-bots` (bots are small — well under the 400KB item limit).
 *
 * BYO Data Plane (#46): si el tenant aplicó el template, `dynamo` apunta a
 * SU tabla `connectview-bots`. Si no, cae a la pooled de Vox (legacy).
 *
 * GET                 → list bots (summaries: botId, name, status, counts, updatedAt)
 * GET   ?botId=ID     → full bot (nodes + edges)
 * POST  { botId?, name, status, trigger, nodes[], edges[] } → upsert (new id if absent)
 * DELETE ?botId=ID
 */
const legacyDynamo = new DynamoDBClient({});
// module-active: el handler re-asigna en cada invocación; helpers como scanAll
// leen este valor → tenant-scoped sin tocar la firma.
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.BOTS_TABLE || "connectview-bots";
// Conversation logs live here (defaults to the bots table as conv# items).
const CONV_TABLE = process.env.CONV_TABLE || TABLE;
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ error: e }) });

interface Bot {
  botId: string;
  name: string;
  status?: string;
  trigger?: string;
  /** "bot" (visual flow) | "agent" (AI-agent hub). Defaults to "bot". */
  kind?: string;
  nodes?: unknown[];
  edges?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

async function scanAll(table = TABLE): Promise<Bot[]> {
  const out: Bot[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey as never })
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as Bot);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  // BYO Data Plane (#46): tenant primero, fallback a Vox pooled.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    if (method === "GET") {
      if (params.botId) {
        const res = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { botId: { S: params.botId } } })
        );
        if (!res.Item) return bad(404, "bot not found");
        return ok({ bot: unmarshall(res.Item) });
      }

      // Conversation monitoring: aggregate the conv# records written by
      // bot-runtime when an agent conversation finishes.
      if (params.conversations) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const convs = (await scanAll(CONV_TABLE) as any[]).filter((b) => String(b.botId).startsWith("conv#"));
        const filtered = params.agentId ? convs.filter((c) => c.agentBotId === params.agentId) : convs;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const byAgent: Record<string, any> = {};
        for (const c of filtered) {
          const key = c.agentBotId || "(sin guardar)";
          const a = (byAgent[key] = byAgent[key] || { agentBotId: c.agentBotId || "", agentName: c.agentName || "", total: 0, resolved: 0, handoff: 0, ended: 0, turns: 0, toolUses: 0 });
          a.total += 1;
          if (c.outcome === "resolved" || c.outcome === "handoff" || c.outcome === "ended") a[c.outcome] += 1;
          a.turns += Number(c.turns) || 0;
          a.toolUses += Array.isArray(c.toolsUsed) ? c.toolsUsed.length : 0;
          if (!a.agentName && c.agentName) a.agentName = c.agentName;
        }
        const agents = Object.values(byAgent).map((a) => ({ ...a, avgTurns: a.total ? Math.round((a.turns / a.total) * 10) / 10 : 0 }));
        const recent = filtered
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
          .slice(0, 40)
          .map((c) => ({ convId: c.botId, agentBotId: c.agentBotId, agentName: c.agentName, source: c.source, outcome: c.outcome, turns: c.turns, toolsUsed: c.toolsUsed, lastUserText: c.lastUserText, createdAt: c.createdAt }));
        const totals = {
          total: filtered.length,
          resolved: filtered.filter((c) => c.outcome === "resolved").length,
          handoff: filtered.filter((c) => c.outcome === "handoff").length,
        };
        return ok({ conversations: { totals, byAgent: agents, recent } });
      }

      // List as lightweight summaries (drop the heavy nodes/edges). For agents
      // (kind:"agent") attach a small meta block derived from the AI node so the
      // hub can show model / tools / readiness without re-fetching each one.
      const all = await scanAll();
      const bots = all
        .filter((b) => !String(b.botId).startsWith("conv#"))
        .map((b) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nodes = (Array.isArray(b.nodes) ? b.nodes : []) as any[];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const base: Record<string, any> = {
            botId: b.botId,
            name: b.name,
            status: b.status || "draft",
            trigger: b.trigger,
            kind: b.kind || "bot",
            stepCount: nodes.length,
            updatedAt: b.updatedAt,
          };
          if (b.kind === "agent") {
            const ai = nodes.find((n) => n?.kind === "ai_agent");
            const d = (ai?.data || {}) as Record<string, unknown>;
            const hand = nodes.find((n) => n?.kind === "handoff");
            base.agentMeta = {
              model: typeof d.model === "string" ? d.model : "",
              toolsCount: Array.isArray(d.tools) ? d.tools.length : 0,
              hasObjective: !!(typeof d.objective === "string" && d.objective.trim()),
              hasKnowledge: !!(typeof d.knowledge === "string" && d.knowledge.trim()),
              hasHandoff: !!(hand?.data && typeof hand.data.queue === "string" && hand.data.queue.trim()),
            };
          }
          return base;
        })
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return ok({ bots });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (!body.name) return bad(400, "name is required");

      const now = new Date().toISOString();
      const isNew = !body.botId;
      const botId = body.botId || randomUUID();

      const item: Bot = {
        botId,
        name: String(body.name),
        status: body.status || "draft",
        trigger: body.trigger || "",
        kind: body.kind === "agent" ? "agent" : "bot",
        nodes: Array.isArray(body.nodes) ? body.nodes : [],
        edges: Array.isArray(body.edges) ? body.edges : [],
        updatedAt: now,
      };
      if (isNew) item.createdAt = now;

      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
      return ok({ bot: item, saved: true, isNew });
    }

    if (method === "DELETE") {
      if (!params.botId) return bad(400, "botId required");
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { botId: { S: params.botId } } })
      );
      return ok({ deleted: true, botId: params.botId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-bot error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
