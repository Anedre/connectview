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
import { resolveConnect } from "../_shared/tenantConnect";

// BYO (#43+#46): module-active. maxAttempts:1 → frontend reintenta en
// próximo render.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 1 });
let profiles: CustomerProfilesClient = legacyProfiles;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;
const LEGACY_CUSTOMER_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
let CUSTOMER_PROFILES_DOMAIN = LEGACY_CUSTOMER_PROFILES_DOMAIN;

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
  const k = `${instanceId}:${agentId}`;
  if (userCache.has(k)) return userCache.get(k)!;
  try {
    const res = await connect.send(
      new DescribeUserCommand({
        InstanceId: instanceId,
        UserId: agentId,
      })
    );
    const username = res.User?.Username || agentId;
    userCache.set(k, username);
    return username;
  } catch {
    userCache.set(k, agentId);
    return agentId;
  }
}

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

      // Normalizá el canal (CHAT/chat/Chat → CHAT) para que deriveSubChannel
      // pueda etiquetar "WhatsApp/SMS" y el frontend cuente bien. (#grabaciones)
      const channel =
        String(ctr.channel ?? ctr.Channel ?? "").trim().toUpperCase() ||
        "UNKNOWN";

      return {
        contactId: ctr.contactId,
        channel,
        subChannel: deriveSubChannel(
          channel,
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
  // SearchContacts limita el TimeRange a 1345h (~56 días). Si el front pide más
  // (el perfil pide 90), capamos a 55 para no tirar 500 (que dejaba el panel en
  // "Sin interacciones"). Historial >55 días → requiere CTRs en Customer Profiles.
  const cappedDays = Math.min(maxDays, 55);
  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - cappedDays);

  const result = await connect.send(
    new SearchContactsCommand({
      InstanceId: instanceId,
      TimeRange: {
        Type: "INITIATION_TIMESTAMP",
        StartTime: startTime,
        EndTime: endTime,
      },
      // Explicit list — make sure we don't miss any channel AWS adds later.
      SearchCriteria: {
        Channels: ["VOICE", "CHAT", "TASK", "EMAIL"],
      },
      // Más RECIENTES primero — así el slice(0,50) de abajo (que DescribeContamos
      // para sacar el teléfono del cliente) toma los contactos más nuevos, no un
      // subconjunto arbitrario de la ventana. Sin esto, ventanas grandes devolvían 0.
      Sort: { FieldName: "INITIATION_TIMESTAMP", Order: "DESCENDING" },
      MaxResults: 100,
    })
  );

  // SearchContacts NO incluye el CustomerEndpoint en el resumen, así que hay que
  // DescribeContact cada resultado para obtener el teléfono del cliente y RECIÉN
  // ahí filtrar. (El bug: antes filtraba por c.CustomerEndpoint?.Address sobre el
  // summary → siempre undefined → 0 resultados.) Capamos a 50 (los más recientes)
  // para no martillar la API; cubre clientes con contactos recientes. Historial
  // completo de clientes viejos → requiere ingesta de CTRs en Customer Profiles.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const summaries = ((result.Contacts as any[]) || []).slice(0, 50);
  const detailed = (
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      summaries.map(async (c: any) => {
        try {
          const detail = await connect.send(
            new DescribeContactCommand({
              InstanceId: instanceId,
              ContactId: c.Id!,
            })
          );
          return detail.Contact || null;
        } catch {
          return null;
        }
      })
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ).filter((x): x is any => !!x);

  const matching = detailed.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contact: any) => contact.CustomerEndpoint?.Address === phone
  );

  const rows = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    matching.slice(0, 20).map(async (contact: any) => {
      const duration =
        contact.DisconnectTimestamp && contact.InitiationTimestamp
          ? Math.round(
              (contact.DisconnectTimestamp.getTime() -
                contact.InitiationTimestamp.getTime()) / 1000
            )
          : 0;
      const agentId = contact.AgentInfo?.Id || "";
      const queueId = contact.QueueInfo?.Id || "";
      const [agentUsername, queueName] = await Promise.all([
        agentId ? resolveAgentUsername(agentId) : Promise.resolve(""),
        queueId ? resolveQueueName(queueId) : Promise.resolve(""),
      ]);
      return {
        contactId: contact.Id as string,
        channel: contact.Channel || "UNKNOWN",
        subChannel: deriveSubChannel(
          contact.Channel || "",
          contact.InitiationMethod,
          contact.CustomerEndpoint?.Type
        ),
        initiationTimestamp: contact.InitiationTimestamp?.toISOString() || "",
        disconnectTimestamp: contact.DisconnectTimestamp?.toISOString() || "",
        duration,
        agentUsername,
        queueName,
        initiationMethod: contact.InitiationMethod,
        disconnectReason: contact.DisconnectReason,
        customerEndpoint: contact.CustomerEndpoint?.Address,
        hasRecording: (contact.Recordings?.length || 0) > 0,
      };
    })
  );

  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // BYO (#43+#46): tenant primero, fallback Novasys.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    connect = r.client;
    instanceId = r.instanceId;
    profiles = r.customerProfiles || legacyProfiles;
    // Fail-closed: tenant real sin CP resuelto → "" (Strategy 1 se saltea y
    // cae a SearchContacts del Connect del tenant), NUNCA el dominio de Novasys.
    CUSTOMER_PROFILES_DOMAIN = r.tenantScoped
      ? r.customerProfilesDomain || ""
      : LEGACY_CUSTOMER_PROFILES_DOMAIN;
  }
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
