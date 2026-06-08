import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  StartTaskContactCommand,
  StartOutboundEmailContactCommand,
  CreateContactCommand,
  StartAttachedFileUploadCommand,
  CompleteAttachedFileUploadCommand,
  BatchGetAttachedFileMetadataCommand,
  StopContactCommand,
  ListUsersCommand,
  type StartTaskContactCommandInput,
  type StartOutboundEmailContactCommandInput,
} from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveConnect } from "../_shared/tenantConnect";

/**
 * start-outbound-contact — single entry-point that the agent desktop
 * uses to create outbound TASK or EMAIL contacts. Voice outbound stays
 * in Streams (`agent.connect(byPhoneNumber)`) because that's the only
 * channel the browser-side SDK supports natively; tasks and emails
 * must go through the Connect data plane, hence this Lambda.
 *
 * Request shape:
 *   { type: "task",  ... StartTaskContact params         }
 *   { type: "email", ... StartOutboundEmailContact params }
 *
 * The Lambda fills in any field that's safe to default (InstanceId,
 * ClientToken) so the UI form stays small.
 */
const legacyConnect = new ConnectClient({ maxAttempts: 2 });
// BYO Data Plane (#46): module-active. El helper audit() escribe a esta tabla,
// que vive en la cuenta del cliente si activó el data plane.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "731736972577";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";
const INSTANCE_ARN = `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}`;

// Module-active: el handler las setea al inicio de cada invocación (Lambda
// procesa un evento a la vez por contenedor → seguro). Los helpers de abajo
// (startTask/startEmail/…) leen estas en vez de las hardcodeadas.
let activeConnect = legacyConnect;
let activeInstanceId = INSTANCE_ID;
let activeInstanceArn = INSTANCE_ARN;

// CORS is handled by the Function URL's own CORS config (duplicated
// headers cause the browser to reject the response).
const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

interface TaskBody {
  type: "task";
  name: string;
  description?: string;
  queueId: string;
  contactFlowId: string;
  references?: Record<string, { Type: "URL" | "STRING"; Value: string }>;
  /** Optional ISO timestamp; if provided, the task is scheduled rather
   *  than queued immediately. */
  scheduledTimeIso?: string;
  actor?: string;
}

interface EmailBody {
  type: "email";
  /** Connect-registered "From" address (e.g.
   *  "admision-udep@novasys.email.connect.aws"). Must match one of
   *  the addresses returned by `SearchEmailAddresses`. */
  fromEmailAddress: string;
  /** Optional display name to show in the recipient's inbox. */
  fromDisplayName?: string;
  /** Destination email — plain text address (e.g. "user@example.com"). */
  toAddress: string;
  subject: string;
  /** Body of the email — plain text from the form. We wrap it in <pre>
   *  for HTML so line breaks survive. */
  body: string;
  contactFlowId: string;
  /** Optional Connect name to show on the contact card. Falls back to
   *  the subject. */
  contactName?: string;
  /** Cognito username of the agent — we look up the Connect user ID
   *  from it (Connect's CreateContact REQUIRES UserInfo for outbound
   *  email contacts). */
  agentUsername: string;
  /** Optional attachments to include with the email. Each entry has
   *  the filename, MIME content-type, and the file body encoded as
   *  base64. The Lambda uploads each one to S3 via
   *  StartAttachedFileUpload + the returned pre-signed PUT URL, then
   *  calls CompleteAttachedFileUpload before StartOutboundEmailContact.
   *  Connect's Send Email block automatically picks them up via the
   *  contact's attached files. */
  attachments?: Array<{
    filename: string;
    contentType: string;
    contentBase64: string;
  }>;
  actor?: string;
}

type RequestBody = TaskBody | EmailBody;

async function audit(
  actor: string,
  action: string,
  target: unknown,
  result: "success" | "error",
  errorMsg?: string
): Promise<void> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: AUDIT_TABLE,
        Item: {
          auditId: { S: randomUUID() },
          timestamp: { S: new Date().toISOString() },
          action: { S: action },
          actor: { S: actor },
          target: { S: JSON.stringify(target) },
          result: { S: result },
          errorMsg: { S: errorMsg || "" },
        },
      })
    );
  } catch (err) {
    console.warn("audit write failed:", err);
  }
}

function respond(
  statusCode: number,
  body: Record<string, unknown>
): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

