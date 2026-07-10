/**
 * _shared/email.ts — capa de envío de correo MULTI-PROVEEDOR por tenant.
 *
 * Resuelve el proveedor configurado del tenant (connectview-connections → `email`)
 * y despacha el envío a:
 *   • novasys   — SES compartido de Novasys (fallback para pilotos)
 *   • ses       — Amazon SES (del propio tenant vía assume-role, o el de Novasys)
 *   • smtp      — cualquier servidor SMTP (Gmail app-password, Outlook, Zoho, custom) vía nodemailer
 *   • gmail     — Gmail API (OAuth: refresh token → access token)
 *   • microsoft — Microsoft Graph sendMail (OAuth)
 *   • sendgrid / resend / mailgun — API HTTP (una API key)
 *
 * Las CREDENCIALES viven en Secrets Manager (`connectview/email/{tenantId}`),
 * nunca en la config de conexiones ni en el navegador. Molde: `metaAccounts.ts`.
 *
 * El MIME se arma con el MailComposer de nodemailer (mismo builder para SES-raw,
 * Gmail-raw y SMTP) → adjuntos y threading (In-Reply-To/References) uniformes.
 *
 * 🔑 Bundlea `nodemailer` → deploy con EXTERNAL_OVERRIDE (como el SDK de Cost
 *    Explorer en get-cost-report).
 */
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

import MailComposer from "nodemailer/lib/mail-composer";
import nodemailer from "nodemailer";

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const NOVASYS_FROM = process.env.NOVASYS_FROM_EMAIL || "aria@novasys.com.pe";
const NOVASYS_REGION = process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";

const ddb = new DynamoDBClient({});
const sm = new SecretsManagerClient({});
const sts = new STSClient({});

/* ───────────────────────── Tipos de configuración ───────────────────────── */

export type EmailProvider =
  | { kind: "novasys" }
  | { kind: "ses"; fromEmail: string; fromName?: string; region?: string; useTenantRole?: boolean }
  | {
      kind: "smtp";
      host: string;
      port: number;
      secure?: boolean;
      user: string;
      fromEmail: string;
      fromName?: string;
    }
  | { kind: "gmail"; fromEmail: string; fromName?: string }
  | { kind: "microsoft"; fromEmail: string; fromName?: string; sender?: string }
  | {
      kind: "sendgrid" | "resend" | "mailgun";
      fromEmail: string;
      fromName?: string;
      region?: string;
      domain?: string;
    };

export interface EmailConfig {
  provider?: EmailProvider;
}

/** Secreto por tenant en Secrets Manager. Solo lo sensible. */
export interface EmailSecret {
  smtpPass?: string;
  gmailClientId?: string;
  gmailClientSecret?: string;
  gmailRefreshToken?: string;
  msClientId?: string;
  msClientSecret?: string;
  msTenant?: string;
  msRefreshToken?: string;
  sendgridKey?: string;
  resendKey?: string;
  mailgunKey?: string;
}

export interface OutboundEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; contentBase64: string; contentType?: string }[];
}

export type SendResult = { ok: boolean; messageId?: string; error?: string; provider: string };

/* ───────────────────────── Lectura de config + secreto ───────────────────── */

export function emailSecretName(tenantId: string): string {
  return `connectview/email/${tenantId}`;
}

/** Lee `email` de la config de conexiones del tenant (defensivo con string|map). */
export async function readEmailConfig(tenantId: string): Promise<EmailConfig> {
  try {
    const r = await ddb.send(
      new GetItemCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { tenantId: { S: tenantId } },
      }),
    );
    const raw = r.Item?.configJson?.S;
    if (!raw) return {};
    const cfg = JSON.parse(raw) as { email?: EmailConfig };
    return cfg.email || {};
  } catch {
    return {};
  }
}

export async function readEmailSecret(tenantId: string): Promise<EmailSecret> {
  try {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: emailSecretName(tenantId) }));
    return r.SecretString ? (JSON.parse(r.SecretString) as EmailSecret) : {};
  } catch {
    return {};
  }
}

/* ───────────────────────── MIME (nodemailer MailComposer) ─────────────────── */

function fromHeader(email: string, name?: string): string {
  return name ? `"${name.replace(/"/g, "")}" <${email}>` : email;
}

