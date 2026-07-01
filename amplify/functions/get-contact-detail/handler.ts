import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
  ListContactReferencesCommand,
  GetAttachedFileCommand,
  DescribeUserCommand,
  DescribeQueueCommand,
} from "@aws-sdk/client-connect";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveConnect } from "../_shared/tenantConnect";
import { readBlobCache, writeBlobCache } from "../_shared/recordingsCache";

/**
 * get-contact-detail — returns everything needed to render a contact
 * detail view: contact metadata, audio recording presigned URL,
 * transcript (live or historical), attachments with presigned URLs.
 *
 * Endpoint: GET /?contactId={contactId}
 *
 * Returns shape:
 *   {
 *     contactId, channel, initiationTimestamp, disconnectTimestamp,
 *     duration, agentUsername, queueName, initiationMethod,
 *     disconnectReason, customerEndpoint,
 *     recording: { url, expiresAt } | null,
 *     transcript: { segments: [...], source } | null,
 *     attachments: [{ fileId, fileName, fileSizeBytes, url }],
 *     attributes: { [k]: v },
 *   }
 *
 * Notes on transcript sources:
 *   - For VOICE with Contact Lens enabled, the post-call analysis
 *     JSON is dumped to the Contact Lens output S3 prefix and includes
 *     the full transcript. We read it directly via DescribeContact
 *     (Recordings[].Location often points at the audio; the transcript
 *     S3 key is derived from instance settings + contactId).
 *   - For CHAT/EMAIL, the conversation transcript is in S3 if Connect
 *     instance has Chat/Email transcript storage configured. Connect
 *     surfaces these in DescribeContact.WisdomInfo and as
 *     ContactReferences.
 *   - For all channels, ListContactReferences returns ATTACHMENT
 *     references — these are the agent-attached files (e.g. PDFs sent
 *     via outbound email).
 */
// BYO Connect + Data Plane (#43+#46): module-active. S3 también tenant-scoped
// porque las grabaciones viven en el bucket de Connect del cliente.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const legacyS3 = new S3Client({});
let s3: S3Client = legacyS3;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;
/** Connect instance alias used as the S3 prefix segment in
 *  `amazon-connect-{domain}/connect/<alias>/...` paths. */
const INSTANCE_ALIAS = process.env.CONNECT_INSTANCE_ALIAS || "novasys";
const CONTACTS_TABLE = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
const PRESIGN_EXPIRES = 3600; // 1 hour
/** Frescura del caché de detalle: la transcripción de una llamada TERMINADA es
 *  inmutable, así que la servimos hasta 12h (el TTL duro de DynamoDB la borra a
 *  las 24h). La URL firmada del audio NUNCA se cachea — se re-firma en cada
 *  lectura — y el wrap-up se lee siempre fresco. */
const DETAIL_FRESH_MS = 12 * 60 * 60 * 1000;

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// Caches keyeados por `${instanceId}:${id}` para no mezclar tenants.
const userNameCache = new Map<string, string>();
const queueNameCache = new Map<string, string>();

async function resolveAgentUsername(agentId: string): Promise<string> {
  if (!agentId) return "";
  const k = `${instanceId}:${agentId}`;
  if (userNameCache.has(k)) return userNameCache.get(k)!;
  try {
    const r = await connect.send(
      new DescribeUserCommand({
        InstanceId: instanceId,
        UserId: agentId,
      }),
    );
    const name = r.User?.Username || agentId;
    userNameCache.set(k, name);
    return name;
  } catch {
    return agentId;
  }
}

async function resolveQueueName(queueId: string): Promise<string> {
  if (!queueId) return "";
  const k = `${instanceId}:${queueId}`;
  if (queueNameCache.has(k)) return queueNameCache.get(k)!;
  try {
    const r = await connect.send(
      new DescribeQueueCommand({
        InstanceId: instanceId,
        QueueId: queueId,
      }),
    );
    const name = r.Queue?.Name || queueId;
    queueNameCache.set(k, name);
    return name;
  } catch {
    return queueId;
  }
}

