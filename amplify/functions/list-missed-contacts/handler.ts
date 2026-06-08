import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchContactsCommand,
  DescribeContactCommand,
  DescribeQueueCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

/**
 * list-missed-contacts
 *
 * Returns the contacts the agent failed to accept in the recent past
 * (default: last 24 hours). Useful to populate the "missed contacts"
 * drawer in the agent desktop so the agent can:
 *   - See who they missed
 *   - Click "Devolver" to place an outbound callback
 *   - Drill into the customer 360°
 *
 * Authoritative source: Amazon Connect's SearchContacts API. We filter
 * by AgentIds (the agent's GUID) + the time range, then keep only the
 * rows whose `DisconnectReason` indicates the contact was missed/rejected.
 *
 * Query params (GET):
 *   userId       — agent GUID (the portion after `agent/` in the agentARN).
 *                  REQUIRED.
 *   hours        — how far back to search. Default 24.
 *   limit        — max results returned. Default 50, cap 100.
 *
 * Response:
 *   200 { contacts: MissedRecord[] }
 *   400 { error } when userId missing
 *   500 { error, message } on failure
 */

// BYO Connect (#43): module-active. resolveConnect del handler entry setea
// `connect` e `instanceId` para tenant cross-account; fallback a Vox.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;

// Disconnect reasons Connect uses for contacts the agent didn't take.
// We match a superset — different instances and AWS releases use
// slightly different strings — and treat any of them as "missed".
const MISSED_REASONS = new Set([
  "AGENT_MISSED",
  "AGENT_REJECTED",
  "CONTACT_FLOW_DISCONNECT",
  "EXPIRED",
  "ABANDONED",
]);

// queueId cache keyeada por `${instanceId}:${queueId}` para no mezclar tenants.
const queueCache = new Map<string, string>();

async function resolveQueueName(queueId: string): Promise<string> {
  if (!queueId) return "";
  const k = `${instanceId}:${queueId}`;
  if (queueCache.has(k)) return queueCache.get(k)!;
  try {
    const res = await connect.send(
      new DescribeQueueCommand({
        InstanceId: instanceId,
        QueueId: queueId,
      })
    );
    const name = res.Queue?.Name || queueId;
    queueCache.set(k, name);
    return name;
  } catch {
    queueCache.set(k, queueId);
    return queueId;
  }
}

interface MissedRecord {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  customerEndpoint: string | null;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  /** seconds since the miss — clients can format relative time without
   *  re-parsing the timestamp. */
  ageSeconds: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const params = event.queryStringParameters || {};
  const userId: string = params.userId || "";
  const hours = Math.max(1, Math.min(168, parseInt(params.hours || "24")));
  const limit = Math.max(1, Math.min(100, parseInt(params.limit || "50")));

  if (!userId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "userId parameter required" }),
    };
  }

  // BYO Connect (#43): tenant primero, fallback Vox.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    connect = r.client;
    instanceId = r.instanceId;
  }

  if (!instanceId) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "CONNECT_INSTANCE_ID env var missing" }),
    };
  }

  try {
    const endTime = new Date();
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - hours);

    const result = await connect.send(
      new SearchContactsCommand({
        InstanceId: instanceId,
        TimeRange: {
          Type: "INITIATION_TIMESTAMP",
          StartTime: startTime,
          EndTime: endTime,
        },
        SearchCriteria: {
          // The SDK accepts agent GUIDs here (not the full ARN).
          AgentIds: [userId],
          Channels: ["VOICE", "CHAT", "TASK", "EMAIL"],
        },
        // SearchContacts returns up to 100 per page, so we bump the
        // ceiling and trust the post-filter to shrink the list.
        MaxResults: 100,
      })
    );

    const contacts = (result.Contacts || []) as Array<{
      Id?: string;
      Channel?: string;
      InitiationTimestamp?: Date;
      DisconnectTimestamp?: Date;
    }>;

    // We have to round-trip DescribeContact for each one because
    // SearchContacts doesn't return DisconnectReason — the field is
    // only on the detailed Contact object. Cap to ~30 lookups to keep
    // the call cheap even when the agent missed a lot.
    const detailed = await Promise.all(
      contacts.slice(0, 30).map(async (c) => {
        try {
          const detail = await connect.send(
            new DescribeContactCommand({
              InstanceId: instanceId,
              ContactId: c.Id!,
            })
          );
          return detail.Contact;
        } catch {
          return null;
        }
      })
    );

    const now = Date.now();
    const missed: MissedRecord[] = [];
    for (const contact of detailed) {
      if (!contact) continue;
      const reason = contact.DisconnectReason || "";
      // Filter to contacts that have no AgentInfo.ConnectedToAgentTimestamp
      // OR whose disconnect reason marks them as missed. AgentInfo only
      // gets populated AFTER the agent accepts, so its absence is a
      // strong signal the contact was missed/abandoned.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentInfo = contact.AgentInfo as any;
      const connected = !!agentInfo?.ConnectedToAgentTimestamp;
      const reasonMatch = MISSED_REASONS.has(reason);
      if (connected && !reasonMatch) continue; // agent answered — not missed

      const queueId = contact.QueueInfo?.Id || "";
      const queueName = queueId ? await resolveQueueName(queueId) : "";
      const initiationMs = contact.InitiationTimestamp?.getTime() || 0;
      missed.push({
        contactId: contact.Id || "",
        channel: contact.Channel || "VOICE",
        initiationTimestamp: contact.InitiationTimestamp?.toISOString() || "",
        disconnectTimestamp: contact.DisconnectTimestamp?.toISOString() || "",
        customerEndpoint: contact.CustomerEndpoint?.Address || null,
        queueName,
        initiationMethod: contact.InitiationMethod,
        disconnectReason: reason,
        ageSeconds: initiationMs ? Math.floor((now - initiationMs) / 1000) : 0,
      });
    }

    // Newest first, capped at the caller's limit.
    missed.sort(
      (a, b) =>
        new Date(b.initiationTimestamp).getTime() -
        new Date(a.initiationTimestamp).getTime()
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        windowHours: hours,
        totalMissed: missed.length,
        contacts: missed.slice(0, limit),
      }),
    };
  } catch (error) {
    console.error("list-missed-contacts failed:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list missed contacts",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
