import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactFlowCommand,
  DescribeQueueCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Cache queue descriptions in memory — keyed por instancia para no mezclar tenants.
const queueNameCache = new Map<string, string>();

async function resolveQueueName(
  queueIdOrArn: string,
  client: ConnectClient,
  instanceId: string
): Promise<string> {
  if (!queueIdOrArn) return "";
  const cacheKey = `${instanceId}:${queueIdOrArn}`;
  if (queueNameCache.has(cacheKey)) return queueNameCache.get(cacheKey)!;
  const queueId = queueIdOrArn.includes("/")
    ? queueIdOrArn.split("/").pop() || queueIdOrArn
    : queueIdOrArn;
  try {
    const res = await client.send(
      new DescribeQueueCommand({
        InstanceId: instanceId,
        QueueId: queueId,
      })
    );
    const name = res.Queue?.Name || queueId;
    queueNameCache.set(cacheKey, name);
    return name;
  } catch {
    queueNameCache.set(cacheKey, queueId);
    return queueId;
  }
}

interface FlowAction {
  Identifier?: string;
  Type?: string;
  Parameters?: Record<string, unknown>;
}

interface ExtractedQueue {
  queueId: string;
  queueName: string;
  source: "set-working-queue" | "transfer-to-queue" | "update-queue";
  actionId: string;
  isDynamic: boolean;
}

// Pull a QueueId out of an action's parameters.
// QueueId can appear as:
//   - { "QueueId": "arn:aws:connect:...:queue/<uuid>" }
//   - { "QueueId": "<uuid>" }
//   - { "QueueId": "$.Attributes.SomeAttr" }   ← dynamic, can't statically resolve
// Returns { value, isDynamic } or null if not present.
function extractQueueParam(
  params: Record<string, unknown>
): { value: string; isDynamic: boolean } | null {
  const raw = params.QueueId;
  if (!raw) return null;
  if (typeof raw === "string") {
    const isDynamic = raw.startsWith("$.") || raw.includes("{{");
    return { value: raw, isDynamic };
  }
  // Sometimes QueueId is an object { Id: "..." }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as { Id?: string };
    if (obj.Id) return { value: obj.Id, isDynamic: false };
  }
  return null;
}

// These action Types are what Connect uses for queue assignment / transfer.
// Reference: Connect Flow JSON spec — keeps backward-compat names too.
const QUEUE_ACTION_TYPES: Record<string, ExtractedQueue["source"]> = {
  UpdateContactTargetQueue: "set-working-queue",
  TransferContactToQueue: "transfer-to-queue",
  UpdateContactQueue: "update-queue",
};

async function parseFlowQueues(
  contentJson: string,
  client: ConnectClient,
  instanceId: string
): Promise<ExtractedQueue[]> {
  let parsed: { Actions?: FlowAction[] };
  try {
    parsed = JSON.parse(contentJson) as { Actions?: FlowAction[] };
  } catch {
    return [];
  }

  const results: ExtractedQueue[] = [];
  const seen = new Set<string>(); // dedupe by queueId

  for (const action of parsed.Actions || []) {
    const type = action.Type || "";
    const source = QUEUE_ACTION_TYPES[type];
    if (!source) continue;
    const params = action.Parameters || {};
    const extracted = extractQueueParam(params);
    if (!extracted) continue;
    const dedupeKey = `${extracted.value}|${source}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const queueId = extracted.value.includes("/")
      ? extracted.value.split("/").pop() || extracted.value
      : extracted.value;

    results.push({
      queueId,
      queueName: "",
      source,
      actionId: action.Identifier || "",
      isDynamic: extracted.isDynamic,
    });
  }

  // Resolve queue names for the literal ones (skip dynamic)
  await Promise.all(
    results.map(async (r) => {
      if (r.isDynamic) {
        r.queueName = `(dinámico: ${r.queueId})`;
      } else {
        r.queueName = await resolveQueueName(r.queueId, client, instanceId);
      }
    })
  );

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const contactFlowId = event.queryStringParameters?.contactFlowId;
    if (!contactFlowId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "contactFlowId required" }),
      };
    }

    const { client: connect, instanceId } = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    const res = await connect.send(
      new DescribeContactFlowCommand({
        InstanceId: instanceId,
        ContactFlowId: contactFlowId,
      })
    );
    const content = res.ContactFlow?.Content || "{}";

    const extracted = await parseFlowQueues(content, connect, instanceId);

    // Prefer transfer-to-queue over set-working-queue when deciding the
    // "primary" queue (that's where the contact actually lands).
    const ranked = [...extracted].sort((a, b) => {
      const order = {
        "transfer-to-queue": 0,
        "set-working-queue": 1,
        "update-queue": 2,
      };
      return order[a.source] - order[b.source];
    });

    const literalQueues = ranked.filter((q) => !q.isDynamic);
    const dynamicQueues = ranked.filter((q) => q.isDynamic);
    const primaryQueue = literalQueues[0] || null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactFlowId,
        flowName: res.ContactFlow?.Name || "",
        flowType: res.ContactFlow?.Type || "",
        queues: ranked,
        literalQueues,
        dynamicQueues,
        primaryQueue,
      }),
    };
  } catch (err) {
    console.error("get-flow-queues error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to parse flow queues",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