/**
 * Connect's Recordings[].Location field is `bucket/key` (NO `s3://`
 * prefix). Some legacy docs showed the `s3://` form. Accept both.
 * Returns null on malformed input.
 */
function parseS3Location(location: string | undefined): { bucket: string; key: string } | null {
  if (!location) return null;
  const withProto = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (withProto) return { bucket: withProto[1], key: withProto[2] };
  const slash = location.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: location.slice(0, slash), key: location.slice(slash + 1) };
}

async function presignS3Location(location: string | undefined): Promise<string | null> {
  const parsed = parseS3Location(location);
  if (!parsed) return null;
  try {
    // Connect saves recordings with Content-Disposition: attachment, which
    // makes browsers download instead of streaming inline — and the HTML5
    // <audio> tag silently stalls instead of erroring. Override to inline
    // so the player can stream the WAV directly.
    const cmd = new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
      ResponseContentDisposition: "inline",
      ResponseContentType: "audio/wav",
    });
    return await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_EXPIRES });
  } catch (err) {
    console.warn("presign failed:", err);
    return null;
  }
}

/**
 * Read a JSON-encoded Contact Lens analysis blob from S3 and project
 * it into a flat segments[] shape that mirrors get-live-transcript's
 * output so the frontend can reuse the same renderer.
 */
async function fetchContactLensTranscript(location: string): Promise<{
  segments: Array<{
    type: "transcript";
    participant: string;
    content: string;
    sentiment?: string;
    beginOffsetMs: number;
    endOffsetMs: number;
  }>;
  overallSentiment?: string;
  source: "contact-lens-s3";
} | null> {
  const s3loc = parseS3Location(location);
  if (!s3loc) return null;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: s3loc.bucket, Key: s3loc.key }));
    const text = await obj.Body?.transformToString();
    if (!text) return null;
    const parsed = JSON.parse(text);
    // Contact Lens analysis JSON has Transcript[] (post-call) or
    // ContentAnalysisSegments — both shapes are normalised below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = parsed.Transcript || parsed.transcript || [];
    const segments = list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any) => ({
        type: "transcript" as const,
        participant: s.ParticipantRole || s.ParticipantId || s.participantRole || "UNKNOWN",
        content: s.Content || s.content || "",
        sentiment: s.Sentiment || s.sentiment,
        beginOffsetMs: s.BeginOffsetMillis || s.beginOffsetMillis || 0,
        endOffsetMs: s.EndOffsetMillis || s.endOffsetMillis || 0,
      }))
      .filter((s: { content: string }) => s.content && s.content.trim());
    return {
      segments,
      overallSentiment: parsed.ConversationCharacteristics?.Sentiment?.Overall?.Sentiment,
      source: "contact-lens-s3",
    };
  } catch (err) {
    console.warn("fetchContactLensTranscript failed:", err);
    return null;
  }
}

/**
 * Read a chat transcript JSON file from S3 (Connect dumps these when
 * chat-transcript storage is enabled). Returns segments shaped like
 * a normalised message list.
 */
/**
 * Chat-transcript shape after we project it for the frontend. Each segment
 * is either a regular message (`message`), an attachment posted in-chat
 * by either party (`attachment` — `attachmentRef` is the AttachmentId
 * that resolves to a presigned URL via `fetchAttachments`), or a system
 * event (`event` — joined, left, ended).
 */
interface ChatSegment {
  type: "message" | "attachment" | "event";
  participant: string;
  /** Visible message body. For ATTACHMENT and EVENT segments this is
   *  often empty; the frontend renders the attachment or a localized
   *  event label instead. */
  content: string;
  /** Original message ContentType (e.g. `text/plain`, `application/json`
   *  for interactive replies, `image/jpeg` for old chat-message-attached
   *  images). Kept verbatim so the frontend can render quick replies. */
  contentType?: string;
  /** For type === "attachment": resolves into the `attachments` array
   *  with a presigned URL. */
  attachmentRef?: {
    attachmentId: string;
    name?: string;
    contentType?: string;
  };
  /** For type === "event": Connect's event kind ("joined", "left",
   *  "chat.ended", "transferred", "typing", "read", etc.). */
  eventKind?: string;
  /** Original message id from Connect, useful for delivered/read receipts. */
  id?: string;
  timestamp: string;
  beginOffsetMs: number;
  endOffsetMs: number;
}

