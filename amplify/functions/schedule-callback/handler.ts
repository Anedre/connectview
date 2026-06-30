import type { Handler } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo } from "../_shared/tenantConnect";

/**
 * schedule-callback — registers a follow-up the agent promised to a
 * customer ("call me back tomorrow at 3pm" / "envíame el correo el
 * lunes" / "mándame el WhatsApp en 2 horas"). A scheduled dispatcher
 * Lambda picks these up at the agreed time:
 *
 *  - channel="voice"    → places the outbound call automatically.
 *  - channel="email"    → marks DUE and surfaces in the agent's
 *                         "Mis pendientes" drawer (agent attends
 *                         manually from there).
 *  - channel="whatsapp" → same as email (manual action by agent).
 *
 * The endpoint name is kept ("schedule-callback") for backward compat;
 * the row is the same shape with an extra `channel` field that
 * defaults to "voice" when omitted.
 *
 * Body:
 *   {
 *     phone: "+51953730189",                       // required, E.164
 *     customerName?: "Andre",
 *     scheduledAt: "2026-05-21T15:00:00-05:00",    // ISO with TZ
 *     assignedAgentUserId: "84fe...",              // Connect user id
 *     notes?: "Llamar después de su clase",
 *     channel?: "voice" | "email" | "whatsapp",    // default: voice
 *     campaignId?: "...",                          // link to campaign
 *     contactFlowId?: "...",                       // voice override
 *     sourcePhoneNumber?: "+5116433467",           // voice override
 *     customAttributes?: { [k]: v },               // forwarded to Connect
 *     // Email-specific (optional, agent fills when attending):
 *     emailSubject?: "Tu información de admisión UDEP",
 *     emailBody?: "Hola Andre, ...",
 *     emailFromAddress?: "admision@udep.edu.pe",
 *     emailToAddress?: "andre@example.com",
 *     // WhatsApp-specific (optional):
 *     templateName?: "udep_admision_emoji",
 *     templateLanguage?: "es",
 *     templateVariables?: ["Andre", "Pregrado"],
 *   }
 */
// BYO Data Plane (#46): tenant primero (su tabla en su cuenta), fallback Vox.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CORS: Record<string, string> = { "Content-Type": "application/json" };

type Channel = "voice" | "email" | "whatsapp" | "task";

interface Body {
  phone: string;
  customerName?: string;
  scheduledAt: string;
  assignedAgentUserId: string;
  notes?: string;
  channel?: Channel;
  campaignId?: string;
  contactFlowId?: string;
  sourcePhoneNumber?: string;
  customAttributes?: Record<string, string>;
  // Email-specific
  emailSubject?: string;
  emailBody?: string;
  emailFromAddress?: string;
  emailToAddress?: string;
  // WhatsApp-specific
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // BYO Data Plane (#46): tenant primero, fallback Vox.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
  let body: Body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
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

  const channel: Channel = body.channel || "voice";
  if (!["voice", "email", "whatsapp", "task"].includes(channel)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: `channel must be voice|email|whatsapp|task, got: ${channel}` }),
    };
  }
  // channel="task" → recordatorio/to-do genérico del agente: NO se auto-despacha
  // (actionType "manual-action", igual que email/whatsapp) y no exige contacto;
  // el agente lo ve en su bubble de Tareas y en el calendario de Citas.

  // Channel-specific validation — fail fast if the dispatcher won't
  // have what it needs once the row becomes due. Email & WhatsApp are
  // attended manually so we only enforce the absolute minimum.
  if (channel === "email" && !body.emailToAddress && !body.phone) {
    // We at least need an address to message — phone is the row PK,
    // emailToAddress is the actual destination.
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "emailToAddress required for email follow-ups" }),
    };
  }
  if (channel === "whatsapp" && !body.templateName) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "templateName required for whatsapp follow-ups" }),
    };
  }

  const callbackId = randomUUID();
  const nowIso = new Date().toISOString();

  // DynamoDB doesn't store empty strings well — strip blanks so we
  // don't pollute the row with empty-attribute noise.
  const optStr = (v: string | undefined) =>
    v && v.trim() ? { S: v } : undefined;
  const item: Record<string, { S: string } | { N: string }> = {
    callbackId: { S: callbackId },
    phone: { S: body.phone },
    customerName: { S: body.customerName || "" },
    scheduledAt: { S: new Date(ts).toISOString() },
    assignedAgentUserId: { S: body.assignedAgentUserId },
    notes: { S: body.notes || "" },
    channel: { S: channel },
    actionType: { S: channel === "voice" ? "auto-dispatch" : "manual-action" },
    campaignId: { S: body.campaignId || "" },
    contactFlowId: { S: body.contactFlowId || "" },
    sourcePhoneNumber: { S: body.sourcePhoneNumber || "" },
    customAttributes: { S: JSON.stringify(body.customAttributes || {}) },
    status: { S: "SCHEDULED" },
    attempts: { N: "0" },
    createdAt: { S: nowIso },
    updatedAt: { S: nowIso },
  };
  // Channel-specific fields — only set when non-empty so we don't fill
  // every row with blanks.
  const emailSubject = optStr(body.emailSubject);
  if (emailSubject) item.emailSubject = emailSubject;
  const emailBody = optStr(body.emailBody);
  if (emailBody) item.emailBody = emailBody;
  const emailFromAddress = optStr(body.emailFromAddress);
  if (emailFromAddress) item.emailFromAddress = emailFromAddress;
  const emailToAddress = optStr(body.emailToAddress);
  if (emailToAddress) item.emailToAddress = emailToAddress;
  const templateName = optStr(body.templateName);
  if (templateName) item.templateName = templateName;
  const templateLanguage = optStr(body.templateLanguage);
  if (templateLanguage) item.templateLanguage = templateLanguage;
  if (body.templateVariables && body.templateVariables.length) {
    item.templateVariables = { S: JSON.stringify(body.templateVariables) };
  }

  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: item,
    })
  );

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      callbackId,
      scheduledAt: new Date(ts).toISOString(),
      channel,
    }),
  };
};
