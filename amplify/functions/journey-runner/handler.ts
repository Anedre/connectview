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
import { randomUUID } from "node:crypto";
import { planAdvance, entryNodeId, type JourneyDef, type Enrollment } from "../_shared/journeys";
import { evaluateLeadFilter, type FilterRule } from "../_shared/leadFilter";
import { appendLeadHistory, setActiveDynamo, stageIdToLabel } from "../_shared/leadSync";
import { evaluateSend, recordSuppression } from "../_shared/suppression";
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
const CALLBACKS_TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const MAX_ENROLL_PER_JOURNEY = 200;

// Horario de silencio (hora local Perú UTC-5 por default): no enviar sends fuera de ventana.
const QUIET_START = Number(process.env.QUIET_HOURS_START ?? 21);
const QUIET_END = Number(process.env.QUIET_HOURS_END ?? 8);
const QUIET_TZ_OFFSET = Number(process.env.QUIET_TZ_OFFSET ?? -5);

/** Si `nowMs` cae en horario de silencio, devuelve el ISO de la próxima ventana; si no, null. */
function quietHoursResume(nowMs: number): string | null {
  if (QUIET_START === QUIET_END) return null; // deshabilitado
  const localH = (new Date(nowMs).getUTCHours() + QUIET_TZ_OFFSET + 24) % 24;
  const inQuiet =
    QUIET_START < QUIET_END
      ? localH >= QUIET_START && localH < QUIET_END
      : localH >= QUIET_START || localH < QUIET_END; // cruza medianoche
  if (!inQuiet) return null;
  const delta = (QUIET_END - localH + 24) % 24 || 24;
  return new Date(nowMs + delta * 3_600_000).toISOString();
}

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
    return enqueueDialer(effect.params, lead, leadId);
  }

  if (effect.type === "action" && effect.action === "tag") {
    return applyTag(effect.params, lead, leadId);
  }
  if (effect.type === "action" && effect.action === "setField") {
    return setLeadField(effect.params, leadId);
  }
  if (effect.type === "action" && effect.action === "notify") {
    return notifyAgent(effect.params, lead, leadId);
  }
  if (effect.type === "action" && effect.action === "startJourney") {
    return startJourney(effect.params, leadId, tenantId);
  }
  if (effect.type === "action" && effect.action === "goal") {
    return markGoal(leadId);
  }
  if (effect.type === "action" && effect.action === "scoreAdjust") {
    return adjustScore(effect.params, lead, leadId);
  }
  if (effect.type === "action" && effect.action === "note") {
    return addNote(effect.params, leadId);
  }
  if (effect.type === "action" && effect.action === "subscription") {
    return setSubscription(effect.params, lead, leadId, tenantId);
  }
  if (effect.type === "action" && effect.action === "setProgram") {
    return setProgram(effect.params, leadId);
  }
  if (effect.type === "action" && effect.action === "sfPush") {
    return markSalesforceSync(leadId);
  }
  if (effect.type === "action" && effect.action === "unenroll") {
    return unenrollFrom(effect.params, leadId);
  }

  return `${effect.type}:noop`;
}