async function fetchChatTranscript(location: string): Promise<{
  segments: ChatSegment[];
  source: "chat-s3";
} | null> {
  const s3loc = parseS3Location(location);
  if (!s3loc) return null;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: s3loc.bucket, Key: s3loc.key }));
    const text = await obj.Body?.transformToString();
    if (!text) return null;
    const parsed = JSON.parse(text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = parsed.Transcript || parsed.transcript || [];
    const startMs =
      list.length > 0 ? Date.parse(list[0].AbsoluteTime || list[0].absoluteTime || 0) : 0;

    const segments: ChatSegment[] = list.map((s) => {
      const ts = Date.parse(s.AbsoluteTime || s.absoluteTime || "") || 0;
      const participant = s.ParticipantRole || s.participantRole || "UNKNOWN";
      const content = s.Content || s.content || "";
      const contentType = s.ContentType || s.contentType || undefined;
      const offset = ts && startMs ? ts - startMs : 0;
      const baseTimestamp = s.AbsoluteTime || s.absoluteTime || "";
      const id = s.Id || s.id;

      // Type can be: MESSAGE, ATTACHMENT, EVENT, MESSAGE_METADATA, ...
      // (https://docs.aws.amazon.com/connect-participant/latest/APIReference/API_Item.html)
      const sType = (s.Type || s.type || "MESSAGE").toUpperCase();

      // ATTACHMENT: the customer or agent sent a file in-chat. Connect
      // exposes the metadata under `Attachments[]` and the file body
      // is fetched via GetAttachedFile (which we already crosslink in
      // the top-level `attachments` array).
      if (sType === "ATTACHMENT" || (Array.isArray(s.Attachments) && s.Attachments.length > 0)) {
        const att = (s.Attachments || [])[0] || {};
        return {
          type: "attachment",
          participant,
          content,
          contentType,
          id,
          attachmentRef: {
            attachmentId: att.AttachmentId || att.attachmentId || "",
            name: att.AttachmentName || att.attachmentName,
            contentType: att.ContentType || att.contentType,
          },
          timestamp: baseTimestamp,
          beginOffsetMs: offset,
          endOffsetMs: offset,
        };
      }

      // EVENT: participant.joined / participant.left / chat.ended /
      // typing / read etc. We strip the AWS prefix to keep the
      // event kind short.
      if (sType === "EVENT") {
        const rawCt = contentType || "";
        const kind = rawCt.replace(/^application\/vnd\.amazonaws\.connect\.event\./, ""); // → "participant.joined", "chat.ended", "typing", ...
        return {
          type: "event",
          participant,
          content,
          contentType,
          eventKind: kind || "unknown",
          id,
          timestamp: baseTimestamp,
          beginOffsetMs: offset,
          endOffsetMs: offset,
        };
      }

      // MESSAGE (default). Interactive replies (quick-reply, list,
      // template) come with ContentType=application/json and Content
      // as a JSON string — the frontend can introspect it as needed.
      return {
        type: "message",
        participant,
        content,
        contentType,
        id,
        timestamp: baseTimestamp,
        beginOffsetMs: offset,
        endOffsetMs: offset,
      };
    });

    return { segments, source: "chat-s3" };
  } catch (err) {
    console.warn("fetchChatTranscript failed:", err);
    return null;
  }
}

interface AttachmentOut {
  fileId: string;
  fileName?: string;
  fileSizeBytes?: number;
  fileStatus?: string;
  url?: string | null;
  createdTime?: string;
}

/**
 * Fetch the email body from Connect's EMAIL_MESSAGE references.
 * Connect stores inbound + outbound emails as Attached Files; the
 * actual body sits in S3 as a small JSON `{contentType, messageContent}`.
 * We GetAttachedFile to obtain a presigned URL, fetch the JSON, and
 * project it into a single transcript segment so the EmailThreadPanel
 * can render it as the message body.
 *
 * Returns null when no email body is attached (the contact really
 * had no body — rare but possible for header-only auto-replies).
 */
