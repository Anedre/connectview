import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchContactsCommand,
  DescribeContactCommand,
  DescribeUserCommand,
  DescribeQueueCommand,
} from "@aws-sdk/client-connect";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  ListProfileObjectsCommand,
} from "@aws-sdk/client-customer-profiles";

// maxAttempts: 1 → no SDK retries. The frontend will retry on next render.
const connect = new ConnectClient({ maxAttempts: 1 });
const profiles = new CustomerProfilesClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const CUSTOMER_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

// In-memory caches so we don't DescribeUser/DescribeQueue on every request.
const userCache = new Map<string, string>();
const queueCache = new Map<string, string>();

interface HistoricalContact {
  contactId: string;
  channel: string;
  subChannel?: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  customerEndpoint?: string;
  hasRecording: boolean;
}

async function resolveAgentUsername(agentId: string): Promise<string> {
  if (!agentId) return "";
  if (userCache.has(agentId)) return userCache.get(agentId)!;
  try {
    const res = await connect.send(
      new DescribeUserCommand({
        InstanceId: INSTANCE_ID,
        UserId: agentId,
      })
    );
    const username = res.User?.Username || agentId;
    userCache.set(agentId, username);
    return username;
  } catch {
    userCache.set(agentId, agentId);
    return agentId;
  }
}

async function resolveQueueName(queueId: string): Promise<string> {
  if (!queueId) return "";
  if (queueCache.has(queueId)) return queueCache.get(queueId)!;
  try {
    const res = await connect.send(
      new DescribeQueueCommand({
        InstanceId: INSTANCE_ID,
        QueueId: queueId,
      })
    );
    const name = res.Queue?.Name || queueId;
    queueCache.set(queueId, name);
    return name;
  } catch {
    queueCache.set(queueId, queueId);
    return queueId;
  }
}

// WhatsApp / SMS / Apple Messages in Connect are all channel=CHAT with
// a specific initiationMethod. Give the UI a cleaner sub-channel label.
function deriveSubChannel(
  channel: string,
  initiationMethod: string | undefined,
  customerEndpointType: string | undefined
): string | undefined {
  if (channel !== "CHAT") return undefined;
  if (initiationMethod === "API") return "Messaging API";
  if (initiationMethod === "MESSAGING_PLATFORM") {
    // WhatsApp, Facebook, SMS all come through the messaging platform;
    // differentiate by endpoint type when possible.
    if (customerEndpointType === "PHONE_NUMBER" || customerEndpointType === "TELEPHONE_NUMBER")
      return "WhatsApp/SMS";
    return "Messaging";
  }
  if (initiationMethod === "EXTERNAL_OUTBOUND") return "Outbound";
  return undefined;
}

// Parse the raw CTR JSON stored in Customer Profiles ObjectType "CTR"
// into our HistoricalContact shape. Returns null if the record is malformed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCtr(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function findProfileId(phone: string): Promise<string | null> {
  try {
    const res = await profiles.send(
      new SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone],
      })
    );
    return res.Items?.[0]?.ProfileId || null;
  } catch (err) {
    console.warn("SearchProfiles failed, will fall back to SearchContacts:", err);
    return null;
  }
}

