import type { Handler } from "aws-lambda";
import { getIdentity } from "../_shared/cognitoAuth";
import { sendEmail, sendTestEmail, type OutboundEmail } from "../_shared/email";

/**
 * send-email — envío de correo saliente por el proveedor configurado del tenant
 * (SES / SMTP / Gmail / Microsoft / SendGrid·Resend·Mailgun), resuelto en
 * `_shared/email.ts`. Function URL pública; el tenantId SALE del JWT (nunca de un
 * query param). CORS lo pone la Function URL (no duplicar headers).
 *
 * Body:
 *   { test: true, to }                              → correo de prueba de config
 *   { to, subject, html?, text?, cc?, bcc?,         → envío real
 *     replyTo?, inReplyTo?, references?, attachments? }
 *
 * 🔑 Hand-managed → deploy con `deploy-lambda.mjs send-email` (bundlea nodemailer
 *    vía EXTERNAL_OVERRIDE). IAM: ses:SendEmail, secretsmanager:GetSecretValue
 *    (connectview/email/*), dynamodb:GetItem (connectview-connections),
 *    sts:AssumeRole (para SES del tenant).
 */
const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const identity = await getIdentity(event.headers || {});
  if (!identity?.tenantId) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "No autenticado" }) };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  // Prueba de configuración ("Enviar prueba" en Integraciones → Correo).
  if (body.test) {
    const to = String(body.to || "").trim();
    if (!to) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "Falta el destinatario" }),
      };
    }
    const r = await sendTestEmail(identity.tenantId, to);
    return { statusCode: r.ok ? 200 : 502, headers: CORS, body: JSON.stringify(r) };
  }

  // Envío real.
  const to: string[] = Array.isArray(body.to)
    ? body.to.map(String)
    : body.to
      ? [String(body.to)]
      : [];
  if (!to.length || !body.subject) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Faltan el destinatario o el asunto" }),
    };
  }

  const msg: OutboundEmail = {
    to,
    cc: body.cc,
    bcc: body.bcc,
    subject: String(body.subject),
    html: body.html,
    text: body.text,
    replyTo: body.replyTo,
    inReplyTo: body.inReplyTo,
    references: body.references,
    attachments: body.attachments,
  };

  const r = await sendEmail(identity.tenantId, msg);
  return { statusCode: r.ok ? 200 : 502, headers: CORS, body: JSON.stringify(r) };
};