async function fetchEmailBody(
  contactId: string,
  associatedResourceArn: string,
): Promise<{
  body: string;
  contentType: string;
  fromAddress: string;
} | null> {
  try {
    const refs = await connect.send(
      new ListContactReferencesCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        ReferenceTypes: ["EMAIL_MESSAGE"],
      }),
    );
    const summary = (refs.ReferenceSummaryList || [])[0];
    const fileId = summary?.EmailMessage?.Name;
    if (!fileId) return null;
    // GetAttachedFile for EMAIL_MESSAGE files only accepts the default
    // 300-second expiry — passing 3600 returns InvalidRequestException
    // even though the docs imply it's configurable. Omit the field and
    // let the API default kick in.
    const att = await connect.send(
      new GetAttachedFileCommand({
        InstanceId: instanceId,
        FileId: fileId,
        AssociatedResourceArn: associatedResourceArn,
      }),
    );
    const url = att.DownloadUrlMetadata?.Url || (att as { DownloadUrl?: string }).DownloadUrl;
    if (!url) return null;
    // Fetch the small JSON file from S3 via the presigned URL.
    const r = await fetch(url);
    if (!r.ok) {
      console.warn("email body fetch HTTP", r.status);
      return null;
    }
    const json = (await r.json()) as {
      contentType?: string;
      messageContent?: string;
      from?: string;
    };
    if (!json.messageContent) return null;
    return {
      body: json.messageContent
        // Connect serialises body with literal `\n` (escaped) — convert
        // back to real newlines so the agent sees paragraphs.
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, ""),
      contentType: json.contentType || "text/plain",
      fromAddress: json.from || "",
    };
  } catch (err) {
    console.warn("fetchEmailBody failed:", err);
    return null;
  }
}

async function fetchAttachments(
  contactId: string,
  associatedResourceArn: string,
): Promise<AttachmentOut[]> {
  const out: AttachmentOut[] = [];
  try {
    const refs = await connect.send(
      new ListContactReferencesCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        ReferenceTypes: ["ATTACHMENT"],
      }),
    );
    for (const r of refs.ReferenceSummaryList || []) {
      const att = r.Attachment;
      if (!att?.Name || !att?.Value) continue;
      // Connect's Attachment reference shape:
      //   { Name: "<FileId UUID>", Value: "<bucket>/<s3 key>", Status: "APPROVED" }
      // The FileId for GetAttachedFile is `att.Name` (NOT a slice of the path —
      // that was an older mistake that always produced ValidationException).
      const fileId = att.Name;
      // Derive a readable file name + size by inspecting the S3 key tail and,
      // in parallel, trying to presign the file via GetAttachedFile.
      const s3Key = att.Value || "";
      const baseName = s3Key.split("/").pop() || fileId;
      // The S3 key follows: <contactId>_<fileId>_<YYYYMMDDTHH:MM_UTC>.<ext>
      // Strip the leading contactId_ and fileId_ to show a friendly name.
      const cleanedName = baseName.replace(`${contactId}_`, "").replace(`${fileId}_`, "");
      let downloadUrl: string | null = null;
      let fileSize: number | undefined;
      try {
        const getRes = await connect.send(
          new GetAttachedFileCommand({
            InstanceId: instanceId,
            FileId: fileId,
            AssociatedResourceArn: associatedResourceArn,
            UrlExpiryInSeconds: PRESIGN_EXPIRES,
          }),
        );
        downloadUrl = getRes.DownloadUrl ?? null;
        fileSize = getRes.FileSizeInBytes;
      } catch (err) {
        // GetAttachedFile rejects files outside the attached-file pipeline
        // (e.g. some legacy chat attachments stored straight to S3). Fall
        // back to a direct S3 presign so the agent still gets a working
        // download link instead of a dead attachment chip.
        console.warn(
          "GetAttachedFile failed for",
          fileId,
          "— falling back to direct S3 presign",
          err,
        );
        downloadUrl = await presignS3Location(s3Key);
      }
      out.push({
        fileId,
        fileName: cleanedName,
        fileSizeBytes: fileSize,
        fileStatus: att.Status,
        url: downloadUrl,
      });
    }
  } catch (err) {
    console.warn("ListContactReferences failed:", err);
  }
  return out;
}