async function listProfileCtrs(
  profileId: string,
  cap: number
): Promise<HistoricalContact[]> {
  // ListProfileObjects caps each call at 100; paginate with NextToken until
  // we've gathered enough rows. cap is the upper bound; we never exceed it
  // because the frontend only ever renders ~200 entries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];
  let nextToken: string | undefined = undefined;
  while (items.length < cap) {
    const res: import("@aws-sdk/client-customer-profiles").ListProfileObjectsCommandOutput =
      await profiles.send(
        new ListProfileObjectsCommand({
          DomainName: CUSTOMER_PROFILES_DOMAIN,
          ProfileId: profileId,
          ObjectTypeName: "CTR",
          MaxResults: 100,
          NextToken: nextToken,
        })
      );
    items.push(...(res.Items || []));
    if (!res.NextToken) break;
    nextToken = res.NextToken;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any[] = items
    .map((item) => parseCtr(item.Object || "{}"))
    .filter((ctr) => ctr && ctr.contactId);

  // Resolve agent & queue names in parallel but deduped via caches.
  const rows: HistoricalContact[] = await Promise.all(
    parsed.map(async (ctr) => {
      const agentId = ctr.agent?.arn?.split("/").pop() || ctr.agent?.id || "";
      const queueId = ctr.queue?.arn?.split("/").pop() || ctr.queue?.id || "";
      const [agentUsername, queueName] = await Promise.all([
        agentId ? resolveAgentUsername(agentId) : Promise.resolve(""),
        queueId ? resolveQueueName(queueId) : Promise.resolve(ctr.queue?.name || ""),
      ]);

      const initiationMs = typeof ctr.initiationTimestamp === "number"
        ? ctr.initiationTimestamp
        : Date.parse(ctr.initiationTimestamp || "") || 0;
      const disconnectMs = typeof ctr.disconnectTimestamp === "number"
        ? ctr.disconnectTimestamp
        : Date.parse(ctr.disconnectTimestamp || "") || 0;
      const duration = initiationMs && disconnectMs
        ? Math.max(0, Math.round((disconnectMs - initiationMs) / 1000))
        : 0;

      return {
        contactId: ctr.contactId,
        channel: ctr.channel || "UNKNOWN",
        subChannel: deriveSubChannel(
          ctr.channel,
          ctr.initiationMethod,
          ctr.customerEndpoint?.type
        ),
        initiationTimestamp: initiationMs ? new Date(initiationMs).toISOString() : "",
        disconnectTimestamp: disconnectMs ? new Date(disconnectMs).toISOString() : "",
        duration,
        agentUsername,
        queueName: queueName || ctr.queue?.name || "",
        initiationMethod: ctr.initiationMethod,
        disconnectReason: ctr.disconnectReason,
        customerEndpoint: ctr.customerEndpoint?.address,
        hasRecording: Array.isArray(ctr.recordings) && ctr.recordings.length > 0,
      };
    })
  );

  return rows;
}

async function searchContactsFallback(
  phone: string,
  maxDays: number
): Promise<HistoricalContact[]> {
  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - maxDays);

  const result = await connect.send(
    new SearchContactsCommand({
      InstanceId: INSTANCE_ID,
      TimeRange: {
        Type: "INITIATION_TIMESTAMP",
        StartTime: startTime,
        EndTime: endTime,
      },
      // Explicit list — make sure we don't miss any channel AWS adds later.
      SearchCriteria: {
        Channels: ["VOICE", "CHAT", "TASK", "EMAIL"],
      },
      MaxResults: 100,
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matching = ((result.Contacts as any[]) || []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) =>
      c.CustomerEndpoint?.Address === phone ||
      c.CustomerEndpoint?.Value === phone
  );

  const rows = await Promise.all(
    matching.slice(0, 20).map(async (c) => {
      try {
        const detail = await connect.send(
          new DescribeContactCommand({
            InstanceId: INSTANCE_ID,
            ContactId: c.Id!,
          })
        );
        const contact = detail.Contact;
        const duration =
          contact?.DisconnectTimestamp && contact?.InitiationTimestamp
            ? Math.round(
                (contact.DisconnectTimestamp.getTime() -
                  contact.InitiationTimestamp.getTime()) / 1000
              )
            : 0;

        const agentId = contact?.AgentInfo?.Id || "";
        const queueId = contact?.QueueInfo?.Id || "";
        const [agentUsername, queueName] = await Promise.all([
          agentId ? resolveAgentUsername(agentId) : Promise.resolve(""),
          queueId ? resolveQueueName(queueId) : Promise.resolve(""),
        ]);

        return {
          contactId: c.Id as string,
          channel: contact?.Channel || "UNKNOWN",
          subChannel: deriveSubChannel(
            contact?.Channel || "",
            contact?.InitiationMethod,
            contact?.CustomerEndpoint?.Type
          ),
          initiationTimestamp: contact?.InitiationTimestamp?.toISOString() || "",
          disconnectTimestamp: contact?.DisconnectTimestamp?.toISOString() || "",
          duration,
          agentUsername,
          queueName,
          initiationMethod: contact?.InitiationMethod,
          disconnectReason: contact?.DisconnectReason,
          customerEndpoint: contact?.CustomerEndpoint?.Address,
          hasRecording: (contact?.Recordings?.length || 0) > 0,
        };
      } catch {
        return {
          contactId: c.Id as string,
          channel: "UNKNOWN",
          initiationTimestamp: c.InitiationTimestamp?.toISOString?.() || "",
          disconnectTimestamp: "",
          duration: 0,
          agentUsername: "",
          queueName: "",
          hasRecording: false,
        };
      }
    })
  );

  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const phone = event.queryStringParameters?.phone;
  const maxDays = parseInt(event.queryStringParameters?.days || "90");
  // Cap pagination — defaults to 200 (enough for the heaviest active customer
  // we have today) but the frontend can request fewer when it knows the
  // visible viewport. Hard-cap at 500 so a hostile caller can't loop forever.
  const requestedLimit = parseInt(event.queryStringParameters?.limit || "200");
  const cap = Math.min(Math.max(requestedLimit, 1), 500);

  if (!phone) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "phone parameter required" }),
    };
  }

  try {
    let contacts: HistoricalContact[] = [];
    let source: "customer-profiles" | "search-contacts" | "none" = "none";

    // Strategy 1: Customer Profiles — includes ALL channels (VOICE, CHAT, EMAIL,
    // TASK, WhatsApp/SMS) because Connect auto-ingests CTRs into the profile.
    const profileId = await findProfileId(phone);
    if (profileId) {
      try {
        contacts = await listProfileCtrs(profileId, cap);
        source = "customer-profiles";
      } catch (err) {
        console.warn("ListProfileObjects failed, falling back:", err);
      }
    }

    // Strategy 2 (fallback): SearchContacts with all channels.
    if (contacts.length === 0) {
      contacts = await searchContactsFallback(phone, maxDays);
      source = contacts.length > 0 ? "search-contacts" : "none";
    }

    // Sort newest first
    contacts.sort(
      (a, b) =>
        new Date(b.initiationTimestamp).getTime() -
        new Date(a.initiationTimestamp).getTime()
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        source,
        totalContacts: contacts.length,
        contacts,
      }),
    };
  } catch (error) {
    console.error("Error getting contact history:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get contact history",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
