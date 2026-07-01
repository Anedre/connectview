import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { planAdvance, entryNodeId, type JourneyDef, type Enrollment } from "../_shared/journeys";
import { evaluateLeadFilter, type FilterRule } from "../_shared/leadFilter";
import { appendLeadHistory, setActiveDynamo, stageIdToLabel } from "../_shared/leadSync";
import { evaluateSend } from "../_shared/suppression";
import { newTrackingToken, storeTrackingToken, buildTrackedHtml } from "../_shared/emailTracking";

/**
 * journey-runner — el MOTOR de journeys (Fase 3). EventBridge lo dispara cada
 * 5 min y hace DOS pasadas:
 *   1) AUTO-ENROLL (3C): inscribe leads que matchean la entrada de cada journey
 *      activo (por segmento, o `new_lead` con marca de agua) — sin duplicar.
 *   2) AVANCE (3A): toma los enrollments activos cuyo `nextRunAt` venció, avanza
 *      cada uno con `planAdvance` (lógica pura) y ejecuta los efectos.
 *
 * Efectos v2 (3C): moveStage + webhook + **send REAL** (WhatsApp por el
 * send-whatsapp-template ya gateado por supresión; email por SES) + enqueueDialer
 * (registrado). Reentrante e idempotente. Procesa la tabla pooled (tenant demo);
 * multi-tenant con assume-role = follow-up.
 */
const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});
const JOURNEYS_TABLE = process.env.JOURNEYS_TABLE || "connectview-journeys";
const ENROLLMENTS_TABLE =
  process.env.JOURNEY_ENROLLMENTS_TABLE || "connectview-journey-enrollments";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const SEGMENTS_TABLE = process.env.SEGMENTS_TABLE || "connectview-segments";
const SEND_WA_URL = process.env.SEND_WHATSAPP_TEMPLATE_URL || "";
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "ARIA <notificaciones@novasys.com.pe>";
const EMAIL_TRACKING_URL = process.env.EMAIL_TRACKING_URL || ""; // Function URL de email-tracking (F4.4)
const MAX_ENROLL_PER_JOURNEY = 200;

type LeadRec = Record<string, unknown> & { leadId?: string; tenantId?: string };

async function loadJourney(tenantId: string, journeyId: string): Promise<JourneyDef | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: JOURNEYS_TABLE,
      Key: { tenantId: { S: tenantId }, journeyId: { S: journeyId } },
    }),
  );
  return r.Item ? (unmarshall(r.Item) as JourneyDef) : null;
}

async function loadLead(leadId: string): Promise<LeadRec | null> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } }),
  );
  return r.Item ? (unmarshall(r.Item) as LeadRec) : null;
}

// ── PASADA 1: auto-enroll ────────────────────────────────────────────────────

/** Journeys activos (scan de la tabla pooled). */
async function scanActiveJourneys(): Promise<JourneyDef[]> {
  const out: JourneyDef[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: JOURNEYS_TABLE,
        FilterExpression: "#st = :active",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":active": { S: "active" } },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as JourneyDef);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

/** Todos los leads (tabla pooled) — igual que el scanAll de manage-leads. */
async function scanLeads(): Promise<LeadRec[]> {
  const out: LeadRec[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as LeadRec);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

async function loadSegmentRules(
  tenantId: string,
  segmentId: string,
): Promise<{ rules: FilterRule[]; match: "all" | "any" } | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: SEGMENTS_TABLE,
      Key: { tenantId: { S: tenantId }, segmentId: { S: segmentId } },
    }),
  );
  if (!r.Item) return null;
  const seg = unmarshall(r.Item) as { rules?: FilterRule[]; match?: "all" | "any" };
  return { rules: seg.rules || [], match: seg.match === "any" ? "any" : "all" };
}

async function enrollmentFor(
  journeyId: string,
  leadId: string,
): Promise<{ status?: string } | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: ENROLLMENTS_TABLE,
      Key: { journeyId: { S: journeyId }, leadId: { S: leadId } },
    }),
  );
  return r.Item ? (unmarshall(r.Item) as { status?: string }) : null;
}