async function startTask(req: TaskBody) {
  if (!req.name || !req.queueId || !req.contactFlowId) {
    return respond(400, {
      error: "name, queueId, contactFlowId son obligatorios",
    });
  }
  const input: StartTaskContactCommandInput = {
    InstanceId: activeInstanceId,
    Name: req.name.slice(0, 512),
    Description: req.description?.slice(0, 4096),
    ContactFlowId: req.contactFlowId,
    // Scheduled tasks need ScheduledTime; otherwise omit so it routes now.
    ...(req.scheduledTimeIso
      ? { ScheduledTime: new Date(req.scheduledTimeIso) }
      : {}),
    References: req.references,
    ClientToken: randomUUID(),
    // Route via queue: we omit PreviousContactId (no parent contact).
    // The queue is configured on the task flow's "Set working queue"
    // block; alternatively we could explicitly route here via the
    // Quick Connect / Endpoint, but contact flow routing is the
    // canonical pattern.
  };
  try {
    const res = await activeConnect.send(new StartTaskContactCommand(input));
    await audit(req.actor || "unknown", "start-task", req, "success");
    return respond(200, {
      contactId: res.ContactId,
      type: "task",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(req.actor || "unknown", "start-task", req, "error", msg);
    console.error("start-task error", err);
    return respond(500, { error: "No se pudo crear la tarea", message: msg });
  }
}

/**
 * Upload a single base64-encoded attachment to a Connect contact via
 * the StartAttachedFileUpload → presigned PUT → CompleteAttachedFileUpload
 * sequence. Returns the FileId once the upload is finalised so the
 * caller can reference it from the outbound email.
 */
async function uploadAttachmentToContact(
  contactArn: string,
  filename: string,
  contentType: string,
  buffer: Buffer
): Promise<string> {
  const start = await activeConnect.send(
    new StartAttachedFileUploadCommand({
      InstanceId: activeInstanceId,
      FileName: filename,
      FileSizeInBytes: buffer.byteLength,
      FileUseCaseType: "ATTACHMENT",
      AssociatedResourceArn: contactArn,
      ClientToken: randomUUID(),
      UrlExpiryInSeconds: 300,
    })
  );
  const fileId = start.FileId;
  const uploadUrl = start.UploadUrlMetadata?.Url;
  const headers = start.UploadUrlMetadata?.HeadersToInclude || {};
  if (!fileId || !uploadUrl) {
    throw new Error(
      `StartAttachedFileUpload no devolvió FileId/Url para ${filename}`
    );
  }

  // PUT the binary to the presigned S3 URL. The HeadersToInclude
  // returned by Connect must be forwarded verbatim — they're part of
  // the signature.
  const putHeaders: Record<string, string> = {
    "Content-Type": contentType,
    ...headers,
  };
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: putHeaders,
    body: buffer,
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    throw new Error(
      `Upload PUT falló (${putRes.status}) para ${filename}: ${body.slice(0, 200)}`
    );
  }

  await activeConnect.send(
    new CompleteAttachedFileUploadCommand({
      InstanceId: activeInstanceId,
      FileId: fileId,
      AssociatedResourceArn: contactArn,
    })
  );

  // ─── Wait for the file to be APPROVED ────────────────────────
  //
  // Connect runs an antivirus / content scan on every uploaded file.
  // While that scan is running the file's status is PROCESSING and
  // StartOutboundEmailContact refuses to send with the cryptic error
  // "Attachment is not approved". We poll BatchGetAttachedFileMetadata
  // for up to 30 s — small PDFs typically clear in 2-5 s.
  const startTs = Date.now();
  const TIMEOUT_MS = 30_000;
  while (Date.now() - startTs < TIMEOUT_MS) {
    const meta = await activeConnect.send(
      new BatchGetAttachedFileMetadataCommand({
        InstanceId: activeInstanceId,
        FileIds: [fileId],
        AssociatedResourceArn: contactArn,
      })
    );
    const status = meta.Files?.[0]?.FileStatus;
    if (status === "APPROVED") return fileId;
    if (status === "REJECTED" || status === "FAILED") {
      throw new Error(
        `Connect rechazó el adjunto ${filename} (status=${status})`
      );
    }
    // PROCESSING → keep polling
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Timeout esperando aprobación del adjunto ${filename} (>30s)`
  );
}

/**
 * Resolve a Cognito-style username (e.g. "andre-alata") to its Amazon
 * Connect user id. We list-users + filter client-side because
 * SearchUsers requires extra IAM and the list is small enough.
 */
async function resolveAgentUserId(
  username: string
): Promise<string | null> {
  let nextToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await activeConnect.send(
      new ListUsersCommand({
        InstanceId: activeInstanceId,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    const match = (res.UserSummaryList ?? []).find(
      (u) => (u.Username || "").toLowerCase() === username.toLowerCase()
    );
    if (match?.Id) return match.Id;
    if (!res.NextToken) return null;
    nextToken = res.NextToken;
  }
  return null;
}

async function startEmail(req: EmailBody) {
  if (!req.fromEmailAddress || !req.toAddress || !req.subject || !req.body) {
    return respond(400, {
      error: "fromEmailAddress, toAddress, subject, body son obligatorios",
    });
  }
  if (!req.contactFlowId) {
    return respond(400, {
      error: "contactFlowId del flow de email es obligatorio",
    });
  }
  if (!req.agentUsername) {
    return respond(400, {
      error: "agentUsername es obligatorio (Connect requiere UserInfo para outbound email)",
    });
  }

  // Naive HTML wrapping that preserves line breaks but escapes <,>,&.
  const esc = req.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const htmlBody = `<pre style="font-family:inherit;white-space:pre-wrap">${esc}</pre>`;

  try {
    // ─── 1) Resolve the Connect user ID for the agent ──────────────
    const userId = await resolveAgentUserId(req.agentUsername);
    if (!userId) {
      await audit(req.actor || "unknown", "start-email", req, "error",
        `username "${req.agentUsername}" not found in Connect`);
      return respond(400, {
        error: `No se encontró el usuario de Connect "${req.agentUsername}"`,
      });
    }

    // ─── 2) CreateContact (Channel=EMAIL, OUTBOUND) ────────────────
    //
    // Connect's outbound-email flow requires a 2-step API call: first
    // create an EMAIL contact tied to the agent (CreateContact), then
    // attach the actual outbound message via StartOutboundEmailContact
    // using the new ContactId.
    const created = await activeConnect.send(
      new CreateContactCommand({
        InstanceId: activeInstanceId,
        Channel: "EMAIL",
        InitiationMethod: "OUTBOUND",
        UserInfo: { UserId: userId },
        ClientToken: randomUUID(),
        Description: req.contactName || req.subject.slice(0, 200),
        ExpiryDurationInMinutes: 1440,
      })
    );
    const contactId = created.ContactId;
    if (!contactId) {
      throw new Error("CreateContact no devolvió ContactId");
    }
    const contactArn = `${activeInstanceArn}/contact/${contactId}`;

    // ─── 3) Upload attachments (if any) ────────────────────────────
    // The order matters: Connect's Send Email block picks up files
    // attached to the contact at the time of send. So all uploads
    // must complete BEFORE StartOutboundEmailContact.
    const uploadedFileIds: string[] = [];
    for (const att of req.attachments ?? []) {
      try {
        const buffer = Buffer.from(att.contentBase64, "base64");
        const fid = await uploadAttachmentToContact(
          contactArn,
          att.filename,
          att.contentType,
          buffer
        );
        uploadedFileIds.push(fid);
      } catch (err) {
        console.error("attachment upload error", att.filename, err);
        throw new Error(
          `No se pudo adjuntar ${att.filename}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // ─── 4) StartOutboundEmailContact (actually sends the email) ───
    const input: StartOutboundEmailContactCommandInput = {
      InstanceId: activeInstanceId,
      ContactId: contactId,
      FromEmailAddress: {
        EmailAddress: req.fromEmailAddress,
        ...(req.fromDisplayName ? { DisplayName: req.fromDisplayName } : {}),
      },
      DestinationEmailAddress: {
        EmailAddress: req.toAddress,
      },
      EmailMessage: {
        MessageSourceType: "RAW",
        // SDK field is `RawMessage` (not `Raw`). The API error message
        // explicitly says "RawMessage details must be provided for
        // MessageSourceType:RAW" — easy miss given Connect's REST docs
        // shorthand it as "Raw".
        RawMessage: {
          Subject: req.subject.slice(0, 998),
          Body: htmlBody,
          ContentType: "text/html",
        },
      },
      ClientToken: randomUUID(),
    };
    await activeConnect.send(new StartOutboundEmailContactCommand(input));

    // ─── 5) Auto-close the contact so it doesn't stick to the agent ─
    //
    // StartOutboundEmailContact returns once the email is queued for
    // sending (the SES handoff has already happened). Stopping the
    // contact here is the documented pattern for fire-and-forget
    // outbound emails: it disconnects the agent from the contact slot
    // without affecting delivery. If the contact flow already
    // disconnected itself, this StopContact call is a no-op (we
    // swallow the error).
    try {
      await activeConnect.send(
        new StopContactCommand({
          InstanceId: activeInstanceId,
          ContactId: contactId,
          DisconnectReason: { Code: "AGENT" },
        })
      );
    } catch (stopErr) {
      // Most common reason: contact already ended via the flow's own
      // Disconnect block — non-fatal, the email is still on its way.
      console.warn("auto-stop after email queued failed (often safe):", stopErr);
    }

    await audit(
      req.actor || "unknown",
      "start-email",
      { ...req, attachments: req.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: Buffer.from(a.contentBase64, "base64").byteLength,
      })) },
      "success"
    );
    return respond(200, {
      contactId,
      type: "email",
      attachments: uploadedFileIds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(req.actor || "unknown", "start-email", req, "error", msg);
    console.error("start-email error", err);
    return respond(500, { error: "No se pudo enviar el email", message: msg });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // OPTIONS preflight (CORS)
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // Connect del tenant (o legacy de Vox). Setea las vars module-active.
  {
    const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID, INSTANCE_ARN);
    activeConnect = r.client;
    activeInstanceId = r.instanceId;
    activeInstanceArn = r.instanceArn;
    // #46: misma resolución → DDB del tenant para el audit.
    dynamo = r.dynamo || legacyDynamo;
  }

  if (!activeInstanceId) {
    return respond(500, { error: "Amazon Connect no configurado para esta organización" });
  }

  let body: RequestBody;
  try {
    body = JSON.parse(event.body || "{}") as RequestBody;
  } catch {
    return respond(400, { error: "JSON body inválido" });
  }

  if (body.type === "task") return startTask(body);
  if (body.type === "email") return startEmail(body);
  return respond(400, {
    error: "type debe ser 'task' o 'email'",
  });
};
