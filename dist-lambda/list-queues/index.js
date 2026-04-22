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

// amplify/functions/list-queues/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var handler = async () => {
  try {
    const queues = [];
    let nextToken;
    do {
      const res = await connect.send(
        new import_client_connect.ListQueuesCommand({
          InstanceId: INSTANCE_ID,
          QueueTypes: ["STANDARD"],
          NextToken: nextToken,
          MaxResults: 100
        })
      );
      for (const q of res.QueueSummaryList || []) {
        queues.push({
          id: q.Id || "",
          name: q.Name || "",
          type: q.QueueType || "STANDARD",
          arn: q.Arn || ""
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);
    queues.sort((a, b) => a.name.localeCompare(b.name));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queues, total: queues.length })
    };
  } catch (err) {
    console.error("list-queues error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list queues",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
