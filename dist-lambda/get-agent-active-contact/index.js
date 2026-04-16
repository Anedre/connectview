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

// amplify/functions/get-agent-active-contact/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var client = new import_client_connect.ConnectClient({});
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
async function describeContactSafe(contactId) {
  try {
    const res = await client.send(
      new import_client_connect.DescribeContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId
      })
    );
    const ep = res.Contact?.CustomerEndpoint;
    return {
      customerPhone: ep?.Address || null,
      customerEndpointType: ep?.Type || null
    };
  } catch (err) {
    console.error("DescribeContact fallback failed:", err);
    return null;
  }
}
var userIdCache = /* @__PURE__ */ new Map();
async function resolveUserId(username) {
  if (userIdCache.has(username)) return userIdCache.get(username);
  try {
    let nextToken;
    do {
      const res = await client.send(
        new import_client_connect.ListUsersCommand({
          InstanceId: INSTANCE_ID,
          MaxResults: 100,
          NextToken: nextToken
        })
      );
      for (const u of res.UserSummaryList || []) {
        if (u.Username && u.Id) {
          userIdCache.set(u.Username, u.Id);
        }
      }
      nextToken = res.NextToken;
      if (userIdCache.has(username)) return userIdCache.get(username);
    } while (nextToken);
    return null;
  } catch (err) {
    console.error("Failed to resolve userId:", err);
    return null;
  }
}
var handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const username = params.username;
    const userId = params.userId;
    if (!username && !userId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "username or userId required" })
      };
    }
    let resolvedUserId = userId;
    if (!resolvedUserId && username) {
      resolvedUserId = await resolveUserId(username) || void 0;
      if (!resolvedUserId) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact: null,
            reason: "user-not-found",
            username
          })
        };
      }
    }
    const res = await client.send(
      new import_client_connect.GetCurrentUserDataCommand({
        InstanceId: INSTANCE_ID,
        Filters: {
          Agents: [resolvedUserId]
        }
      })
    );
    const userData = res.UserDataList?.[0];
    const contacts = userData?.Contacts || [];
    if (contacts.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: null,
          agentStatus: userData?.Status?.StatusName || null
        })
      };
    }
    const active = contacts.find(
      (c) => ["CONNECTED", "INCOMING", "CONNECTING", "ON_HOLD"].includes(
        c.ContactState || ""
      )
    ) || contacts[0];
    let customerPhone = active.CustomerEndpoint?.Address || null;
    let customerEndpointType = active.CustomerEndpoint?.Type || null;
    if (!customerPhone && active.ContactId) {
      const enriched = await describeContactSafe(active.ContactId);
      if (enriched) {
        customerPhone = enriched.customerPhone;
        customerEndpointType = enriched.customerEndpointType;
      }
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: {
          contactId: active.ContactId,
          channel: active.Channel,
          state: active.ContactState,
          initiationMethod: active.InitiationMethod,
          stateStartTimestamp: active.StateStartTimestamp,
          connectedToAgentTimestamp: active.ConnectedToAgentTimestamp,
          queueName: active.Queue?.Name || null,
          queueArn: active.Queue?.Arn || null,
          customerPhone,
          customerEndpointType
        },
        agentStatus: userData?.Status?.StatusName || null
      })
    };
  } catch (error) {
    console.error("Error getting agent active contact:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get active contact",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
