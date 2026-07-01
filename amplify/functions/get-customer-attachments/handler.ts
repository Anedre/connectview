import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  SearchContactsCommand,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import {
  CustomerProfilesClient,
  SearchProfilesCommand,
  ListProfileObjectsCommand,
} from "@aws-sdk/client-customer-profiles";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { resolveConnect } from "../_shared/tenantConnect";
import { readBlobCache, writeBlobCache } from "../_shared/recordingsCache";
import {
  getAttachmentsStore,
  presignAttachment,
  listContactAttachments,
} from "../_shared/attachmentsS3";

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
// GetAttachedFile topa UrlExpiryInSeconds en 300s; 3600 tiraba
// InvalidRequestException → los adjuntos volvían sin URL. (#grabaciones)
const PRESIGN_EXPIRES = 300;

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

interface ContactBrief {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  recordings?: Array<{ Location?: string; MediaStreamType?: string }>;
}

async function findContacts(phone: string): Promise<ContactBrief[]> {
  // Same dual strategy as get-customer-thread — but we include ALL channels.
  try {
    const sp = await profiles.send(
      new SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone],
      }),
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
            }),
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
        .map(
          (ctr): ContactBrief => ({
            contactId: ctr.contactId,
            channel: String(ctr.channel ?? ctr.Channel ?? "")
              .trim()
              .toUpperCase(),
            initiationTimestamp: ctr.initiationTimestamp
              ? new Date(
                  typeof ctr.initiationTimestamp === "number"
                    ? ctr.initiationTimestamp
                    : Date.parse(ctr.initiationTimestamp),
                ).toISOString()
              : "",
            recordings: Array.isArray(ctr.recordings)
              ? ctr.recordings.map(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (r: any) => ({
                    Location: r.location || r.Location,
                    MediaStreamType: r.mediaStreamType || r.MediaStreamType,
                  }),
                )
              : [],
          }),
        );
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
      }),
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
              }),
            );
            return d.Contact || null;
          } catch {
            return null;
          }
        }),
      )
    )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((x): x is any => !!x);
    return detailed
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c.CustomerEndpoint?.Address === phone || c.CustomerEndpoint?.Value === phone,
      )
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any): ContactBrief => ({
          contactId: (c.Id as string) || "",
          channel: String(c.Channel ?? "")
            .trim()
            .toUpperCase(),
          initiationTimestamp: c.InitiationTimestamp
            ? new Date(c.InitiationTimestamp).toISOString()
            : "",
          recordings: c.Recordings || [],
        }),
      )
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
  recordings: Array<{ Location?: string; MediaStreamType?: string }>,
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
    const obj = await s3.send(new GetObjectCommand({ Bucket: s3loc.bucket, Key: s3loc.key }));
    const text = await obj.Body?.transformToString();
    if (!text) return [];
    const parsed = JSON.parse(text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = parsed.Transcript || parsed.transcript || [];
    const out: ChatTranscriptAttachment[] = [];
    for (const s of list) {
      const sType = (s.Type || s.type || "").toUpperCase();
      const isAttachment =
        sType === "ATTACHMENT" || (Array.isArray(s.Attachments) && s.Attachments.length > 0);
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
  // Warmup (#perf): EventBridge pinguea {warmup:true} cada ~5min — corta el cold start.
  if (event?.warmup || event?.queryStringParameters?.warmup) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: '{"warm":true}',
    };
  }
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

  // CACHÉ (#perf): las URLs presignadas duran 1h y la frescura del caché es 10min,
  // así que las que servimos cacheadas siguen válidas. ?fresh=1 lo saltea.
  const cacheKey = `files#${instanceId}#${phone}`;
  if (event?.queryStringParameters?.fresh !== "1") {
    const cached = await readBlobCache(cacheKey);
    if (cached) return { statusCode: 200, headers: CORS, body: JSON.stringify(cached) };
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

    // Resolución S3-directa (#grabaciones): GetAttachedFile NO sirve para
    // adjuntos de MENSAJE de chat/WhatsApp (otro subsistema). Los archivos viven
    // en el bucket del storage config ATTACHMENTS. Para CHAT leemos el transcript
    // (del CTR.recordings, sin DescribeContact) para tener los nombres ORIGINALES
    // y presignamos cada adjunto; para EMAIL listamos el prefijo S3 del contacto.
    // Ordenado por fecha desc + cap para acotar clientes con cientos de CTRs.
    const store = await getAttachmentsStore(connect, instanceId);
    // Sólo CHAT/EMAIL tienen adjuntos de mensaje (VOICE no) → filtramos a esos
    // canales y procesamos TODOS, sin tope por recencia: un adjunto viejo
    // (de un contacto fuera de las 60 sesiones recientes del hilo) igual debe
    // aparecer en la grilla de Archivos. Tope alto sólo como red de seguridad
    // para clientes con cientos de chats. (#grabaciones)
    const MAX_CONTACTS = 200;
    const ordered = [...briefs]
      .filter((b) => b.channel === "CHAT" || b.channel === "EMAIL")
      .sort(
        (a, b) =>
          (Date.parse(b.initiationTimestamp) || 0) - (Date.parse(a.initiationTimestamp) || 0),
      )
      .slice(0, MAX_CONTACTS);

    if (store) {
      await Promise.all(
        ordered.map(async (b) => {
          try {
            if (b.channel === "CHAT") {
              const inlines = await readChatAttachments(b.recordings || []);
              await Promise.all(
                inlines.map(async (inline) => {
                  const ts = inline.timestamp || b.initiationTimestamp;
                  const res = await presignAttachment(
                    s3,
                    store,
                    "chat",
                    b.contactId,
                    inline.attachmentId,
                    ts,
                    PRESIGN_EXPIRES,
                  );
                  if (!res) return;
                  all.push({
                    id: inline.attachmentId,
                    name: inline.name || inline.attachmentId,
                    contentType: inline.contentType,
                    sizeBytes: res.sizeBytes,
                    url: res.url,
                    sourceContactId: b.contactId,
                    sourceChannel: "CHAT",
                    sourceSubChannel: "Chat/WhatsApp",
                    from: inline.from,
                    timestamp: ts,
                    kind: classifyMedia(inline.contentType, inline.name),
                  });
                }),
              );
            } else if (b.channel === "EMAIL") {
              const listed = await listContactAttachments(
                s3,
                store,
                "email",
                b.contactId,
                b.initiationTimestamp,
                PRESIGN_EXPIRES,
              );
              for (const a of listed) {
                all.push({
                  id: a.attachmentId,
                  name: a.name,
                  contentType: undefined,
                  sizeBytes: a.sizeBytes,
                  url: a.url,
                  sourceContactId: b.contactId,
                  sourceChannel: "EMAIL",
                  sourceSubChannel: "Email",
                  from: "UNKNOWN",
                  timestamp: b.initiationTimestamp,
                  kind: classifyMedia(undefined, a.name),
                });
              }
            }
          } catch (err) {
            console.warn(`brief ${b.contactId} failed:`, err);
          }
        }),
      );
    }

    // Newest first — usually what the user wants to see.
    all.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));

    const payload = { phone, totalAttachments: all.length, attachments: all };
    if (all.length > 0) await writeBlobCache(cacheKey, payload);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(payload) };
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