/** Parte INMUTABLE del detalle que cacheamos (transcripción + metadata +
 *  ubicación del audio). NO incluye URLs firmadas (expiran) ni el wrap-up
 *  (puede cambiar) — esos se regeneran/releen frescos en cada lectura. */
interface DetailCore {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  connectedToSystemTimestamp: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  customerEndpoint?: string;
  customerEndpointType?: string;
  attributes: Record<string, string>;
  subject?: string;
  systemEndpoint?: string;
  systemEndpointType?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transcript: any;
  /** Ubicación S3 cruda del audio ("bucket/key") — se re-firma en cada lectura. */
  audioLocation: string | null;
  /** Si la llamada tenía adjuntos: solo entonces re-consultamos Connect en un hit. */
  hadAttachments: boolean;
}

/** Construye el objeto `recording` re-firmando la ubicación del audio. La URL
 *  firmada caduca, por eso jamás se cachea — siempre fresca. */
async function buildRecording(
  audioLocation: string | null,
): Promise<{ url: string; expiresAt: string } | null> {
  if (!audioLocation) return null;
  const url = await presignS3Location(audioLocation);
  return url
    ? { url, expiresAt: new Date(Date.now() + PRESIGN_EXPIRES * 1000).toISOString() }
    : null;
}

/** Lee el wrap-up (disposición, notas, tags, follow-ups + historial append-only)
 *  desde DynamoDB. Siempre fresco — nunca se cachea — porque el agente puede
 *  editarlo después de la llamada. */
async function fetchWrapUp(contactId: string): Promise<Record<string, unknown> | null> {
  let wrapUp: Record<string, unknown> | null = null;
  try {
    const ddbRes = await dynamo.send(
      new GetItemCommand({
        TableName: CONTACTS_TABLE,
        Key: { contactId: { S: contactId } },
      }),
    );
    if (ddbRes.Item) {
      const u = unmarshall(ddbRes.Item);
      // Only return the wrap-up object if the agent actually filled it.
      const hasContent =
        u.agentNotes ||
        u.stage ||
        u.subStage ||
        u.summary ||
        (Array.isArray(u.tags) && u.tags.length > 0);
      if (hasContent) {
        wrapUp = {
          notes: u.agentNotes || "",
          summary: u.summary || "",
          stage: u.stage || "",
          stageLabel: u.stageLabel || "",
          subStage: u.subStage || "",
          subStageLabel: u.subStageLabel || "",
          valoracion: u.valoracion || "",
          tags: Array.isArray(u.tags) ? u.tags : [],
          followUps: u.followUps || {},
          followUpTaskIds: Array.isArray(u.followUpTaskIds) ? u.followUpTaskIds : [],
          agentUsername: u.agentUsername || "",
          updatedAt: u.updatedAt || "",
          history: [],
        };
      }
    }
  } catch (err) {
    console.warn("wrap-up lookup failed:", err);
  }

  // Append-only wrap-up history (siempre, aunque el row actual esté vacío).
  try {
    const histRes = await dynamo.send(
      new QueryCommand({
        TableName: "connectview-wrapup-history",
        KeyConditionExpression: "contactId = :cid",
        ExpressionAttributeValues: { ":cid": { S: contactId } },
        ScanIndexForward: false, // newest first
        Limit: 50,
      }),
    );
    const rows = (histRes.Items || []).map((r) => unmarshall(r));
    if (rows.length > 0) {
      if (!wrapUp) {
        const latest = rows[0];
        wrapUp = {
          notes: latest.agentNotes || "",
          summary: latest.summary || "",
          stage: latest.stage || "",
          stageLabel: latest.stageLabel || "",
          subStage: latest.subStage || "",
          subStageLabel: latest.subStageLabel || "",
          valoracion: latest.valoracion || "",
          tags: Array.isArray(latest.tags) ? latest.tags : [],
          followUps: latest.followUps || {},
          followUpTaskIds: Array.isArray(latest.followUpTaskIds) ? latest.followUpTaskIds : [],
          agentUsername: latest.agentUsername || "",
          updatedAt: latest.savedAt || "",
          history: [],
        };
      }
      wrapUp.history = rows;
    }
  } catch (err) {
    console.warn("wrap-up history lookup failed:", err);
  }

  return wrapUp;
}

