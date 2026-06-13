import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchContactsCommand,
  DescribeContactCommand,
  ListContactReferencesCommand,
  GetAttachedFileCommand,
  DescribeUserCommand,
} from "@aws-sdk/client-connect";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  ListProfileObjectsCommand,
} from "@aws-sdk/client-customer-profiles";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO (#43+#46): module-active. Connect + S3 + Customer Profiles + domain.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 1 });
let profiles: CustomerProfilesClient = legacyProfiles;
const legacyS3 = new S3Client({});
let s3: S3Client = legacyS3;

const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;
const LEGACY_CUSTOMER_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
let CUSTOMER_PROFILES_DOMAIN = LEGACY_CUSTOMER_PROFILES_DOMAIN;
const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "";
const PRESIGN_EXPIRES = 3600;

const CORS: Record<string, string> = { "Content-Type": "application/json" };
const userNameCache = new Map<string, string>();

interface ThreadMessage {
  /** Stable id (Connect message Id when present, else synthetic). */
  id: string;
  /** "message" → text, "attachment" → media/file, "event" → joined/left/etc. */
  type: "message" | "attachment" | "event";
  participant: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
  /** Visible text. May be empty for ATTACHMENT/EVENT segments. */
  content: string;
  /** Original Connect ContentType (e.g. "text/plain", "application/json"). */
  contentType?: string;
  /** For type === "event": "participant.joined", "chat.ended", etc. */
  eventKind?: string;
  /** ISO8601 absolute timestamp. */
  timestamp: string;
  /** Which Connect contact session this message belongs to. */
  contactId: string;
  /** Agent username when participant === AGENT (filled at the session level). */
  agentUsername?: string;
  /** Resolved attachment metadata (only for type === "attachment"). */
  attachment?: {
    id: string;
    name?: string;
    contentType?: string;
    sizeBytes?: number;
    /** Presigned URL — expires in 1 hour. */
    url: string | null;
  };
}

interface ThreadSession {
  contactId: string;
  startTime: string;
  endTime: string;
  agentUsername: string;
  /** Connect sub-channel (WhatsApp/SMS/Messaging API/...) for UI labelling. */
  subChannel?: string;
  messageCount: number;
}

async function resolveAgentUsername(agentId: string): Promise<string> {
  if (!agentId) return "";
  const k = `${instanceId}:${agentId}`;
  if (userNameCache.has(k)) return userNameCache.get(k)!;
  try {
    const r = await connect.send(
      new DescribeUserCommand({
        InstanceId: instanceId,
        UserId: agentId,
      })
    );
    const name = r.User?.Username || agentId;
    userNameCache.set(k, name);
    return name;
  } catch {
    userNameCache.set(k, agentId);
    return agentId;
  }
}

function deriveSubChannel(
  initiationMethod: string | undefined,
  customerEndpointType: string | undefined
): string | undefined {
  if (initiationMethod === "API") return "Messaging API";
  if (initiationMethod === "MESSAGING_PLATFORM") {
    if (
      customerEndpointType === "PHONE_NUMBER" ||
      customerEndpointType === "TELEPHONE_NUMBER"
    )
      return "WhatsApp/SMS";
    return "Messaging";
  }
  return undefined;
}

function parseS3Location(location: string | undefined): { bucket: string; key: string } | null {
  if (!location) return null;
  const withProto = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (withProto) return { bucket: withProto[1], key: withProto[2] };
  const slash = location.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: location.slice(0, slash), key: location.slice(slash + 1) };
}

/**
 * Returns the list of CHAT contactIds for the given phone, using
 * Customer Profiles (preferred — includes ALL channels via ingested CTRs)
 * and falling back to SearchContacts when no profile exists yet.
 */
interface ThreadDiag {
  strategy: "customer-profiles" | "search-contacts" | "none";
  profileFound: boolean;
  ctrTotal: number;
  chatMatched: number;
  /** Distinct raw channel values seen in the profile CTRs (case as stored). */
  channelsSeen: string[];
}

