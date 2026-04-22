"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// amplify/functions/get-flow-queues/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var queueNameCache = /* @__PURE__ */ new Map();
async function resolveQueueName(queueIdOrArn) {
  if (!queueIdOrArn) return "";
  if (queueNameCache.has(queueIdOrArn))
    return queueNameCache.get(queueIdOrArn);
  const queueId = queueIdOrArn.includes("/") ? queueIdOrArn.split("/").pop() || queueIdOrArn : queueIdOrArn;
  try {
    const res = await connect.send(
      new import_client_connect.DescribeQueueCommand({
        InstanceId: INSTANCE_ID,
        QueueId: queueId
      })
    );
    const name = res.Queue?.Name || queueId;
    queueNameCache.set(queueIdOrArn, name);
    return name;
  } catch {
    queueNameCache.set(queueIdOrArn, queueId);
    return queueId;
  }
}
function extractQueueParam(params) {
  const raw = params.QueueId;
  if (!raw) return null;
  if (typeof raw === "string") {
    const isDynamic = raw.startsWith("$.") || raw.includes("{{");
    return { value: raw, isDynamic };
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw;
    if (obj.Id) return { value: obj.Id, isDynamic: false };
  }
  return null;
}
var QUEUE_ACTION_TYPES = {
  UpdateContactTargetQueue: "set-working-queue",
  TransferContactToQueue: "transfer-to-queue",
  UpdateContactQueue: "update-queue"
};
async function parseFlowQueues(contentJson) {
  let parsed;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return [];
  }
  const results = [];
  const seen = /* @__PURE__ */ new Set();
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
    const queueId = extracted.value.includes("/") ? extracted.value.split("/").pop() || extracted.value : extracted.value;
    results.push({
      queueId,
      queueName: "",
      source,
      actionId: action.Identifier || "",
      isDynamic: extracted.isDynamic
    });
  }
  await Promise.all(
    results.map(async (r) => {
      if (r.isDynamic) {
        r.queueName = `(din\xE1mico: ${r.queueId})`;
      } else {
        r.queueName = await resolveQueueName(r.queueId);
      }
    })
  );
  return results;
}
var handler = async (event) => {
  try {
    const contactFlowId = event.queryStringParameters?.contactFlowId;
    if (!contactFlowId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "contactFlowId required" })
      };
    }
    const res = await connect.send(
      new import_client_connect.DescribeContactFlowCommand({
        InstanceId: INSTANCE_ID,
        ContactFlowId: contactFlowId
      })
    );
    const content = res.ContactFlow?.Content || "{}";
    const extracted = await parseFlowQueues(content);
    const ranked = [...extracted].sort((a, b) => {
      const order = {
        "transfer-to-queue": 0,
        "set-working-queue": 1,
        "update-queue": 2
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
        primaryQueue
      })
    };
  } catch (err) {
    console.error("get-flow-queues error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to parse flow queues",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
