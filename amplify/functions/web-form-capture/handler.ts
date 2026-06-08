import type { Handler } from "aws-lambda";
import { propagateLead, setActiveDynamo, setActiveProfiles } from "../_shared/leadSync";
import { getTenantConnect, isTenantDataPlaneEnabled } from "../_shared/tenantConnect";
import { isLegacyTenant } from "../_shared/cognitoAuth";
import { setActiveTenant } from "../_shared/salesforceClient";

/**
 * web-form-capture — public endpoint a website form posts to so leads land
 * straight in the CRM (Customer Profiles). This is the "Sappier" replacement
 * (roadmap #25): native web forms → CRM, no middleware. Reuses the same CSV
 * upsert mapping (email → EmailAddress, dni → AccountNumber, etc.) so web
 * leads merge with phone/voice/WhatsApp leads on the same profile.
 *
 * Accepts both JSON and HTML form (application/x-www-form-urlencoded) bodies
 * so a plain <form> can post to it directly. Expected fields (any subset):
 *   phone (required), name|firstName|lastName, email, empresa/company,
 *   plus any extra fields → kept as profile attributes.
 *
 * Optional `formId` is recorded as an attribute so leads can be traced to
 * the form/landing they came from.
 */
// CORS is handled by the Function URL's own CORS config — setting
// Access-Control-Allow-Origin here too produces DUPLICATE headers that the
// browser rejects (the same quirk the other Vox webhooks avoid).
const CORS: Record<string, string> = {
  "Content-Type": "application/json",
};

function parseBody(event: {
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
}): Record<string, string> {
  let raw = event.body || "";
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }
  const ct = (
    event.headers?.["content-type"] ||
    event.headers?.["Content-Type"] ||
    ""
  ).toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const out: Record<string, string> = {};
    new URLSearchParams(raw).forEach((v, k) => (out[k] = v));
    return out;
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\+\d{8,15}$/.test(t)) return t;
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 9) return `+51${digits}`; // PE mobile default
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const data = parseBody(event);

  // SEGURIDAD: este endpoint es PÚBLICO (los web forms los llena cualquiera).
  // El `tenantId` viene del form, no de un JWT. Reglas para evitar que un
  // atacante inyecte leads spam a los datos pooled de Novasys:
  //  - tenantId vacío o legacy (novasys/default) → RECHAZAR. Un form público
  //    nunca escribe a los datos del tenant fundador.
  //  - tenantId real PERO sin BYO Data Plane → RECHAZAR (no hay dónde escribir
  //    de forma aislada; no contaminamos pooled).
  //  - tenantId real CON Data Plane → escribe en SU cuenta (su DynamoDB).
  const tenantId = (data.tenantId || event?.queryStringParameters?.tenantId || "").trim();
  if (!tenantId || isLegacyTenant(tenantId)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "tenantId requerido (de un tenant válido)" }),
    };
  }
  const tc = await getTenantConnect(tenantId);
  const dpOn = await isTenantDataPlaneEnabled(tenantId);
  if (!tc || !dpOn) {
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({
        error: "El tenant no tiene captura de formularios habilitada (BYO Data Plane requerido)",
      }),
    };
  }
  setActiveDynamo(tc.dynamo);
  // Customer Profiles del tenant (este Lambda ya rechazó legacy/anónimo arriba,
  // así que SIEMPRE es el CP del cliente). Si el dominio no se pudo derivar
  // ("") el upsert del Cliente 360° se saltea — NUNCA cae al CP de Novasys.
  setActiveProfiles(tc.customerProfiles, tc.customerProfilesDomain);
  // SF del tenant: SIN esto, propagateLead empujaría el lead al Salesforce de
  // Novasys (master) = leak de ESCRITURA cross-tenant. Con setActiveTenant va a SU
  // SF; si no conectó SF, getToken tira SF_NOT_CONNECTED y propagateLead lo tolera
  // (el lead igual queda en su Dynamo + CP). Además resetea el activeTenantId del
  // contenedor caliente (evita heredar el del request anterior).
  setActiveTenant(tenantId);

  const phone = normalizePhone(
    data.phone || data.telefono || data.celular || data.mobile
  );
  if (!phone) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "phone is required (valid number)" }),
    };
  }

  const customerName =
    data.name ||
    data.nombre ||
    [data.firstName || data.nombres, data.lastName || data.apellidos]
      .filter(Boolean)
      .join(" ")
      .trim();

  // Everything that isn't the phone/name becomes a profile attribute; the
  // shared upsert maps email/empresa/dni to standard fields and keeps the
  // rest in the Attributes bag.
  const reserved = new Set([
    "phone", "telefono", "celular", "mobile",
    "name", "nombre", "firstName", "nombres", "lastName", "apellidos",
  ]);
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (reserved.has(k)) continue;
    if (v != null && String(v).trim()) attributes[k] = String(v);
  }
  // Trace which form/landing this came from.
  if (data.formId) attributes.web_form = String(data.formId);
  attributes.lead_source = data.source ? String(data.source) : "web_form";

  // Campos del lead (la fuente cruda y el resto quedan en attributes).
  const email = data.email || data.correo || data.mail || attributes.email;
  const company = data.empresa || data.company || attributes.empresa;
  // Origen real del formulario/landing → LeadSource en SF + chip de origen en Vox.
  const source = data.source ? String(data.source) : "Web Form";

  try {
    // Pasa por el HUB: tablero de Leads + Customer Profile + Salesforce (origen = LeadSource).
    const result = await propagateLead(
      { phone, name: customerName, email, company, source, attributes },
      { origin: "vox" }
    );
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, phone, ...result }),
    };
  } catch (err) {
    console.error("web-form-capture error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "capture failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