async function buildMime(
  msg: OutboundEmail,
  fromEmail: string,
  fromName?: string,
): Promise<Buffer> {
  const mail = new MailComposer({
    from: fromHeader(fromEmail, fromName),
    to: msg.to,
    cc: msg.cc,
    bcc: msg.bcc,
    replyTo: msg.replyTo,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    attachments: msg.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.contentBase64, "base64"),
      contentType: a.contentType,
    })),
  });
  return await new Promise<Buffer>((resolve, reject) => {
    mail.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

/* ───────────────────────── Adapters por proveedor ────────────────────────── */

async function sendViaSes(
  p: Extract<EmailProvider, { kind: "ses" | "novasys" }>,
  msg: OutboundEmail,
): Promise<SendResult> {
  const fromEmail = msg.fromEmail || (p.kind === "ses" ? p.fromEmail : NOVASYS_FROM);
  const fromName = msg.fromName || (p.kind === "ses" ? p.fromName : "ARIA · by Novasys");
  const region = (p.kind === "ses" && p.region) || NOVASYS_REGION;

  // SES del propio tenant: asume su rol cross-account para usar SU SES verificado.
  let client = new SESv2Client({ region });
  if (p.kind === "ses" && p.useTenantRole) {
    const roleArn = process.env.TENANT_ROLE_ARN_PREFIX
      ? `${process.env.TENANT_ROLE_ARN_PREFIX}`
      : undefined;
    if (roleArn) {
      const a = await sts.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName: "vox-email",
          DurationSeconds: 3600,
        }),
      );
      const c = a.Credentials;
      if (c?.AccessKeyId && c.SecretAccessKey) {
        client = new SESv2Client({
          region,
          credentials: {
            accessKeyId: c.AccessKeyId,
            secretAccessKey: c.SecretAccessKey,
            sessionToken: c.SessionToken,
          },
        });
      }
    }
  }

  const raw = await buildMime(msg, fromEmail, fromName);
  const r = await client.send(new SendEmailCommand({ Content: { Raw: { Data: raw } } }));
  return { ok: true, messageId: r.MessageId, provider: p.kind };
}

async function sendViaSmtp(
  p: Extract<EmailProvider, { kind: "smtp" }>,
  secret: EmailSecret,
  msg: OutboundEmail,
): Promise<SendResult> {
  if (!secret.smtpPass)
    return { ok: false, error: "Falta la contraseña SMTP en el secreto", provider: "smtp" };
  const transport = nodemailer.createTransport({
    host: p.host,
    port: p.port,
    secure: p.secure ?? p.port === 465,
    auth: { user: p.user, pass: secret.smtpPass },
  });
  const info = await transport.sendMail({
    from: fromHeader(msg.fromEmail || p.fromEmail, msg.fromName || p.fromName),
    to: msg.to,
    cc: msg.cc,
    bcc: msg.bcc,
    replyTo: msg.replyTo,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    attachments: msg.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.contentBase64, "base64"),
      contentType: a.contentType,
    })),
  });
  return { ok: true, messageId: info.messageId, provider: "smtp" };
}

async function oauthAccessToken(url: string, params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({ ...params, grant_type: "refresh_token" });
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json()) as { access_token?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(j.error_description || `OAuth ${r.status}`);
  return j.access_token;
}

async function sendViaGmail(
  p: Extract<EmailProvider, { kind: "gmail" }>,
  secret: EmailSecret,
  msg: OutboundEmail,
): Promise<SendResult> {
  if (!secret.gmailClientId || !secret.gmailClientSecret || !secret.gmailRefreshToken)
    return { ok: false, error: "Faltan credenciales OAuth de Gmail", provider: "gmail" };
  const token = await oauthAccessToken("https://oauth2.googleapis.com/token", {
    client_id: secret.gmailClientId,
    client_secret: secret.gmailClientSecret,
    refresh_token: secret.gmailRefreshToken,
  });
  const raw = (await buildMime(msg, msg.fromEmail || p.fromEmail, msg.fromName || p.fromName))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const j = (await r.json()) as { id?: string; error?: { message?: string } };
  if (!r.ok)
    return { ok: false, error: j.error?.message || `Gmail ${r.status}`, provider: "gmail" };
  return { ok: true, messageId: j.id, provider: "gmail" };
}

async function sendViaGraph(
  p: Extract<EmailProvider, { kind: "microsoft" }>,
  secret: EmailSecret,
  msg: OutboundEmail,
): Promise<SendResult> {
  if (!secret.msClientId || !secret.msClientSecret || !secret.msRefreshToken || !secret.msTenant)
    return { ok: false, error: "Faltan credenciales OAuth de Microsoft", provider: "microsoft" };
  const token = await oauthAccessToken(
    `https://login.microsoftonline.com/${secret.msTenant}/oauth2/v2.0/token`,
    {
      client_id: secret.msClientId,
      client_secret: secret.msClientSecret,
      refresh_token: secret.msRefreshToken,
      scope: "https://graph.microsoft.com/.default",
    },
  );
  const sender = p.sender || msg.fromEmail || p.fromEmail;
  const toRecip = (addr: string) => ({ emailAddress: { address: addr } });
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: { contentType: msg.html ? "HTML" : "Text", content: msg.html || msg.text || "" },
          toRecipients: msg.to.map(toRecip),
          ccRecipients: (msg.cc || []).map(toRecip),
          bccRecipients: (msg.bcc || []).map(toRecip),
          replyTo: msg.replyTo ? [toRecip(msg.replyTo)] : undefined,
          attachments: msg.attachments?.map((a) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: a.filename,
            contentType: a.contentType,
            contentBytes: a.contentBase64,
          })),
        },
        saveToSentItems: true,
      }),
    },
  );
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, error: j.error?.message || `Graph ${r.status}`, provider: "microsoft" };
  }
  return { ok: true, provider: "microsoft" };
}