async function findChatContactIds(phone: string): Promise<{
  ids: Array<{ contactId: string; initiationTimestamp: string; channel: string }>;
  diag: ThreadDiag;
}> {
  const diag: ThreadDiag = {
    strategy: "none",
    profileFound: false,
    ctrTotal: 0,
    chatMatched: 0,
    channelsSeen: [],
  };

  // Strategy 1: Customer Profiles CTRs.
  try {
    const sp = await profiles.send(
      new SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone],
      })
    );
    const profileId = sp.Items?.[0]?.ProfileId;
    diag.profileFound = !!profileId;
    if (profileId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];
      let nextToken: string | undefined = undefined;
      while (items.length < 500) {
        const r: import("@aws-sdk/client-customer-profiles").ListProfileObjectsCommandOutput =
          await profiles.send(
            new ListProfileObjectsCommand({
              DomainName: CUSTOMER_PROFILES_DOMAIN,
              ProfileId: profileId,
              ObjectTypeName: "CTR",
              MaxResults: 100,
              NextToken: nextToken,
            })
          );
        items.push(...(r.Items || []));
        if (!r.NextToken) break;
        nextToken = r.NextToken;
      }
      const parsed = items
         
        .map((it) => {
          try {
            return JSON.parse(it.Object || "{}");
          } catch {
            return null;
          }
        })
        .filter((ctr) => ctr && ctr.contactId);
      diag.ctrTotal = parsed.length;
      const seenChannels = new Set<string>();
      for (const ctr of parsed)
        seenChannels.add(String(ctr.channel ?? ctr.Channel ?? "(none)"));
      diag.channelsSeen = [...seenChannels].slice(0, 10);

      const ids = parsed
        // Channel match must be case/space-insensitive: distintos tenants
        // ingieren el CTR con "CHAT" / "chat" / "Chat" (y a veces la clave es
        // `Channel`). El badge (useLeadOverview) ya normaliza con toUpperCase,
        // así que si acá comparábamos `=== "CHAT"` exacto, el hilo encontraba 0
        // mientras el badge contaba N → "sin mensajes" falso. (#grabaciones)
        .filter(
          (ctr) =>
            String(ctr.channel ?? ctr.Channel ?? "")
              .trim()
              .toUpperCase() === "CHAT"
        )
        .map((ctr) => ({
          contactId: ctr.contactId,
          initiationTimestamp: ctr.initiationTimestamp
            ? new Date(
                typeof ctr.initiationTimestamp === "number"
                  ? ctr.initiationTimestamp
                  : Date.parse(ctr.initiationTimestamp)
              ).toISOString()
            : "",
          channel: "CHAT",
        }));
      diag.chatMatched = ids.length;
      if (ids.length > 0) {
        diag.strategy = "customer-profiles";
        return { ids, diag };
      }
    }
  } catch (err) {
    console.warn("Customer Profiles lookup failed:", err);
  }

  // Strategy 2: SearchContacts fallback (CHAT). DOS bugs que dejaban el hilo en
  // 0 pese a que get-contact-history sí encontraba los chats (#grabaciones):
  //   1) SearchContacts limita el TimeRange a ~56 días (1345h); pedíamos 90 →
  //      tiraba 500, el catch devolvía 0 y la diag quedaba en strategy:"none".
  //      Capamos a 55 (igual que get-contact-history).
  //   2) El RESUMEN de SearchContacts NO incluye CustomerEndpoint, así que
  //      filtrar c.CustomerEndpoint?.Address sobre el summary daba siempre 0.
  //      Hay que DescribeContact cada uno y RECIÉN ahí filtrar por teléfono.
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 55);
    const sc = await connect.send(
      new SearchContactsCommand({
        InstanceId: instanceId,
        TimeRange: {
          Type: "INITIATION_TIMESTAMP",
          StartTime: start,
          EndTime: end,
        },
        SearchCriteria: { Channels: ["CHAT"] },
        // Más recientes primero → el slice(0,50) de describes toma los nuevos.
        Sort: { FieldName: "INITIATION_TIMESTAMP", Order: "DESCENDING" },
        MaxResults: 100,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summaries = ((sc.Contacts as any[]) || []).slice(0, 50);
    const detailed = (
      await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        summaries.map(async (c: any) => {
          try {
            const d = await connect.send(
              new DescribeContactCommand({
                InstanceId: instanceId,
                ContactId: c.Id,
              })
            );
            return d.Contact || null;
          } catch {
            return null;
          }
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ).filter((x): x is any => !!x);
    const ids = detailed
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) =>
          c.CustomerEndpoint?.Address === phone ||
          c.CustomerEndpoint?.Value === phone
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({
        contactId: (c.Id as string) || "",
        initiationTimestamp: c.InitiationTimestamp
          ? new Date(c.InitiationTimestamp).toISOString()
          : "",
        channel: (c.Channel as string) || "CHAT",
      }))
      .filter((x) => x.contactId);
    diag.strategy = "search-contacts";
    diag.chatMatched = ids.length;
    return { ids, diag };
  } catch (err) {
    console.warn("SearchContacts fallback failed:", err);
    diag.strategy = "search-contacts-error";
    return { ids: [], diag };
  }
}

interface ChatRawSegment {
  Type?: string;
  type?: string;
  ParticipantRole?: string;
  participantRole?: string;
  Content?: string;
  content?: string;
  ContentType?: string;
  contentType?: string;
  AbsoluteTime?: string;
  absoluteTime?: string;
  Id?: string;
  id?: string;
  Attachments?: Array<{
    AttachmentId?: string;
    attachmentId?: string;
    AttachmentName?: string;
    attachmentName?: string;
    ContentType?: string;
    contentType?: string;
  }>;
}

/**
 * Reads the chat-transcript JSON for one contact from S3 and projects each
 * Connect message into a flat ThreadMessage with absolute timestamp.
 * `recordings` is what DescribeContact returned in Contact.Recordings.
 */
async function readChatTranscript(
  recordings: Array<{ Location?: string; MediaStreamType?: string }>,
  contactId: string,
  agentUsername: string
): Promise<ThreadMessage[]> {
  const chatRec = recordings.find((r) => {
    if (!r.Location) return false;
    if (r.MediaStreamType === "CHAT") return true;
    const lower = r.Location.toLowerCase();
    return (
      lower.includes("chattranscripts") ||
      lower.includes("chat-transcripts") ||
      lower.includes("chat_transcripts")
    );
  });
  if (!chatRec?.Location) return [];

  const s3loc = parseS3Location(chatRec.Location);
  if (!s3loc) return [];

  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: s3loc.bucket, Key: s3loc.key })
    );
    const text = await obj.Body?.transformToString();
    if (!text) return [];

    const parsed = JSON.parse(text);
    const list: ChatRawSegment[] = parsed.Transcript || parsed.transcript || [];

    return list.map((s, idx): ThreadMessage => {
      const ts = s.AbsoluteTime || s.absoluteTime || "";
      const participant = (s.ParticipantRole ||
        s.participantRole ||
        "UNKNOWN") as ThreadMessage["participant"];
      const sType = (s.Type || s.type || "MESSAGE").toUpperCase();
      const id = s.Id || s.id || `${contactId}:${idx}`;
      const content = s.Content || s.content || "";
      const contentType = s.ContentType || s.contentType || undefined;
      const baseAgent = participant === "AGENT" ? agentUsername : undefined;

      if (
        sType === "ATTACHMENT" ||
        (Array.isArray(s.Attachments) && s.Attachments.length > 0)
      ) {
        const att = (s.Attachments || [])[0] || {};
        return {
          id,
          type: "attachment",
          participant,
          content,
          contentType,
          timestamp: ts,
          contactId,
          agentUsername: baseAgent,
          attachment: {
            id: att.AttachmentId || att.attachmentId || "",
            name: att.AttachmentName || att.attachmentName,
            contentType: att.ContentType || att.contentType,
            url: null, // resolved later in a single pass via GetAttachedFile
          },
        };
      }
      if (sType === "EVENT") {
        const rawCt = contentType || "";
        const kind = rawCt.replace(
          /^application\/vnd\.amazonaws\.connect\.event\./,
          ""
        );
        return {
          id,
          type: "event",
          participant,
          content,
          contentType,
          eventKind: kind || "unknown",
          timestamp: ts,
          contactId,
          agentUsername: baseAgent,
        };
      }
      return {
        id,
        type: "message",
        participant,
        content,
        contentType,
        timestamp: ts,
        contactId,
        agentUsername: baseAgent,
      };
    });
  } catch (err) {
    console.warn(`readChatTranscript(${contactId}) failed:`, err);
    return [];
  }
}

