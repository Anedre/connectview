import type { Handler } from "aws-lambda";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import {
  propagateLead,
  sfStatusToStage,
  appendLeadHistory,
  stageIdToLabel,
  setActiveDynamo,
  setActiveProfiles,
} from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";
import { getTenantConnect, resolveCustomerProfiles } from "../_shared/tenantConnect";
import { timingSafeEqual } from "node:crypto";

/** Comparación de tiempo constante para el shared secret — evita un
 *  timing side-channel que permitiría recuperar el secreto byte a byte. */
function safeSecretEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * salesforce-inbound-webhook — Salesforce → Vox (inbound). A record-triggered
 * Flow / Apex trigger in Salesforce fires an HTTP callout here whenever a Lead
 * is created or updated. Lo pasamos por el hub propagateLead() con
 * origin="salesforce": llena el **Lead del embudo** (stage mapeado desde el
 * Status de SF) Y el **Customer Profile**, sin re-empujar a SF (anti-loop).
 *
 * Auth: a shared secret header (x-vox-token) must match SF_WEBHOOK_SECRET.
 * (Function URL is public, so this header is what gates it.)
 *
 * Multi-tenant (#44): el SF Flow inyecta `tenantId` en el body. Lo seteamos
 * como activeTenant para que cualquier llamada SF posterior (en propagateLead
 * cuando se queme algún update inverso) use la org del cliente. Si no viene,
 * cae a "default" → comportamiento legacy (Novasys).
 *
 * Expected JSON body (the SF Flow maps these from the Lead record):
 *   { tenantId?, phone?, mobilePhone?, firstName?, lastName?, email?,
 *     company?, status?, leadId?, source? }
 */
const CORS: Record<string, string> = { "Content-Type": "application/json" };
const WEBHOOK_SECRET = process.env.SF_WEBHOOK_SECRET || "";
// CP legacy (Novasys) — usado SOLO para el tenant fundador (sin tenantId en el
// body). Un tenant real resuelve SU CP (o bloqueado) vía resolveCustomerProfiles.
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

interface InboundLead {
  /** UUID del tenant dueño de la org SF que dispara el webhook. El SF Flow
   *  lo hardcodea cuando el cliente configura el trigger (la wizard de Vox
   *  le da copy/paste del valor). */
  tenantId?: string;
  phone?: string;
  mobilePhone?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  status?: string;
  leadId?: string;
  source?: string;
}

/** Best-effort E.164 normalisation. SF phones come in many shapes; we
 *  default a bare 9-digit number to Perú (+51) since that's the client's
 *  market, otherwise just prepend + to a digit string. */
function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 9) return `+51${digits}`; // PE mobile
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method =
    event?.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // Shared-secret gate. Header names arrive lowercased on Function URLs.
  // Comparación constant-time (este endpoint es público; el header es la
  // única barrera).
  const headers = event.headers || {};
  const token = headers["x-vox-token"] || headers["X-Vox-Token"];
  if (!WEBHOOK_SECRET || !safeSecretEq(token, WEBHOOK_SECRET)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "unauthorized" }) };
  }

  let lead: InboundLead;
  try {
    lead = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "bad json" }) };
  }

  // Tenant del payload (el SF Flow lo manda). Falla → "default" (legacy).
  // Importante: este Lambda NO tiene JWT (lo invoca SF directo), así que el
  // único discriminador es el campo del body.
  setActiveTenant(lead.tenantId || null);
  // BYO Data Plane (#46): mismo tenantId → su DynamoDB. Sin tenant o sin SF
  // configurado → null → leadSync vuelve al cliente legacy de Vox.
  if (lead.tenantId) {
    const tc = await getTenantConnect(lead.tenantId);
    setActiveDynamo(tc?.dynamo || null);
  } else {
    setActiveDynamo(null);
  }
  // Customer Profiles fail-closed: tenant real → SU CP (o bloqueado si no lo
  // resolvió), NUNCA Novasys. Sin tenantId → "novasys" (legacy) = CP de Novasys
  // (sus datos, este webhook lo dispara la org SF del fundador).
  {
    const cp = await resolveCustomerProfiles(
      undefined,
      legacyProfiles,
      LEGACY_PROFILES_DOMAIN,
      lead.tenantId || "novasys"
    );
    setActiveProfiles(cp.client, cp.domainName);
  }

  const phone = normalizePhone(lead.phone) || normalizePhone(lead.mobilePhone);
  if (!phone) {
    // Without a usable phone we can't key a Customer Profile (the domain
    // is keyed on _phone). Acknowledge so SF doesn't retry forever.
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, skipped: "no usable phone" }),
    };
  }

  const customerName = [lead.firstName, lead.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  // Atributos extra que viajan al lead/perfil (los keyword-mapeados como
  // email/empresa los resuelve el hub; acá guardamos la huella de SF).
  const attributes: Record<string, string> = {};
  if (lead.status) attributes.sf_lead_status = lead.status;
  if (lead.source) attributes.sf_lead_source = lead.source;

  try {
    // Status de SF → stage del embudo (si el usuario mapeó la tipificación).
    const stageId = await sfStatusToStage(lead.status);

    const result = await propagateLead(
      {
        phone,
        email: lead.email,
        name: customerName,
        // Ignorar la empresa default basura que Vox pone al crear el Lead en SF.
        company: lead.company && lead.company !== "Lead sin empresa" ? lead.company : undefined,
        stageId,
        sfLeadId: lead.leadId,
        source: lead.source || "Salesforce",
        attributes,
      },
      { origin: "salesforce" } // no re-empuja a SF (anti-loop)
    );
    // Registrar el cambio venido de SF en el historial del lead (si hubo cambio real).
    if (result.leadId && result.voxAction !== "unchanged") {
      await appendLeadHistory(result.leadId, {
        ts: new Date().toISOString(),
        type: "stage_change",
        channel: "Salesforce",
        stageId,
        stageLabel: await stageIdToLabel(stageId),
        summary: `Actualización desde Salesforce${lead.status ? ` · ${lead.status}` : ""}`,
      });
    }
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, phone, ...result }),
    };
  } catch (err) {
    console.error("salesforce-inbound-webhook error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "inbound sync failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