/** Suma/resta puntos al score del lead (lee el actual y lo re-escribe). */
async function adjustScore(
  params: Record<string, unknown>,
  lead: LeadRec,
  leadId: string,
): Promise<string> {
  const d = Number(params.delta || 0);
  if (!d) return "score:sin-cambio";
  const next = (Number(lead.score ?? 0) || 0) + d;
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET #s = :v, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "score" },
        ExpressionAttributeValues: {
          ":v": { N: String(next) },
          ":u": { S: new Date().toISOString() },
        },
      }),
    );
    return `score:${d >= 0 ? "+" : ""}${d}:→${next}`;
  } catch (e) {
    return `score:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Deja una nota interna en el historial del lead. */
async function addNote(params: Record<string, unknown>, leadId: string): Promise<string> {
  const text = String(params.text || "").trim();
  if (!text) return "note:vacia";
  try {
    setActiveDynamo(dynamo);
    await appendLeadHistory(leadId, {
      ts: new Date().toISOString(),
      type: "note",
      notes: `Journey: ${text}`,
    });
    return "note:ok";
  } catch (e) {
    return `note:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Suscribe / da de baja al lead. Baja = supresión real (opted_out) por canal. */
async function setSubscription(
  params: Record<string, unknown>,
  lead: LeadRec,
  leadId: string,
  tenantId: string,
): Promise<string> {
  const channel = String(params.channel || "all");
  const channels = channel === "all" ? ["whatsapp", "email"] : [channel];
  const phone = String(lead.phone || "");
  if (params.op === "unsubscribe") {
    if (!phone) return "subscription:sin-telefono";
    try {
      await recordSuppression(dynamo, phone, {
        status: "opted_out",
        channels,
        reason: "Journey: baja de suscripción",
        source: "manual",
        tenantId: tenantId || undefined,
        leadId,
      });
      return `subscription:opt-out:${channel}`;
    } catch (e) {
      return `subscription:err:${e instanceof Error ? e.message : e}`;
    }
  }
  // Opt-in: registra la preferencia en el lead (quitar la supresión es follow-up).
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET optIn = :c, updatedAt = :u",
        ExpressionAttributeValues: {
          ":c": { S: channel },
          ":u": { S: new Date().toISOString() },
        },
      }),
    );
    return `subscription:opt-in:${channel}`;
  } catch (e) {
    return `subscription:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Asigna el lead a un programa/unidad. */
async function setProgram(params: Record<string, unknown>, leadId: string): Promise<string> {
  const programId = String(params.programId || "").trim();
  if (!programId) return "setProgram:sin-programa";
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET programId = :p, updatedAt = :u",
        ExpressionAttributeValues: {
          ":p": { S: programId },
          ":u": { S: new Date().toISOString() },
        },
      }),
    );
    return `setProgram:${programId}`;
  } catch (e) {
    return `setProgram:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Marca el lead para sincronizar a Salesforce (lo levanta el sync de SF). */
async function markSalesforceSync(leadId: string): Promise<string> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET sfSyncPending = :t, updatedAt = :u",
        ExpressionAttributeValues: {
          ":t": { S: new Date().toISOString() },
          ":u": { S: new Date().toISOString() },
        },
      }),
    );
    return "sfPush:marcado";
  } catch (e) {
    return `sfPush:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Saca al lead de OTRO journey (marca su enrollment como "exited"). */
async function unenrollFrom(params: Record<string, unknown>, leadId: string): Promise<string> {
  const journeyId = String(params.journeyId || "").trim();
  if (!journeyId) return "unenroll:sin-journey";
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: ENROLLMENTS_TABLE,
        Key: { journeyId: { S: journeyId }, leadId: { S: leadId } },
        UpdateExpression: "SET #st = :s, updatedAt = :u",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":s": { S: "exited" },
          ":u": { S: new Date().toISOString() },
        },
        ConditionExpression: "attribute_exists(journeyId)",
      }),
    );
    return `unenroll:${journeyId}`;
  } catch {
    // No estaba inscrito → no-op silencioso.
    return "unenroll:no-inscrito";
  }
}

/** Agrega o quita una etiqueta del lead (lead.tags = lista de strings). */
async function applyTag(
  params: Record<string, unknown>,
  lead: LeadRec,
  leadId: string,
): Promise<string> {
  const tag = String(params.tag || "").trim();
  if (!tag) return "tag:sin-etiqueta";
  const op = params.op === "remove" ? "remove" : "add";
  const cur = Array.isArray(lead.tags) ? (lead.tags as unknown[]).map(String) : [];
  const next = op === "remove" ? cur.filter((t) => t !== tag) : Array.from(new Set([...cur, tag]));
  if (op === "add" && next.length === cur.length) return "tag:ya-existe";
  if (op === "remove" && next.length === cur.length) return "tag:no-tenia";
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET tags = :t, updatedAt = :u",
        ExpressionAttributeValues: marshall({ ":t": next, ":u": new Date().toISOString() }),
      }),
    );
    return `tag:${op}:${tag}`;
  } catch (e) {
    return `tag:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Escribe un valor en un campo arbitrario del lead (protege claves de sistema). */
async function setLeadField(params: Record<string, unknown>, leadId: string): Promise<string> {
  const field = String(params.field || "").trim();
  if (!field) return "setField:sin-campo";
  if (field === "leadId" || field === "tenantId" || field === "phone")
    return "setField:campo-protegido";
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET #f = :v, updatedAt = :u",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: marshall({
          ":v": params.value ?? "",
          ":u": new Date().toISOString(),
        }),
      }),
    );
    return `setField:${field}`;
  } catch (e) {
    return `setField:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Crea un aviso/tarea para el equipo en la cola de callbacks (channel="task"). */
async function notifyAgent(
  params: Record<string, unknown>,
  lead: LeadRec,
  leadId: string,
): Promise<string> {
  const message = String(params.message || "").trim() || "Aviso del journey";
  const nowIso = new Date().toISOString();
  const item = {
    callbackId: randomUUID(),
    phone: String(lead.phone || ""),
    customerName: String(lead.name || lead.fullName || ""),
    scheduledAt: nowIso,
    assignedAgentUserId: "",
    notes: message,
    channel: "task",
    actionType: "journey-notify",
    queueId: String(params.queue || ""),
    customAttributes: JSON.stringify({ source: "journey", leadId }),
    status: "SCHEDULED",
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: CALLBACKS_TABLE,
        Item: marshall(item, { removeUndefinedValues: true }),
      }),
    );
    return "notify:queued";
  } catch (e) {
    return `notify:err:${e instanceof Error ? e.message : e}`;
  }
}

/** Inscribe al lead en OTRO journey activo (composición de recorridos). */
async function startJourney(
  params: Record<string, unknown>,
  leadId: string,
  tenantId: string,
): Promise<string> {
  const targetId = String(params.journeyId || "").trim();
  if (!targetId) return "startJourney:sin-journey";
  if (!tenantId) return "startJourney:sin-tenant";
  const target = await loadJourney(tenantId, targetId);
  if (!target || target.status !== "active") return "startJourney:inactivo";
  const existing = await enrollmentFor(targetId, leadId);
  if (existing && (existing.status === "active" || !target.reenroll))
    return "startJourney:ya-inscrito";
  await createEnrollment(target, leadId, Date.now());
  return `startJourney:${targetId}`;
}

/** Marca el recorrido como convertido para el lead (meta alcanzada por nodo). */
async function markGoal(leadId: string): Promise<string> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET journeyConverted = :c, journeyConvertedAt = :a, updatedAt = :u",
        ExpressionAttributeValues: {
          ":c": { BOOL: true },
          ":a": { S: new Date().toISOString() },
          ":u": { S: new Date().toISOString() },
        },
      }),
    );
    return "goal:converted";
  } catch (e) {
    return `goal:err:${e instanceof Error ? e.message : e}`;
  }
}

/**
 * enqueueDialer — encola una llamada saliente automática en la cola de callbacks
 * (channel="voice" + actionType="auto-dispatch"), la misma que consume el
 * callback-dispatcher. Si el nodo trae campaignId, la liga a esa campaña (que
 * rutea por su flow de Connect). Reemplaza el viejo no-op "pending-wire".
 */
async function enqueueDialer(
  params: Record<string, unknown>,
  lead: LeadRec,
  leadId: string,
): Promise<string> {
  const phone = String(lead.phone || "");
  if (!phone) return "enqueueDialer:sin-telefono";
  const campaignId = String(params.campaignId || "");
  // Con campaña: usa SU flow de Connect + su número saliente → la llamada entra a
  // la COLA de esa campaña y la atienden SUS agentes. Sin campaña (o si falla la
  // lectura), el dispatcher cae a su flow por defecto. Best-effort (fail-open).
  let contactFlowId = "";
  let sourcePhoneNumber = "";
  if (campaignId) {
    try {
      const c = await dynamo.send(
        new GetItemCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId: { S: campaignId } } }),
      );
      if (c.Item) {
        const camp = unmarshall(c.Item) as { contactFlowId?: string; sourcePhoneNumber?: string };
        contactFlowId = String(camp.contactFlowId || "");
        sourcePhoneNumber = String(camp.sourcePhoneNumber || "");
      }
    } catch {
      /* cae al flow por defecto del dispatcher */
    }
  }
  const nowIso = new Date().toISOString();
  const item = {
    callbackId: randomUUID(),
    phone,
    customerName: String(lead.name || lead.fullName || ""),
    scheduledAt: nowIso, // el dispatcher lo toma en su próximo tick
    assignedAgentUserId: "", // sin agente fijo: la cola de la campaña/flow rutea
    notes: "Journey: llamada automática",
    channel: "voice",
    actionType: "auto-dispatch",
    campaignId,
    contactFlowId, // ← el dispatcher enruta por este flow (cola de la campaña)
    sourcePhoneNumber, // ← número saliente de la campaña (o default)
    customAttributes: JSON.stringify({ source: "journey", leadId, campaignId }),
    status: "SCHEDULED",
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: CALLBACKS_TABLE,
        Item: marshall(item, { removeUndefinedValues: true }),
      }),
    );
    return contactFlowId ? "enqueueDialer:queued:campaign" : "enqueueDialer:queued";
  } catch (e) {
    return `enqueueDialer:err:${e instanceof Error ? e.message : e}`;
  }
}

/** ¿El lead ya cumplió la meta del journey? (stageId directo, o pertenencia a un segmento). */
async function leadMeetsGoal(j: JourneyDef, lead: LeadRec, tenantId: string): Promise<boolean> {
  const goal = j.goal;
  if (!goal) return false;
  if (goal.stageId && String(lead.stageId || "") === goal.stageId) return true;
  if (goal.segmentId) {
    const seg = await loadSegmentRules(tenantId, goal.segmentId);
    if (seg) return evaluateLeadFilter(lead, seg.rules, seg.match);
  }
  return false;
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
      const v = await evaluateSend(dynamo, { phone, channel: "email", tenantId });
      if (!v.allowed) return `send:email:suppressed:${v.blockedBy}`;
    } catch {
      /* gate best-effort */
    }
  }
  const subject = String(params.subject || "ARIA");
  const bodyText = String(params.body || "");
  const brandEmailHtml = (bodyHtml: string) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e9f0;border-radius:12px;overflow:hidden">` +
    `<div style="background:linear-gradient(135deg,#2c5698,#158a8c);padding:16px 22px"><span style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:-0.02em">ARIA</span><span style="color:rgba(255,255,255,0.72);font-size:11px;margin-left:7px">by Novasys</span></div>` +
    `<div style="padding:22px;color:#141c2b;font-size:14px;line-height:1.62">${bodyHtml}</div>` +
    `<div style="padding:12px 22px;background:#fbfaf9;border-top:1px solid #e7e9f0;color:#7c879e;font-size:11px">Enviado por ARIA · by Novasys</div>` +
    `</div>`;
  const baseHtml = brandEmailHtml(bodyText.replace(/\n/g, "<br>"));

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
        // Meta: si el lead ya convirtió, sale del journey (mide conversión del recorrido).
        if (await leadMeetsGoal(journey, lead, tenantId)) {
          await markEnrollment(enr, enr.currentNodeId, nowIso, "done", "meta alcanzada ✓");
          advanced++;
          continue;
        }
        // "Esperar respuesta": el PLAZO (timeout) lo maneja el runner con waitUntil.
        // Si el lead cumplió → planAdvance lo lleva por "met"; si venció el plazo →
        // forzamos la rama "timeout"; si sigue esperando, guardamos el deadline.
        const curNode = journey.nodes.find((n) => n.id === enr.currentNodeId);
        let waitUntil: string | null = null;
        if (curNode?.kind === "wait_event") {
          const rules = (curNode.params?.rules as FilterRule[]) || [];
          const match = (curNode.params?.match as "all" | "any") || "all";
          const met = rules.length > 0 && evaluateLeadFilter(lead, rules, match);
          if (!met) {
            const deadline =
              enr.waitUntil ||
              new Date(nowMs + (Number(curNode.params?.days) || 3) * 86_400_000).toISOString();
            if (Date.parse(deadline) <= nowMs) {
              const to = journey.edges.find((e) => e.from === curNode.id && e.on === "timeout")?.to;
              if (to) enr.currentNodeId = to; // venció → salir por "No a tiempo"
            } else {
              waitUntil = deadline; // sigue esperando
            }
          }
        }
        const plan = planAdvance(journey, enr.currentNodeId, lead, nowMs);
        // Horario de silencio: si el plan enviaría algo, posponer a la próxima ventana (no lo descarta).
        if (plan.effects.some((e) => e.type === "send")) {
          const resume = quietHoursResume(nowMs);
          if (resume) {
            await markEnrollment(enr, enr.currentNodeId, resume, "active", "pospuesto por horario");
            continue;
          }
        }
        // Idempotencia: no reenviar un send que este enrollment ya ejecutó (tick redelivered).
        const already = (enr as { sent?: string[] }).sent;
        const sent = new Set<string>(Array.isArray(already) ? already : []);
        const notes: string[] = [];
        for (const eff of plan.effects) {
          if (eff.type === "send" && sent.has(eff.nodeId)) {
            notes.push("send:dedup");
            continue;
          }
          const note = await runEffect(eff, enr.leadId, lead, tenantId, enr.journeyId);
          notes.push(note);
          if (eff.type === "send" && note.includes(":sent")) sent.add(eff.nodeId);
        }
        await markEnrollment(
          enr,
          plan.nextNodeId,
          plan.nextRunAt,
          plan.done ? "done" : "active",
          notes.join(" · "),
          [...sent],
          waitUntil,
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
  sent?: string[],
  waitUntil?: string | null,
): Promise<void> {
  const hist = Array.isArray(enr.history) ? enr.history : [];
  hist.push({ node: nodeId, at: new Date().toISOString(), ...(note ? { note } : {}) } as never);
  const names: Record<string, string> = { "#st": "status" };
  const values: Record<string, unknown> = {
    ":n": nodeId,
    ":r": nextRunAt,
    ":s": status,
    ":h": hist.slice(-50),
  };
  let expr = "SET currentNodeId = :n, nextRunAt = :r, #st = :s, history = :h";
  if (sent) {
    names["#snt"] = "sent";
    values[":snt"] = sent.slice(-100);
    expr += ", #snt = :snt";
  }
  // waitUntil: string → guarda el plazo del "Esperar respuesta"; null → lo borra.
  let removeExpr = "";
  if (typeof waitUntil === "string") {
    values[":wu"] = waitUntil;
    expr += ", waitUntil = :wu";
  } else if (waitUntil === null) {
    removeExpr = " REMOVE waitUntil";
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: ENROLLMENTS_TABLE,
      Key: { journeyId: { S: enr.journeyId }, leadId: { S: enr.leadId } },
      UpdateExpression: expr + removeExpr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
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
