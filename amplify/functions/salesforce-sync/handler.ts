import type { Handler } from "aws-lambda";
import {
  soql,
  soqlEscape,
  getToken,
  setActiveTenant,
  describeSObject,
} from "../_shared/salesforceClient";
import { resolveTenantId } from "../_shared/cognitoAuth";
import {
  propagateLead,
  sfStatusToStage,
  channelToSf,
  appendLeadHistory,
  getLeadHistoryByPhone,
  setActiveDynamo,
  setActiveProfiles,
} from "../_shared/leadSync";
import { sfPhoneCandidates } from "../_shared/phone";
import { resolveDynamo, resolveCustomerProfiles } from "../_shared/tenantConnect";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";

// BYO Data Plane (#46): leadSync escribe a DynamoDB. Si el tenant lo activó,
// las escrituras van a SU tabla (`connectview-leads` en su cuenta).
const legacyDynamo = new DynamoDBClient({});
// CP legacy (Novasys) — solo para el tenant fundador; resolveCustomerProfiles
// bloquea a un tenant real sin CP (jamás escribe el perfil en Novasys).
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";

/**
 * salesforce-sync — Vox → Salesforce (outbound). Lo llama el agent desktop
 * justo después de guardar un wrap-up. Ahora delega en el hub propagateLead():
 * el lead se escribe en las TRES superficies (tabla de Leads, Customer Profile
 * y Salesforce: Lead + Status + un Task con la gestión). Antes solo tocaba SF.
 *
 * Body (de WrapUpView):
 *   { customerPhone, customerName?, email?, company?,
 *     leadStatus?,                     // SF Lead Status (salesforceValue)
 *     stageLabel, subStageLabel, valoracion,
 *     notes?, summary?, agentUsername?, contactId? }
 */
const CORS: Record<string, string> = { "Content-Type": "application/json" };