async function createEnrollment(j: JourneyDef, leadId: string, nowMs: number): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  const enr: Enrollment & { tenantId?: string } = {
    journeyId: j.journeyId,
    leadId,
    tenantId: j.tenantId,
    currentNodeId: entryNodeId(j) || "",
    status: "active",
    enteredAt: nowIso,
    nextRunAt: nowIso, // listo para avanzar en el próximo tick que venza
    history: [{ node: entryNodeId(j) || "", at: nowIso }],
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: ENROLLMENTS_TABLE,
      Item: marshall(enr, { removeUndefinedValues: true }),
    }),
  );
}

/**
 * Auto-enroll: por cada journey activo con entrada por SEGMENTO o `new_lead`,
 * inscribe los leads que matchean y no están ya inscritos. `new_lead` usa
 * `lastEnrollAt` como marca de agua (solo leads creados después) para no
 * inscribir todo el histórico. Cap por journey por tick.
 */
async function autoEnroll(nowMs: number): Promise<{ enrolled: number; journeys: number }> {
  const journeys = await scanActiveJourneys();
  const needsLeads = journeys.filter((j) => j.entry?.segmentId || j.entry?.trigger === "new_lead");
  if (!needsLeads.length) return { enrolled: 0, journeys: 0 };

  const leads = await scanLeads();
  const nowIso = new Date(nowMs).toISOString();
  let enrolled = 0;

  for (const j of needsLeads) {
    // Candidatos según la entrada.
    let candidates: LeadRec[] = [];
    if (j.entry?.segmentId) {
      const seg = await loadSegmentRules(j.tenantId || "", j.entry.segmentId);
      if (!seg) continue;
      candidates = leads.filter((l) => evaluateLeadFilter(l, seg.rules, seg.match));
    } else if (j.entry?.trigger === "new_lead") {
      // Marca de agua: primera vez → solo fija el watermark (no inscribe histórico).
      const watermark = String((j as { lastEnrollAt?: string }).lastEnrollAt || "");
      if (watermark) {
        candidates = leads.filter((l) => String(l.createdAt || "") > watermark);
      }
    }
    // Respetar tenant si el lead lo trae (defensa multi-tenant; pooled demo no lo trae).
    if (j.tenantId) {
      candidates = candidates.filter((l) => !l.tenantId || l.tenantId === j.tenantId);
    }

    let count = 0;
    for (const l of candidates) {
      if (count >= MAX_ENROLL_PER_JOURNEY) break;
      const leadId = String(l.leadId || "");
      if (!leadId) continue;
      const existing = await enrollmentFor(j.journeyId, leadId);
      if (existing && (existing.status === "active" || !j.reenroll)) continue;
      await createEnrollment(j, leadId, nowMs);
      count++;
      enrolled++;
    }
    if (count >= MAX_ENROLL_PER_JOURNEY) {
      console.warn(
        `[journey-runner] auto-enroll cap (${MAX_ENROLL_PER_JOURNEY}) en ${j.journeyId}`,
      );
    }
    // Actualizar la marca de agua (para new_lead) y timestamp de última corrida.
    await dynamo.send(
      new UpdateItemCommand({
        TableName: JOURNEYS_TABLE,
        Key: { tenantId: { S: j.tenantId || "" }, journeyId: { S: j.journeyId } },
        UpdateExpression: "SET lastEnrollAt = :n",
        ExpressionAttributeValues: { ":n": { S: nowIso } },
      }),
    );
  }
  return { enrolled, journeys: needsLeads.length };
}

// ── Efectos ──────────────────────────────────────────────────────────────────