async function sendViaHttp(
  p: Extract<EmailProvider, { kind: "sendgrid" | "resend" | "mailgun" }>,
  secret: EmailSecret,
  msg: OutboundEmail,
): Promise<SendResult> {
  const from = fromHeader(msg.fromEmail || p.fromEmail, msg.fromName || p.fromName);
  if (p.kind === "sendgrid") {
    if (!secret.sendgridKey)
      return { ok: false, error: "Falta API key de SendGrid", provider: "sendgrid" };
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          { to: msg.to.map((e) => ({ email: e })), cc: msg.cc?.map((e) => ({ email: e })) },
        ],
        from: { email: msg.fromEmail || p.fromEmail, name: msg.fromName || p.fromName },
        subject: msg.subject,
        content: [
          msg.text ? { type: "text/plain", value: msg.text } : null,
          msg.html ? { type: "text/html", value: msg.html } : null,
        ].filter(Boolean),
      }),
    });
    if (!r.ok) return { ok: false, error: `SendGrid ${r.status}`, provider: "sendgrid" };
    return {
      ok: true,
      messageId: r.headers.get("x-message-id") || undefined,
      provider: "sendgrid",
    };
  }
  if (p.kind === "resend") {
    if (!secret.resendKey)
      return { ok: false, error: "Falta API key de Resend", provider: "resend" };
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        reply_to: msg.replyTo,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    const j = (await r.json()) as { id?: string; message?: string };
    if (!r.ok) return { ok: false, error: j.message || `Resend ${r.status}`, provider: "resend" };
    return { ok: true, messageId: j.id, provider: "resend" };
  }
  // mailgun
  if (!secret.mailgunKey || !p.domain)
    return { ok: false, error: "Falta API key o dominio de Mailgun", provider: "mailgun" };
  const base = p.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  const form = new URLSearchParams();
  form.set("from", from);
  msg.to.forEach((e) => form.append("to", e));
  (msg.cc || []).forEach((e) => form.append("cc", e));
  form.set("subject", msg.subject);
  if (msg.text) form.set("text", msg.text);
  if (msg.html) form.set("html", msg.html);
  if (msg.replyTo) form.set("h:Reply-To", msg.replyTo);
  const r = await fetch(`${base}/v3/${p.domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${secret.mailgunKey}`).toString("base64")}`,
    },
    body: form,
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) return { ok: false, error: j.message || `Mailgun ${r.status}`, provider: "mailgun" };
  return { ok: true, messageId: j.id, provider: "mailgun" };
}

/* ───────────────────────── Punto de entrada ──────────────────────────────── */

/**
 * Envía un correo resolviendo el proveedor del tenant. Si no hay proveedor
 * configurado, cae al SES compartido de Novasys (pilotos).
 */
export async function sendEmail(tenantId: string, msg: OutboundEmail): Promise<SendResult> {
  const cfg = await readEmailConfig(tenantId);
  const provider = cfg.provider || { kind: "novasys" as const };
  try {
    switch (provider.kind) {
      case "novasys":
      case "ses":
        return await sendViaSes(provider, msg);
      case "smtp":
        return await sendViaSmtp(provider, await readEmailSecret(tenantId), msg);
      case "gmail":
        return await sendViaGmail(provider, await readEmailSecret(tenantId), msg);
      case "microsoft":
        return await sendViaGraph(provider, await readEmailSecret(tenantId), msg);
      case "sendgrid":
      case "resend":
      case "mailgun":
        return await sendViaHttp(provider, await readEmailSecret(tenantId), msg);
      default:
        return { ok: false, error: "Proveedor de correo desconocido", provider: "unknown" };
    }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e), provider: provider.kind };
  }
}

/** Correo de prueba con la marca ARIA — para el botón «Enviar prueba» de la UI. */
export async function sendTestEmail(tenantId: string, to: string): Promise<SendResult> {
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e7e9f0;border-radius:12px;overflow:hidden">` +
    `<div style="background:linear-gradient(135deg,#2c5698,#158a8c);padding:16px 22px"><span style="color:#fff;font-weight:800;font-size:18px">ARIA</span></div>` +
    `<div style="padding:22px;color:#141c2b;font-size:14px;line-height:1.6">Tu correo quedó configurado correctamente en ARIA. Este es un envío de prueba.</div>` +
    `</div>`;
  return sendEmail(tenantId, {
    to: [to],
    subject: "Prueba de configuración · ARIA",
    html,
    text: "Tu correo quedó configurado correctamente en ARIA. Este es un envío de prueba.",
  });
}