interface SyncBody {
  customerPhone?: string;
  customerName?: string;
  email?: string;
  company?: string;
  leadStatus?: string;
  stageId?: string;
  stageLabel?: string;
  subStageLabel?: string;
  valoracion?: string;
  notes?: string;
  summary?: string;
  agentUsername?: string;
  contactId?: string;
  /** Canal del contacto (VOICE/CHAT/EMAIL/TASK) — define cómo se registra la actividad. */
  channel?: string;
  /** true ⇒ el agente cerró el contacto SIN tipificar → registrar interacción "sin tipificar". */
  untyped?: boolean;
  durationSeconds?: number;
  mode?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // Setea el tenant activo a partir del JWT del agente que cerró la gestión.
  // Todos los helpers (getToken / soql / propagateLead / appendLeadHistory)
  // pegan a SU Salesforce. Si el tenant no conectó SF, salesforceClient cae
  // al JWT bearer legacy (single-tenant Novasys) — el comportamiento actual
  // queda intacto para los Lambdas y para el path de transición.
  const tenantId = await resolveTenantId(event?.headers);
  setActiveTenant(tenantId);
  // Pilar 10 — el mapeo de campos ARIA→SF se auto-carga dentro de leadSync
  // (pushLeadToSalesforce) desde connectview-connections, así que NO hay que
  // cablearlo acá: aplica a este path y a todos los callers de propagateLead.
  // BYO Data Plane (#46): DynamoDB del tenant para leadSync (propagateLead,
  // appendLeadHistory, …). Fallback a Vox pooled si no aplicó el template.
  {
    const r = await resolveDynamo(event?.headers, legacyDynamo);
    setActiveDynamo(r.tenantScoped ? r.dynamo : null);
    // Customer Profiles del tenant para el upsert del Cliente 360° en
    // propagateLead. Fail-closed: tenant real sin CP → bloqueado, NUNCA Novasys.
    const cp = await resolveCustomerProfiles(
      event?.headers,
      legacyProfiles,
      LEGACY_PROFILES_DOMAIN,
    );
    setActiveProfiles(cp.client, cp.domainName);
  }
  let body: SyncBody;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "bad json" }) };
  }

  // Read-only connectivity check (no writes) — verifies OAuth + SOQL end-to-end.
  // Trigger with ?mode=ping or {"mode":"ping"}.
  if (event?.queryStringParameters?.mode === "ping" || body.mode === "ping") {
    try {
      const tok = await getToken();
      const rows = await soql("SELECT Id, Name, InstanceName FROM Organization LIMIT 1");
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          mode: "ping",
          instanceUrl: tok.instanceUrl,
          org: rows[0] ?? null,
        }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          mode: "ping",
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  // ── DESCRIBE mode (Pilar 10): campos escribibles del Lead de la org del
  //    tenant → alimenta la UI de mapeo schema-aware. Solo lectura.
  //    GET ?mode=describe[&sobject=Lead]. ─────────────────────────────────────
  if (event?.queryStringParameters?.mode === "describe" || body.mode === "describe") {
    const sobject = (event?.queryStringParameters?.sobject || "Lead").replace(/[^A-Za-z0-9_]/g, "");
    try {
      const fields = await describeSObject(sobject || "Lead");
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, mode: "describe", sobject: sobject || "Lead", fields }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          mode: "describe",
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  // ── READ mode: detalle del Lead + su actividad en SF (alimenta el panel
  //    "Salesforce" del detalle de lead en Vox). GET ?mode=lead&phone=… o
  //    POST {mode:"lead", phone|sfLeadId}. Solo lectura. ──────────────────────
  const qs = event?.queryStringParameters || {};
  if (qs.mode === "lead" || body.mode === "lead") {
    const phoneQ = (body.customerPhone || body.phone || qs.phone || "").trim();
    const sfId = (body.sfLeadId || qs.sfLeadId || "").trim();
    if (!phoneQ && !sfId) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "need phone or sfLeadId" }),
      };
    }
    try {
      const voxHistory = phoneQ ? await getLeadHistoryByPhone(phoneQ) : [];
      // Match por teléfono tolerante a formato (E.164 + dígitos pelados) → el
      // panel encuentra el Lead aunque SF lo guarde distinto a Vox.
      const phoneClause = sfPhoneCandidates(phoneQ)
        .flatMap((c) => {
          const p = soqlEscape(c);
          return [`Phone = '${p}'`, `MobilePhone = '${p}'`];
        })
        .join(" OR ");
      const where = sfId
        ? `Id = '${soqlEscape(sfId)}'`
        : phoneClause || `Phone = '${soqlEscape(phoneQ)}'`;
      const leads = await soql(
        `SELECT Id, Name, FirstName, LastName, Phone, MobilePhone, Email, Company, Status, LeadSource, Title, Industry, Rating, Website, IsConverted, CreatedDate, LastModifiedDate FROM Lead WHERE ${where} ORDER BY LastModifiedDate DESC LIMIT 1`,
      );
      if (!leads.length) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ found: false, voxHistory }),
        };
      }
      const lead = leads[0];
      const hist = voxHistory.length
        ? voxHistory
        : await getLeadHistoryByPhone(String(lead.Phone || lead.MobilePhone || ""));
      const activities = await soql(
        `SELECT Id, Subject, Description, Status, ActivityDate, CreatedDate, TaskSubtype FROM Task WHERE WhoId = '${soqlEscape(String(lead.Id))}' ORDER BY CreatedDate DESC LIMIT 25`,
      );
      const tok = await getToken();
      const lightningUrl = tok.instanceUrl.replace(".my.salesforce.com", ".lightning.force.com");
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ found: true, lead, activities, lightningUrl, voxHistory: hist }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tenant real sin SF conectado → no es un error de lectura, es "no
      // configurado". El panel SF del detalle de lead lo muestra como vacío.
      if (msg.startsWith("SF_NOT_CONNECTED")) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ found: false, sfNotConnected: true }),
        };
      }
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: "sf read failed", message: msg }),
      };
    }
  }

  const phone = (body.customerPhone || "").trim();
  const email = (body.email || "").trim();
  if (!phone && !email) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "need customerPhone or email to match a Lead" }),
    };
  }

  try {
    // Canal del contacto → cómo se registra la actividad en SF (Call/Email/Task).
    const ch = channelToSf(body.channel);

    // ── Interacción SIN tipificar (el agente cerró sin tipificar) ──
    // Se registra en el lead de Vox (aparece en Recientes + historial marcada "sin
    // tipificar"). NO va a Salesforce ni cambia estado — solo las gestiones tipificadas.
    if (body.untyped) {
      const result = await propagateLead(
        { phone, email, name: body.customerName, company: body.company, source: "Llamada" },
        { origin: "vox", pushToSf: false },
      );
      if (result.leadId) {
        const s = typeof body.durationSeconds === "number" ? body.durationSeconds : 0;
        const dur = s > 0 ? `${Math.floor(s / 60)}m ${s % 60}s` : "";
        await appendLeadHistory(result.leadId, {
          ts: new Date().toISOString(),
          type: "interaccion",
          channel: ch.label,
          untyped: true,
          contactId: body.contactId,
          summary: dur ? `${ch.label} de ${dur} · sin tipificar` : `${ch.label} · sin tipificar`,
          agent: body.agentUsername,
        });
      }
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, untyped: true, ...result }),
      };
    }

    // El Task de SF documenta la gestión: canal + stage › substage + notas/resumen.
    const subjectBits = [body.stageLabel, body.subStageLabel].filter(Boolean);
    const subject = `${ch.emoji} Vox · ${subjectBits.join(" › ") || "Gestión"}`;
    const taskDescription = [
      `Canal: ${ch.label}`,
      body.summary ? `Resumen: ${body.summary}` : "",
      body.notes ? `Notas: ${body.notes}` : "",
      body.valoracion ? `Valoración: ${body.valoracion}` : "",
      body.agentUsername ? `Agente: ${body.agentUsername}` : "",
      body.contactId ? `ContactId: ${body.contactId}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // stageId del embudo: explícito si vino, si no lo derivamos del SF Status.
    const stageId = body.stageId || (await sfStatusToStage(body.leadStatus));

    const result = await propagateLead(
      {
        phone,
        email,
        name: body.customerName,
        company: body.company,
        leadStatus: body.leadStatus || undefined,
        stageId,
        source: "Vox Wrap-up",
      },
      {
        origin: "vox",
        sfExtra: { taskSubject: subject, taskDescription, taskSubtype: ch.subtype },
      },
    );

    // Registrar el evento en el historial del lead de Vox (contacto + tipificación).
    if (result.leadId) {
      await appendLeadHistory(result.leadId, {
        ts: new Date().toISOString(),
        type: "gestion",
        channel: ch.label,
        contactId: body.contactId,
        stageId,
        stageLabel: body.stageLabel,
        subStageLabel: body.subStageLabel,
        valoracion: body.valoracion,
        summary: body.summary,
        notes: body.notes,
        agent: body.agentUsername,
        sfTaskId: result.sf?.taskId || undefined,
      });
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    console.error("salesforce-sync error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "sync failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