/** Ejecuta un efecto. moveStage/webhook/send reales; enqueueDialer registrado. */
async function runEffect(
  effect: { type: string; action?: string; channel?: string; params: Record<string, unknown> },
  leadId: string,
  lead: LeadRec,
  tenantId: string,
  journeyId: string,
): Promise<string> {
  if (effect.type === "action" && effect.action === "moveStage") {
    const stageId = String(effect.params.stageId || "");
    if (!stageId) return "moveStage:sin-stage";
    setActiveDynamo(dynamo);
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET stageId = :s, updatedAt = :u",
        ExpressionAttributeValues: { ":s": { S: stageId }, ":u": { S: new Date().toISOString() } },
      }),
    );
    const label = await stageIdToLabel(stageId);
    await appendLeadHistory(leadId, {
      ts: new Date().toISOString(),
      type: "stage_change",
      stageId,
      stageLabel: label,
      notes: "Journey: cambio de etapa",
    });
    return `moveStage:${stageId}`;
  }

  if (effect.type === "action" && effect.action === "webhook") {
    const url = String(effect.params.url || "");
    if (!url) return "webhook:sin-url";
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "journey_step", leadId, lead }),
      });
      return "webhook:ok";
    } catch (e) {
      return `webhook:err:${e instanceof Error ? e.message : e}`;
    }
  }

  if (effect.type === "send") {
    const channel = effect.channel === "email" ? "email" : "whatsapp";
    return channel === "email"
      ? sendEmail(effect.params, lead, leadId, tenantId, journeyId)
      : sendWhatsApp(effect.params, lead, tenantId);
  }

  if (effect.type === "action" && effect.action === "enqueueDialer") {
    return "enqueueDialer:recorded(pending-wire)";
  }

  return `${effect.type}:noop`;
}

