import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchContactsCommand,
  DescribeContactCommand,
  ListContactReferencesCommand,
  GetAttachedFileCommand,
} from "@aws-sdk/client-connect";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  ListProfileObjectsCommand,
} from "@aws-sdk/client-customer-profiles";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO (#43+#46): module-active.
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

interface CustomerAttachment {
  id: string;
  name: string;
  contentType?: string;
  sizeBytes?: number;
  /** Presigned URL — expires in 1h. */
  url: string | null;
  /** Connect contactId where this file came from. */
  sourceContactId: string;
  /** VOICE | CHAT | EMAIL | TASK. */
  sourceChannel: string;
  /** Optional sub-channel ("WhatsApp/SMS", "Messaging API", …). */
  sourceSubChannel?: string;
  /** AGENT or CUSTOMER — who shared the file. */
  from: "AGENT" | "CUSTOMER" | "UNKNOWN";
  /** ISO timestamp of when the file was shared. */
  timestamp: string;
  /** Heuristic mediaKind for grid grouping. */
  kind: "image" | "video" | "audio" | "pdf" | "document" | "other";
}

function parseS3Location(location: string | undefined): { bucket: string; key: string } | null {
  if (!location) return null;
  const withProto = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (withProto) return { bucket: withProto[1], key: withProto[2] };
  const slash = location.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: location.slice(0, slash), key: location.slice(slash + 1) };
}

function classifyMedia(contentType?: string, name?: string): CustomerAttachment["kind"] {
  const ct = (contentType || "").toLowerCase();
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (ct.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext))
    return "image";
  if (ct.startsWith("video/") || ["mp4", "mov", "webm", "avi"].includes(ext)) return "video";
  if (ct.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (
    ct.includes("word") ||
    ct.includes("excel") ||
    ct.includes("sheet") ||
    ct.includes("powerpoint") ||
    ct.includes("presentation") ||
    ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"].includes(ext)
  )
    return "document";
  return "other";
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

interface ContactBrief {
  contactId: string;
  channel: string;
}

async function findContacts(phone: string): Promise<ContactBrief[]> {
  // Same dual strategy as get-customer-thread — but we include ALL channels.
  try {
    const sp = await profiles.send(
      new SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone],
      })
    );
    const profileId = sp.Items?.[0]?.ProfileId;
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
      const out = items
         
        .map((it) => {
          try {
            return JSON.parse(it.Object || "{}");
          } catch {
            return null;
          }
        })
        .filter((ctr) => ctr && ctr.contactId)
        .map((ctr) => ({ contactId: ctr.contactId, channel: ctr.channel || "" }));
      if (out.length > 0) return out;
    }
  } catch (err) {
    console.warn("Customer Profiles lookup failed:", err);
  }

  // SearchContacts fallback. Mismos dos fixes que get-customer-thread
  // (#grabaciones): (1) ventana ≤55 días — SearchContacts tira 500 por encima
  // de ~56d (1345h), lo que dejaba `briefs` en [] → 0 archivos; (2) el resumen
  // de SearchContacts NO incluye CustomerEndpoint, así que filtrar sobre el
  // summary daba siempre 0 — hay que DescribeContact y RECIÉN filtrar.
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
        SearchCriteria: { Channels: ["VOICE", "CHAT", "EMAIL", "TASK"] },
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
    return detailed
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) =>
          c.CustomerEndpoint?.Address === phone ||
          c.CustomerEndpoint?.Value === phone
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({
        contactId: (c.Id as string) || "",
        channel: (c.Channel as string) || "",
      }))
      .filter((x) => x.contactId);
  } catch {
    return [];
  }
}

interface ChatTranscriptAttachment {
  attachmentId: string;
  name?: string;
  contentType?: string;
  from: "AGENT" | "CUSTOMER" | "UNKNOWN";
  timestamp: string;
}

/**
 * Inspect a chat transcript JSON in S3 and pull every ATTACHMENT segment.
 * Returns the attachmentId list (we still need GetAttachedFile to presign).
 */
