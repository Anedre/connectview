import type { Handler } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

/**
 * schedule-callback — registers a callback the agent promised to a
 * customer ("call me back tomorrow at 3pm"). A scheduled dispatcher
 * Lambda picks these up at the agreed time and places the outbound
 * call via the same agent who promised it.
 *
 * Body:
 *   {
 *     phone: "+51953730189",       // required, E.164
 *     customerName?: "Andre",
 *     scheduledAt: "2026-05-21T15:00:00-05:00", // ISO with TZ
 *     assignedAgentUserId: "84fe...", // Connect user id of the promising agent
 *     notes?: "Llamar después de su clase",
 *     campaignId?: "...",           // optional — link to a campaign
 *     contactFlowId?: "...",        // override flow (defaults to UDEP-Outbound-Smart)
 *     sourcePhoneNumber?: "+5116433467",
 *   }
 */
const dynamo = new DynamoDBClient({});
const TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CORS: Record<string, string> = { "Content-Type": "application/json" };

interface Body {
  phone: string;
  customerName?: string;
  scheduledAt: string;
  assignedAgentUserId: string;
  notes?: string;
  campaignId?: string;
  contactFlowId?: string;
  sourcePhoneNumber?: string;
  customAttributes?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  let body: Body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  if (!body.phone || !body.scheduledAt || !body.assignedAgentUserId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error: "phone, scheduledAt and assignedAgentUserId are required",
      }),
    };
  }
  // Validate ISO date; reject obviously bad ones early so the row
  // doesn't sit in the table forever as un-scheduled junk.
  const ts = Date.parse(body.scheduledAt);
  if (Number.isNaN(ts)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "scheduledAt must be a valid ISO timestamp" }),
    };
  }
  if (ts < Date.now() - 60_000) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "scheduledAt cannot be in the past" }),
    };
  }

  const callbackId = randomUUID();
  const nowIso = new Date().toISOString();

  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        callbackId: { S: callbackId },
        phone: { S: body.phone },
        customerName: { S: body.customerName || "" },
        scheduledAt: { S: new Date(ts).toISOString() },
        assignedAgentUserId: { S: body.assignedAgentUserId },
        notes: { S: body.notes || "" },
        campaignId: { S: body.campaignId || "" },
        contactFlowId: { S: body.contactFlowId || "" },
        sourcePhoneNumber: { S: body.sourcePhoneNumber || "" },
        customAttributes: { S: JSON.stringify(body.customAttributes || {}) },
        status: { S: "SCHEDULED" },
        attempts: { N: "0" },
        createdAt: { S: nowIso },
        updatedAt: { S: nowIso },
      },
    })
  );

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      callbackId,
      scheduledAt: new Date(ts).toISOString(),
    }),
  };
};
