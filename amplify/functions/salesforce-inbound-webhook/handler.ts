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
import {
  getTenantConnect,
  isTenantDataPlaneEnabled,
  resolveCustomerProfiles,
} from "../_shared/tenantConnect";
import { resolveTenantFromInboundToken } from "../_shared/sfInboundToken";
import { fireAutomation } from "../_shared/automationHook";

/**
 * salesforce-inbound-webhook — Salesforce → Vox (inbound). A record-triggered
 * Flow / Apex trigger in Salesforce fires an HTTP callout here whenever a Lead
 * is created or updated. Lo pasamos por el hub propagateLead() con
 * origin="salesforce": llena el **Lead del embudo** (stage mapeado desde el
 * Status de SF) Y el **Customer Profile**, sin re-empujar a SF (anti-loop).
 *
 * Auth multi-tenant (endurecido): el header `x-vox-token` ya NO es un secret
 * GLOBAL. Es un token DISTINTO por tenant (`voxsf.<tenantId>.<secret>`,
 * guardado en `connectview/tenant/<id>/sf-inbound`). Resolvemos el tenant DESDE
 * el token — comparación constant-time contra el secret guardado del tenant — y
 * FORZAMOS ese tenantId. El `tenantId` del BODY se IGNORA por completo. Así un
 * holder de UN token no puede escribir en el data plane de OTRO tenant (el
 * problema que el secret global no cerraba: probaba "conozco el secret", no
 * "soy dueño del tenantId"). Ver [[sfInboundToken]].
 *
 * El fundador corre como tenant real `t_…` con su BYO data plane; su Salesforce
 * es la org master (MASTER_SF_TENANT_IDS lo remapea vía setActiveTenant para el
 * push inverso). Provisioná su token con `manage-connections` (botón en
 * Integraciones) o `scripts/set-sf-inbound-token.mjs`.
 *
 * Expected JSON body (the SF Flow maps these from the Lead record; `tenantId`
 * si todavía viene queda IGNORADO):
 *   { phone?, mobilePhone?, firstName?, lastName?, email?,
 *     company?, status?, leadId?, source? }
 */
const CORS: Record<string, string> = { "Content-Type": "application/json" };
// Args legacy REQUERIDOS por la firma de resolveCustomerProfiles
// (legacyClient/legacyDomain). Como el tenant se resuelve del token (real) y el
// 403 de abajo exige BYO Data Plane, la rama legacy ya NO se alcanza.
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

interface InboundLead {
  /** IGNORADO. El tenant se resuelve del token `x-vox-token`, no del body.
   *  El SF Flow puede seguir mandándolo (compat) pero no se usa. */
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
  const method = event?.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // Auth per-tenant. Header names arrive lowercased on Function URLs. El tenant
  // se RESUELVE del token (constant-time contra el secret guardado del tenant) —
  // ése es el dueño autenticado; el body no decide el tenant. 401 si el token no
  // autentica a nadie. Este endpoint es público; el token es la única barrera.
  const headers = event.headers || {};
  const token = headers["x-vox-token"] || headers["X-Vox-Token"];
  const tenantId = await resolveTenantFromInboundToken(token);
  if (!tenantId) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "unauthorized" }) };
  }

  let lead: InboundLead;
  try {
    lead = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "bad json" }) };
  }
  // NOTA: `lead.tenantId` se IGNORA. El tenant ya está FORZADO desde el token.

  // Defensa en profundidad (igual criterio que web-form-capture): un tenant real
  // SIN BYO Data Plane no tiene dónde escribir aislado → en vez de caer al
  // DynamoDB pooled de Novasys (setActiveDynamo(null)) rechazamos con 403. El
  // fundador tiene Data Plane habilitado, así que pasa. getTenantConnect resuelve
  // sus clients assumed (DynamoDB/Customer Profiles en SU cuenta).
  const tc = await getTenantConnect(tenantId);
  const dpOn = await isTenantDataPlaneEnabled(tenantId);
  if (!tc || !dpOn) {
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({
        error: "El tenant no tiene Data Plane (BYO) habilitado para sincronizar leads",
      }),
    };
  }

  // activeTenant → SU org SF para el push inverso (o, si está en
  // MASTER_SF_TENANT_IDS, el SF master del fundador).
  setActiveTenant(tenantId);
  // BYO Data Plane (#46): su DynamoDB (assumed creds → su cuenta).
  setActiveDynamo(tc.dynamo);
  // Customer Profiles fail-closed: SU CP (o se saltea si no se resolvió dominio),
  // NUNCA el de Novasys.
  {
    const cp = await resolveCustomerProfiles(
      undefined,
      legacyProfiles,
      LEGACY_PROFILES_DOMAIN,
      tenantId,
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

  const customerName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();

  // Atributos extra que viajan al lead/perfil (los keyword-mapeados como
  // email/empresa los resuelve el hub; aquí guardamos la huella de SF).
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
      { origin: "salesforce" }, // no re-empuja a SF (anti-loop)
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

    // Automatizaciones (#15): un lead NUEVO que entra desde Salesforce dispara
    // `lead_created` (welcome flows, etc.). Solo en "created" (no en updates) y
    // de a uno (inbound) → sin riesgo de blast. Best-effort: nunca rompe el sync.
    //
    // NOTA: la carga CSV masiva de campañas (create-campaign → bulkUpsertVoxLeads)
    // NO dispara `lead_created` a propósito: serían miles de eventos sincrónicos
    // (blast de WhatsApp) y la campaña ya tiene su propio envío de salida.
    if (result.voxAction === "created" && result.leadId) {
      try {
        await fireAutomation({
          type: "lead_created",
          tenantId,
          lead: {
            leadId: result.leadId,
            phone,
            name: customerName,
            stageId,
            source: lead.source || "Salesforce",
          },
        });
      } catch {
        /* no romper el inbound sync por una automatización */
      }
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