async function readChatAttachments(
  recordings: Array<{ Location?: string; MediaStreamType?: string }>
): Promise<ChatTranscriptAttachment[]> {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = parsed.Transcript || parsed.transcript || [];
    const out: ChatTranscriptAttachment[] = [];
    for (const s of list) {
      const sType = (s.Type || s.type || "").toUpperCase();
      const isAttachment =
        sType === "ATTACHMENT" ||
        (Array.isArray(s.Attachments) && s.Attachments.length > 0);
      if (!isAttachment) continue;
      const att = (s.Attachments || [])[0] || {};
      const id = att.AttachmentId || att.attachmentId;
      if (!id) continue;
      const role = (s.ParticipantRole || s.participantRole || "").toUpperCase();
      out.push({
        attachmentId: id,
        name: att.AttachmentName || att.attachmentName,
        contentType: att.ContentType || att.contentType,
        from: role === "AGENT" ? "AGENT" : role === "CUSTOMER" ? "CUSTOMER" : "UNKNOWN",
        timestamp: s.AbsoluteTime || s.absoluteTime || "",
      });
    }
    return out;
  } catch (err) {
    console.warn("readChatAttachments failed:", err);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // BYO (#43+#46): tenant primero.
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
    const briefs = await findContacts(phone);
    if (briefs.length === 0) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ phone, totalAttachments: 0, attachments: [] }),
      };
    }

    const all: CustomerAttachment[] = [];

    // Process contacts in parallel; per-contact attachments collected serially
    // because GetAttachedFile doesn't batch.
    await Promise.all(
      briefs.map(async (b) => {
        try {
          const detail = await connect.send(
            new DescribeContactCommand({
              InstanceId: instanceId,
              ContactId: b.contactId,
            })
          );
          const c = detail.Contact;
          if (!c) return;

          const arn = `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${instanceId}/contact/${b.contactId}`;
          const channel = c.Channel || b.channel || "UNKNOWN";
          const subChannel = deriveSubChannel(
            c.InitiationMethod,
            c.CustomerEndpoint?.Type
          );
          const contactTs = c.InitiationTimestamp?.toISOString() || "";

          // 1) Chat-transcript inline attachments — only meaningful for CHAT.
          if (channel === "CHAT") {
            const inlines = await readChatAttachments(c.Recordings || []);
            for (const inline of inlines) {
              try {
                const r = await connect.send(
                  new GetAttachedFileCommand({
                    InstanceId: instanceId,
                    FileId: inline.attachmentId,
                    AssociatedResourceArn: arn,
                    UrlExpiryInSeconds: PRESIGN_EXPIRES,
                  })
                );
                all.push({
                  id: inline.attachmentId,
                  name: inline.name || inline.attachmentId,
                  contentType: inline.contentType,
                  sizeBytes: r.FileSizeInBytes,
                  url: r.DownloadUrl ?? null,
                  sourceContactId: b.contactId,
                  sourceChannel: channel,
                  sourceSubChannel: subChannel,
                  from: inline.from,
                  timestamp: inline.timestamp || contactTs,
                  kind: classifyMedia(inline.contentType, inline.name),
                });
              } catch (err) {
                console.warn(
                  `GetAttachedFile (chat-inline) ${inline.attachmentId} failed:`,
                  err
                );
              }
            }
          }

          // 2) Contact-level ATTACHMENT references — covers EMAIL outbound,
          //    EMAIL inbound, and agent-attached files on any channel.
          try {
            const refs = await connect.send(
              new ListContactReferencesCommand({
                InstanceId: instanceId,
                ContactId: b.contactId,
                ReferenceTypes: ["ATTACHMENT"],
              })
            );
            // De-dupe by fileId so chat inlines (which we already added)
            // don't appear twice if Connect also exposes them as references.
            const already = new Set(
              all
                .filter((a) => a.sourceContactId === b.contactId)
                .map((a) => a.id)
            );
            for (const ref of refs.ReferenceSummaryList || []) {
              const att = ref.Attachment;
              if (!att?.Name || already.has(att.Name)) continue;
              const cleanedName =
                (att.Value || "").split("/").pop() || att.Name;
              try {
                const r = await connect.send(
                  new GetAttachedFileCommand({
                    InstanceId: instanceId,
                    FileId: att.Name,
                    AssociatedResourceArn: arn,
                    UrlExpiryInSeconds: PRESIGN_EXPIRES,
                  })
                );
                all.push({
                  id: att.Name,
                  name: cleanedName,
                  contentType: undefined,
                  sizeBytes: r.FileSizeInBytes,
                  url: r.DownloadUrl ?? null,
                  sourceContactId: b.contactId,
                  sourceChannel: channel,
                  sourceSubChannel: subChannel,
                  // Most agent-uploaded files are sent BY the agent. Inbound
                  // email attachments would also be tagged AGENT here because
                  // Connect doesn't differentiate at the reference level —
                  // accept this caveat for V1.
                  from: "AGENT",
                  timestamp: contactTs,
                  kind: classifyMedia(undefined, cleanedName),
                });
              } catch (err) {
                console.warn(`GetAttachedFile (ref) ${att.Name} failed:`, err);
              }
            }
          } catch (err) {
            console.warn(`ListContactReferences ${b.contactId} failed:`, err);
          }
        } catch (err) {
          console.warn(`brief ${b.contactId} failed:`, err);
        }
      })
    );

    // Newest first — usually what the user wants to see.
    all.sort(
      (a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        phone,
        totalAttachments: all.length,
        attachments: all,
      }),
    };
  } catch (err) {
    console.error("get-customer-attachments error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "Failed to list customer attachments",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