/**
 * For each attachment segment, call GetAttachedFile to get a presigned
 * URL + the real fileSizeBytes. Done in one batch per contact so we issue
 * fewer Connect API calls when a session has many attachments.
 */
async function resolveAttachmentUrls(
  messagesBySession: Map<string, ThreadMessage[]>
): Promise<void> {
  for (const [contactId, msgs] of messagesBySession) {
    const attachmentMsgs = msgs.filter(
      (m) => m.type === "attachment" && m.attachment?.id
    );
    if (attachmentMsgs.length === 0) continue;

    const arn = `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${instanceId}/contact/${contactId}`;
    // GetAttachedFile is serial per file — Connect doesn't accept a batch.
    // Cap at 50 per session to bound Lambda runtime.
    for (const m of attachmentMsgs.slice(0, 50)) {
      try {
        const r = await connect.send(
          new GetAttachedFileCommand({
            InstanceId: instanceId,
            FileId: m.attachment!.id,
            AssociatedResourceArn: arn,
            UrlExpiryInSeconds: PRESIGN_EXPIRES,
          })
        );
        m.attachment!.url = r.DownloadUrl ?? null;
        m.attachment!.sizeBytes = r.FileSizeInBytes;
      } catch (err) {
        console.warn(
          `GetAttachedFile failed for ${m.attachment!.id} in ${contactId}:`,
          err
        );
      }
    }

    // Some chats also include ATTACHMENT references at the contact level
    // (not embedded in the transcript) — pull them in too as synthetic
    // attachment messages dated at the contact's last update.
    try {
      const refs = await connect.send(
        new ListContactReferencesCommand({
          InstanceId: instanceId,
          ContactId: contactId,
          ReferenceTypes: ["ATTACHMENT"],
        })
      );
      const existingIds = new Set(
        attachmentMsgs.map((m) => m.attachment!.id)
      );
      for (const ref of refs.ReferenceSummaryList || []) {
        const att = ref.Attachment;
        if (!att?.Name || existingIds.has(att.Name)) continue;
        try {
          const r = await connect.send(
            new GetAttachedFileCommand({
              InstanceId: instanceId,
              FileId: att.Name,
              AssociatedResourceArn: arn,
              UrlExpiryInSeconds: PRESIGN_EXPIRES,
            })
          );
          // Use the last message's timestamp as a proxy, or "now" as fallback.
          const fallbackTs =
            msgs.length > 0
              ? msgs[msgs.length - 1].timestamp
              : new Date().toISOString();
          msgs.push({
            id: `${contactId}:contact-ref:${att.Name}`,
            type: "attachment",
            participant: "AGENT",
            content: "",
            timestamp: fallbackTs,
            contactId,
            attachment: {
              id: att.Name,
              name: (att.Value || "").split("/").pop() || att.Name,
              url: r.DownloadUrl ?? null,
              sizeBytes: r.FileSizeInBytes,
            },
          });
        } catch {
          // ignore individual file failures
        }
      }
    } catch {
      // ListContactReferences failure is non-fatal — skip
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // BYO (#43+#46): tenant primero, fallback Novasys.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    connect = r.client;
    instanceId = r.instanceId;
    s3 = r.s3 || legacyS3;
    profiles = r.customerProfiles || legacyProfiles;
    // Fail-closed: tenant real sin CP resuelto → "" (Strategy 1 se saltea y
    // cae a SearchContacts del Connect del tenant), NUNCA el dominio de Novasys.
    CUSTOMER_PROFILES_DOMAIN = r.tenantScoped
      ? r.customerProfilesDomain || ""
      : LEGACY_CUSTOMER_PROFILES_DOMAIN;
  }
  const phone = event?.queryStringParameters?.phone;
  if (!phone) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "phone parameter required" }),
    };
  }

  try {
    // 1. Find every CHAT contact for this customer.
    const { ids: chatIds, diag } = await findChatContactIds(phone);
    if (chatIds.length === 0) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          phone,
          totalSessions: 0,
          totalMessages: 0,
          sessions: [],
          messages: [],
          daysWithActivity: {},
          diagnostics: { ...diag, describedOk: 0, withTranscript: 0 },
        }),
      };
    }

    // 2. DescribeContact + read transcript for each, in parallel.
    const sessions: ThreadSession[] = [];
    const messagesBySession = new Map<string, ThreadMessage[]>();

    await Promise.all(
      chatIds.map(async (entry) => {
        try {
          const detail = await connect.send(
            new DescribeContactCommand({
              InstanceId: instanceId,
              ContactId: entry.contactId,
            })
          );
          const c = detail.Contact;
          if (!c) return;

          const agentId = c.AgentInfo?.Id || "";
          const agentUsername = agentId
            ? await resolveAgentUsername(agentId)
            : "";

          const msgs = await readChatTranscript(
            c.Recordings || [],
            entry.contactId,
            agentUsername
          );
          messagesBySession.set(entry.contactId, msgs);

          sessions.push({
            contactId: entry.contactId,
            startTime: c.InitiationTimestamp?.toISOString() || "",
            endTime: c.DisconnectTimestamp?.toISOString() || "",
            agentUsername,
            subChannel: deriveSubChannel(
              c.InitiationMethod,
              c.CustomerEndpoint?.Type
            ),
            messageCount: msgs.length,
          });
        } catch (err) {
          console.warn(`session ${entry.contactId} failed:`, err);
        }
      })
    );

    // 3. Resolve every attachment URL (per-session batches).
    await resolveAttachmentUrls(messagesBySession);

    // 4. Flatten + sort chronologically. Within the same timestamp, preserve
    //    per-session order (which is the JSON file order — chronological too).
    const all: ThreadMessage[] = [];
    for (const msgs of messagesBySession.values()) all.push(...msgs);
    all.sort((a, b) => {
      const ta = Date.parse(a.timestamp) || 0;
      const tb = Date.parse(b.timestamp) || 0;
      if (ta !== tb) return ta - tb;
      return 0;
    });

    // 5. Compute per-day histogram for the calendar picker (YYYY-MM-DD → count).
    const daysWithActivity: Record<string, number> = {};
    for (const m of all) {
      if (m.type === "event") continue; // don't count joins/leaves for "activity"
      const d = m.timestamp.slice(0, 10); // YYYY-MM-DD
      if (!d) continue;
      daysWithActivity[d] = (daysWithActivity[d] || 0) + 1;
    }

    sessions.sort(
      (a, b) =>
        (Date.parse(a.startTime) || 0) - (Date.parse(b.startTime) || 0)
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        phone,
        totalSessions: sessions.length,
        totalMessages: all.length,
        sessions,
        messages: all,
        daysWithActivity,
        diagnostics: {
          ...diag,
          describedOk: sessions.length,
          withTranscript: sessions.filter((s) => s.messageCount > 0).length,
        },
      }),
    };
  } catch (err) {
    console.error("get-customer-thread error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "Failed to build customer thread",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