/** WhatsApp REAL — reusa send-whatsapp-template (que ya aplica el gate de supresión). */
async function sendWhatsApp(
  params: Record<string, unknown>,
  lead: LeadRec,
  tenantId: string,
): Promise<string> {
  const phone = String(lead.phone || "");
  if (!phone) return "send:whatsapp:sin-telefono";
  const templateName = String(params.templateName || "");
  if (!templateName) return "send:whatsapp:sin-plantilla";
  if (!SEND_WA_URL) return "send:whatsapp:sin-url";
  const variables = (Array.isArray(params.variables) ? params.variables : []).map((v) => String(v));
  try {
    const r = await fetch(SEND_WA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-vox-internal": INTERNAL_SECRET },
      body: JSON.stringify({
        phone,
        templateName,
        language: String(params.language || "es"),
        variables,
        tenantId, // BYO: manda desde el número del cliente
      }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      sent?: boolean;
      suppressed?: boolean;
      blockedBy?: string;
      error?: string;
    };
    if (body.suppressed) return `send:whatsapp:suppressed:${body.blockedBy || "?"}`;
    if (!r.ok || !body.sent) return `send:whatsapp:err:${body.error || `HTTP ${r.status}`}`;
    return "send:whatsapp:sent";
  } catch (e) {
    return `send:whatsapp:err:${e instanceof Error ? e.message : e}`;
  }
}

/**
 * Email REAL por SES + tracking 1:1 (F4.4): genera un token, inyecta el pixel de
 * apertura y envuelve los links, y registra el envío como golpe `email_out`. La
 * apertura/click las registra la Lambda pública email-tracking.
 */
async function sendEmail(
  params: Record<string, unknown>,
  lead: LeadRec,
  leadId: string,
  tenantId: string,
  journeyId: string,
): Promise<string> {
  const to = String(lead.email || "");
  if (!to) return "send:email:sin-email";
  // Gate: si el lead optó por no recibir email (opt-out channel-scoped), no mandamos.
  const phone = String(lead.phone || "");
  if (phone) {
    try {
      const v = await evaluateSend(dynamo, { phone, channel: "email" });
      if (!v.allowed) return `send:email:suppressed:${v.blockedBy}`;
    } catch {
      /* gate best-effort */
    }
  }
  const subject = String(params.subject || "ARIA");
  const bodyText = String(params.body || "");
  const baseHtml = `<p>${bodyText.replace(/\n/g, "<br>")}</p>`;

  // Tracking: token → a quién apunta; HTML con pixel + links envueltos.
  let html = baseHtml;
  let token = "";
  if (EMAIL_TRACKING_URL && leadId) {
    token = newTrackingToken();
    try {
      await storeTrackingToken(dynamo, {
        token,
        leadId,
        tenantId: tenantId || undefined,
        journeyId: journeyId || undefined,
        subject,
      });
      html = buildTrackedHtml(baseHtml, { token, base: EMAIL_TRACKING_URL });
    } catch (e) {
      console.warn("email tracking token store failed", e);
      token = "";
    }
  }

  try {
    const res = await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: bodyText, Charset: "UTF-8" },
              Html: { Data: html, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    // El envío es un golpe (Pilar 2) → suma al score. La apertura/click vienen después.
    try {
      setActiveDynamo(dynamo);
      await appendLeadHistory(leadId, {
        ts: new Date().toISOString(),
        type: "email_out",
        channel: "Correo",
        direction: "out",
        summary: subject,
        trackingToken: token || undefined,
      });
    } catch {
      /* best-effort */
    }
    return `send:email:sent:${res.MessageId?.slice(0, 12) || "ok"}${token ? ":tracked" : ""}`;
  } catch (e) {
    return `send:email:err:${e instanceof Error ? e.message : e}`;
  }
}

// ── PASADA 2: avance de enrollments vencidos ─────────────────────────────────

async function processDueEnrollments(
  nowMs: number,
): Promise<{ processed: number; advanced: number }> {
  const nowIso = new Date(nowMs).toISOString();
  let processed = 0;
  let advanced = 0;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: ENROLLMENTS_TABLE,
        FilterExpression: "#st = :active AND nextRunAt <= :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":active": { S: "active" }, ":now": { S: nowIso } },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) {
      processed++;
      const enr = unmarshall(it) as Enrollment & { tenantId?: string };
      try {
        const tenantId = String(enr.tenantId || "");
        const journey = tenantId ? await loadJourney(tenantId, enr.journeyId) : null;
        if (!journey || journey.status !== "active") {
          continue; // journey borrado/pausado → dejamos el enrollment quieto
        }
        const lead = await loadLead(enr.leadId);
        if (!lead) {
          await markEnrollment(enr, enr.currentNodeId, nowIso, "exited", "lead inexistente");
          continue;
        }
        const plan = planAdvance(journey, enr.currentNodeId, lead, nowMs);
        const notes: string[] = [];
        for (const eff of plan.effects) {
          notes.push(await runEffect(eff, enr.leadId, lead, tenantId, enr.journeyId));
        }
        await markEnrollment(
          enr,
          plan.nextNodeId,
          plan.nextRunAt,
          plan.done ? "done" : "active",
          notes.join(" · "),
        );
        advanced++;
      } catch (err) {
        console.error("journey enrollment failed", enr.journeyId, enr.leadId, err);
      }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return { processed, advanced };
}

async function markEnrollment(
  enr: Enrollment & { tenantId?: string },
  nodeId: string,
  nextRunAt: string,
  status: string,
  note: string,
): Promise<void> {
  const hist = Array.isArray(enr.history) ? enr.history : [];
  hist.push({ node: nodeId, at: new Date().toISOString(), ...(note ? { note } : {}) } as never);
  await dynamo.send(
    new UpdateItemCommand({
      TableName: ENROLLMENTS_TABLE,
      Key: { journeyId: { S: enr.journeyId }, leadId: { S: enr.leadId } },
      UpdateExpression: "SET currentNodeId = :n, nextRunAt = :r, #st = :s, history = :h",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: marshall(
        { ":n": nodeId, ":r": nextRunAt, ":s": status, ":h": hist.slice(-50) },
        { removeUndefinedValues: true },
      ),
    }),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // `event.nowMs` permite forzar el "ahora" en pruebas (avanzar esperas sin esperar).
  const nowMs = Number(event?.nowMs) || Date.now();
  const enr = await autoEnroll(nowMs);
  const res = await processDueEnrollments(nowMs);
  console.log(
    `[journey-runner] enrolled=${enr.enrolled} (de ${enr.journeys} journeys) · due=${res.processed} advanced=${res.advanced} @${new Date(nowMs).toISOString()}`,
  );
  return { statusCode: 200, body: JSON.stringify({ ...res, ...enr }) };
};