/** Arma el body de respuesta — usado por el camino de caché Y el de cómputo
 *  completo, para que la forma del JSON nunca diverja entre ambos. */
function detailBody(
  core: DetailCore,
  recording: { url: string; expiresAt: string } | null,
  attachments: AttachmentOut[],
  wrapUp: Record<string, unknown> | null,
) {
  return {
    contactId: core.contactId,
    channel: core.channel,
    subChannel: undefined,
    initiationTimestamp: core.initiationTimestamp,
    disconnectTimestamp: core.disconnectTimestamp,
    connectedToSystemTimestamp: core.connectedToSystemTimestamp,
    duration: core.duration,
    agentUsername: core.agentUsername,
    queueName: core.queueName,
    initiationMethod: core.initiationMethod,
    disconnectReason: core.disconnectReason,
    customerEndpoint: core.customerEndpoint,
    customerEndpointType: core.customerEndpointType,
    attributes: core.attributes || {},
    subject: core.subject,
    systemEndpoint: core.systemEndpoint,
    systemEndpointType: core.systemEndpointType,
    recording,
    transcript: core.transcript,
    attachments,
    wrapUp,
  };
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
  // BYO Connect + Data Plane: setea connect/instanceId/dynamo/s3.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    connect = r.client;
    instanceId = r.instanceId;
    dynamo = r.dynamo || legacyDynamo;
    s3 = r.s3 || legacyS3;
  }
  const contactId = event?.queryStringParameters?.contactId;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "contactId required" }),
    };
  }

  const cacheKey = `detail#${instanceId}#${contactId}`;
  const wantsFresh = event?.queryStringParameters?.fresh === "1";
  const associatedResourceArn = `arn:aws:connect:${process.env.AWS_REGION || "us-east-1"}:${process.env.AWS_ACCOUNT_ID || ""}:instance/${instanceId}/contact/${contactId}`;

  // Cache hit (#perf Nivel 3): la transcripción de una llamada TERMINADA es
  // INMUTABLE → la servimos del caché y solo re-firmamos el audio (la URL
  // firmada expira, nunca se cachea), re-consultamos los adjuntos SOLO si los
  // hubo, y leemos el wrap-up fresco (el agente puede editarlo). Así salta lo
  // caro: DescribeContact + leer Contact Lens de S3 + el barrido ListObjectsV2.
  if (!wantsFresh) {
    const core = (await readBlobCache(cacheKey, DETAIL_FRESH_MS)) as DetailCore | null;
    if (core) {
      const [recording, attachments, wrapUp] = await Promise.all([
        buildRecording(core.audioLocation),
        core.hadAttachments
          ? fetchAttachments(contactId, associatedResourceArn)
          : Promise.resolve([] as AttachmentOut[]),
        fetchWrapUp(contactId),
      ]);
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify(detailBody(core, recording, attachments, wrapUp)),
      };
    }
  }

  try {
    const desc = await connect.send(
      new DescribeContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
      }),
    );
    const c = desc.Contact;
    if (!c) {
      return {
        statusCode: 404,
        headers: CORS,
        body: JSON.stringify({ error: "Contact not found" }),
      };
    }

    const channel = c.Channel || "UNKNOWN";
    const agentId = c.AgentInfo?.Id || "";
    const queueId = c.QueueInfo?.Id || "";
    const [agentUsername, queueName] = await Promise.all([
      agentId ? resolveAgentUsername(agentId) : Promise.resolve(""),
      queueId ? resolveQueueName(queueId) : Promise.resolve(""),
    ]);

    // Process recordings: classify by media type.
    // Connect's Recordings array is heterogeneous — entries can be the
    // audio recording, the Contact Lens transcript JSON, or the chat
    // transcript JSON. We handle each.
    let audioLocation: string | null = null;
    let transcript:
      | Awaited<ReturnType<typeof fetchContactLensTranscript>>
      | Awaited<ReturnType<typeof fetchChatTranscript>>
      | null = null;
    /** Remember the bucket we saw the audio in, so the fallback transcript
     *  lookups below know where to ListObjectsV2 instead of guessing. */
    let connectBucket: string | null = null;
    for (const r of c.Recordings || []) {
      if (!r.Location) continue;
      // MediaStreamType: AUDIO | VIDEO | CHAT. Audio = call recording,
      // CHAT = chat/WhatsApp transcript JSON (this stream type was
      // added by Connect when chat-transcript storage was enabled).
      const streamType = r.MediaStreamType;
      const isAudio = streamType === "AUDIO";
      const isChat = streamType === "CHAT";
      const lowerLoc = r.Location.toLowerCase();
      // Match the real Connect path conventions:
      //   .../ContactLens/.../analysis.json          → contact-lens JSON
      //   .../ChatTranscripts/.../<id>.json          → chat transcript
      // The previous regex looked for "chat-transcripts" (with dash) which
      // never matches the real CamelCase path. Now we accept all three forms.
      const looksLikeAnalysis =
        lowerLoc.includes("contactlens") ||
        lowerLoc.includes("contact-lens") ||
        lowerLoc.includes("analysis");
      const looksLikeChat =
        lowerLoc.includes("chattranscripts") ||
        lowerLoc.includes("chat-transcripts") ||
        lowerLoc.includes("chat_transcripts");

      if (isAudio) {
        audioLocation = r.Location;
        // Capture bucket for later fallback lookups.
        const parsed = parseS3Location(r.Location);
        if (parsed) connectBucket = parsed.bucket;
      } else if (isChat || (looksLikeChat && !transcript)) {
        transcript = await fetchChatTranscript(r.Location);
      } else if (looksLikeAnalysis && !transcript) {
        transcript = await fetchContactLensTranscript(r.Location);
      }
    }

    // Fallback transcript lookup. DescribeContact.Recordings often
    // returns ONLY the audio entry — Contact Lens writes its analysis
    // JSON to a separate prefix that Connect doesn't surface back. So
    // when we have no transcript yet, we ListObjectsV2 the conventional
    // prefixes for this contact.
    //
    //   VOICE  → s3://<bucket>/Analysis/Voice/YYYY/MM/DD/<contactId>_analysis_*.json
    //   CHAT   → s3://<bucket>/connect/<instanceAlias>/ChatTranscripts/YYYY/MM/DD/<contactId>_*.json
    if (!transcript && connectBucket) {
      const initTs = c.InitiationTimestamp;
      if (initTs) {
        const dt = typeof initTs === "string" ? new Date(initTs) : (initTs as Date);
        const yyyy = String(dt.getUTCFullYear());
        const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(dt.getUTCDate()).padStart(2, "0");

        const tryPrefixes: Array<{
          prefix: string;
          kind: "contact-lens" | "chat";
        }> = [];

        if (channel === "VOICE" || channel === "TELEPHONY") {
          // Contact Lens analysis
          tryPrefixes.push({
            prefix: `Analysis/Voice/${yyyy}/${mm}/${dd}/${contactId}_`,
            kind: "contact-lens",
          });
          tryPrefixes.push({
            prefix: `connect/${INSTANCE_ALIAS}/Analysis/Voice/${yyyy}/${mm}/${dd}/${contactId}_`,
            kind: "contact-lens",
          });
        } else if (channel === "CHAT") {
          tryPrefixes.push({
            prefix: `connect/${INSTANCE_ALIAS}/ChatTranscripts/${yyyy}/${mm}/${dd}/${contactId}_`,
            kind: "chat",
          });
          tryPrefixes.push({
            prefix: `ChatTranscripts/${yyyy}/${mm}/${dd}/${contactId}_`,
            kind: "chat",
          });
        }

        for (const { prefix, kind } of tryPrefixes) {
          try {
            const res = await s3.send(
              new ListObjectsV2Command({
                Bucket: connectBucket,
                Prefix: prefix,
                MaxKeys: 5,
              }),
            );
            const obj = (res.Contents || [])[0];
            if (!obj?.Key) continue;
            const fullLoc = `${connectBucket}/${obj.Key}`;
            console.log(`[transcript-fallback] found ${kind} at s3://${fullLoc}`);
            transcript =
              kind === "chat"
                ? await fetchChatTranscript(fullLoc)
                : await fetchContactLensTranscript(fullLoc);
            if (transcript) break;
          } catch (err) {
            console.warn(`[transcript-fallback] ListObjectsV2 prefix=${prefix} failed:`, err);
          }
        }
      }
    }

    // Fetch attachments — exists for any channel that supports them
    // (most commonly EMAIL). `associatedResourceArn` ya se computó arriba.
    const attachments = await fetchAttachments(contactId, associatedResourceArn);

    // For EMAIL channel, fetch the message body from the EMAIL_MESSAGE
    // attached file and project it as a transcript segment so the front
    // EmailThreadPanel can render the body in its standard scroll area.
    // Connect doesn't put email body in Attributes — it lives in S3 as
    // a small JSON via Attached Files.
    if (channel === "EMAIL") {
      const emailMsg = await fetchEmailBody(contactId, associatedResourceArn);
      if (emailMsg && (!transcript || (transcript.segments?.length ?? 0) === 0)) {
        transcript = {
          source: "email-s3",
          segments: [
            {
              type: "message",
              participant: "CUSTOMER",
              content: emailMsg.body,
              contentType: emailMsg.contentType,
              timestamp: c.InitiationTimestamp?.toISOString() || "",
              beginOffsetMs: 0,
              endOffsetMs: 0,
            } as ChatSegment,
          ],
        };
      }
    }

    // Wrap-up (disposición, notas, tags, follow-ups + historial). Se lee SIEMPRE
    // fresco — nunca se cachea — porque el agente puede editarlo tras la llamada.
    const wrapUp = await fetchWrapUp(contactId);

    const duration =
      c.DisconnectTimestamp && c.InitiationTimestamp
        ? Math.round((c.DisconnectTimestamp.getTime() - c.InitiationTimestamp.getTime()) / 1000)
        : 0;

    const core: DetailCore = {
      contactId,
      channel,
      initiationTimestamp: c.InitiationTimestamp?.toISOString() || "",
      disconnectTimestamp: c.DisconnectTimestamp?.toISOString() || "",
      connectedToSystemTimestamp: c.ConnectedToSystemTimestamp?.toISOString() || "",
      duration,
      agentUsername,
      queueName,
      initiationMethod: c.InitiationMethod,
      disconnectReason: c.DisconnectReason,
      customerEndpoint: c.CustomerEndpoint?.Address,
      customerEndpointType: c.CustomerEndpoint?.Type,
      attributes: c.Attributes || {},
      // For EMAIL: Contact.Name holds the message Subject (set by Connect's
      // inbound email pipeline from the SMTP `Subject:` header). Unused else.
      subject: c.Name || undefined,
      systemEndpoint: c.SystemEndpoint?.Address,
      systemEndpointType: c.SystemEndpoint?.Type,
      transcript,
      audioLocation,
      hadAttachments: attachments.length > 0,
    };

    // Poblá el caché (gzip) SOLO para llamadas TERMINADAS con transcripción real,
    // para no cachear una conversación en curso/incompleta. Best-effort: si
    // DynamoDB falla, no rompe la respuesta.
    if (c.DisconnectTimestamp && (transcript?.segments?.length ?? 0) > 0) {
      await writeBlobCache(cacheKey, core);
    }

    const recording = await buildRecording(audioLocation);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(detailBody(core, recording, attachments, wrapUp)),
    };
  } catch (err) {
    console.error("get-contact-detail error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "Failed to get contact detail",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
