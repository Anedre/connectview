import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
  ListContactReferencesCommand,
  GetAttachedFileCommand,
  DescribeUserCommand,
  DescribeQueueCommand,
} from "@aws-sdk/client-connect";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
const connect = new ConnectClient({ maxAttempts: 1 });
const s3 = new S3Client({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const PRESIGN_EXPIRES = 3600; // 1 hour

const CORS: Record<string, string> = { "Content-Type": "application/json" };

const userNameCache = new Map<string, string>();
const queueNameCache = new Map<string, string>();

async function resolveAgentUsername(agentId: string): Promise<string> {
  if (!agentId) return "";
  if (userNameCache.has(agentId)) return userNameCache.get(agentId)!;
  try {
    const r = await connect.send(
      new DescribeUserCommand({
        InstanceId: INSTANCE_ID,
        UserId: agentId,
      })
    );
    const name = r.User?.Username || agentId;
    userNameCache.set(agentId, name);
    return name;
  } catch {
    return agentId;
  }
}

async function resolveQueueName(queueId: string): Promise<string> {
  if (!queueId) return "";
  if (queueNameCache.has(queueId)) return queueNameCache.get(queueId)!;
  try {
    const r = await connect.send(
      new DescribeQueueCommand({
        InstanceId: INSTANCE_ID,
        QueueId: queueId,
      })
    );
    const name = r.Queue?.Name || queueId;
    queueNameCache.set(queueId, name);
    return name;
  } catch {
    return queueId;
  }
}

async function presignS3Location(location: string | undefined): Promise<string | null> {
  if (!location) return null;
  // location is "s3://bucket/key"
  const m = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  try {
    const cmd = new GetObjectCommand({ Bucket: m[1], Key: m[2] });
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
  const m = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: m[1], Key: m[2] })
    );
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
        participant:
          s.ParticipantRole ||
          s.ParticipantId ||
          s.participantRole ||
          "UNKNOWN",
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
async function fetchChatTranscript(location: string): Promise<{
  segments: Array<{
    type: "transcript";
    participant: string;
    content: string;
    timestamp: string;
    beginOffsetMs: number;
    endOffsetMs: number;
  }>;
  source: "chat-s3";
} | null> {
  const m = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: m[1], Key: m[2] })
    );
    const text = await obj.Body?.transformToString();
    if (!text) return null;
    const parsed = JSON.parse(text);
    // Connect chat transcripts: { Transcript: [{ ParticipantRole, Content, AbsoluteTime }] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = parsed.Transcript || parsed.transcript || [];
    const startMs = list.length > 0 ? Date.parse(list[0].AbsoluteTime || list[0].absoluteTime || 0) : 0;
    const segments = list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any) => {
        const ts = Date.parse(s.AbsoluteTime || s.absoluteTime || "") || 0;
        return {
          type: "transcript" as const,
          participant: s.ParticipantRole || s.participantRole || "UNKNOWN",
          content: s.Content || s.content || "",
          timestamp: s.AbsoluteTime || s.absoluteTime || "",
          beginOffsetMs: ts && startMs ? ts - startMs : 0,
          endOffsetMs: ts && startMs ? ts - startMs : 0,
        };
      })
      .filter((s: { content: string }) => s.content && s.content.trim());
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

async function fetchAttachments(
  contactId: string,
  associatedResourceArn: string
): Promise<AttachmentOut[]> {
  const out: AttachmentOut[] = [];
  try {
    const refs = await connect.send(
      new ListContactReferencesCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
        ReferenceTypes: ["ATTACHMENT"],
      })
    );
    for (const r of refs.ReferenceSummaryList || []) {
      const att = r.Attachment;
      if (!att?.Name || !att?.Value) continue;
      // `Value` is the attached-file ARN; we can presign it via
      // GetAttachedFile which returns a download URL.
      const fileId = att.Value.split("/").pop() || att.Value;
      let downloadUrl: string | null = null;
      try {
        const getRes = await connect.send(
          new GetAttachedFileCommand({
            InstanceId: INSTANCE_ID,
            FileId: fileId,
            AssociatedResourceArn: associatedResourceArn,
            UrlExpiryInSeconds: PRESIGN_EXPIRES,
          })
        );
        downloadUrl = getRes.DownloadUrl ?? null;
      } catch (err) {
        console.warn("GetAttachedFile failed for", fileId, err);
      }
      out.push({
        fileId,
        fileName: att.Name,
        fileStatus: att.Status,
        url: downloadUrl,
      });
    }
  } catch (err) {
    console.warn("ListContactReferences failed:", err);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  const contactId = event?.queryStringParameters?.contactId;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "contactId required" }),
    };
  }

  try {
    const desc = await connect.send(
      new DescribeContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
      })
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
    let recordingUrl: string | null = null;
    let transcript: Awaited<ReturnType<typeof fetchContactLensTranscript>> | Awaited<ReturnType<typeof fetchChatTranscript>> | null = null;
    for (const r of c.Recordings || []) {
      if (!r.Location) continue;
      // MediaStreamType: AUDIO | VIDEO. Audio = recording. The
      // transcript & chat-transcript entries don't have a streamtype.
      const isAudio = r.MediaStreamType === "AUDIO";
      const lowerLoc = r.Location.toLowerCase();
      const looksLikeAnalysis =
        lowerLoc.includes("analysis") || lowerLoc.endsWith(".json");
      const looksLikeChat = lowerLoc.includes("chat-transcripts") || lowerLoc.includes("chat_transcripts");

      if (isAudio) {
        recordingUrl = await presignS3Location(r.Location);
      } else if (looksLikeAnalysis && !transcript) {
        transcript = await fetchContactLensTranscript(r.Location);
      } else if (looksLikeChat && !transcript) {
        transcript = await fetchChatTranscript(r.Location);
      }
    }

    // Fetch attachments — exists for any channel that supports them
    // (most commonly EMAIL).
    const associatedResourceArn = `arn:aws:connect:${process.env.AWS_REGION || "us-east-1"}:${process.env.AWS_ACCOUNT_ID || ""}:instance/${INSTANCE_ID}/contact/${contactId}`;
    const attachments = await fetchAttachments(contactId, associatedResourceArn);

    const duration =
      c.DisconnectTimestamp && c.InitiationTimestamp
        ? Math.round(
            (c.DisconnectTimestamp.getTime() -
              c.InitiationTimestamp.getTime()) /
              1000
          )
        : 0;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        contactId,
        channel,
        subChannel: undefined,
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
        recording: recordingUrl
          ? {
              url: recordingUrl,
              expiresAt: new Date(Date.now() + PRESIGN_EXPIRES * 1000).toISOString(),
            }
          : null,
        transcript,
        attachments,
      }),
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
