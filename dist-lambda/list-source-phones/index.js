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

// amplify/functions/list-source-phones/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var INSTANCE_ARN = `arn:aws:connect:us-east-1:731736972577:instance/${INSTANCE_ID}`;
var handler = async () => {
  try {
    const phones = [];
    let nextToken;
    do {
      const res = await connect.send(
        new import_client_connect.ListPhoneNumbersV2Command({
          TargetArn: INSTANCE_ARN,
          NextToken: nextToken,
          MaxResults: 100
        })
      );
      for (const p of res.ListPhoneNumbersSummaryList || []) {
        phones.push({
          phoneNumber: p.PhoneNumber || "",
          phoneNumberId: p.PhoneNumberId || "",
          countryCode: p.PhoneNumberCountryCode,
          type: p.PhoneNumberType,
          description: p.PhoneNumberDescription
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phones, total: phones.length })
    };
  } catch (err) {
    console.error("list-source-phones error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list source phones",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
