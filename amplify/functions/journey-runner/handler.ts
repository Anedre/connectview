import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { planAdvance, type JourneyDef, type Enrollment } from "../_shared/journeys";
import { appendLeadHistory, setActiveDynamo, stageIdToLabel } from "../_shared/leadSync";
import { evaluateSend } from "../_shared/suppression";

/**
 * journey-runner — el MOTOR de journeys (Fase 3 · 3A). EventBridge lo dispara
 * cada 5 min: toma los enrollments ACTIVOS cuyo `nextRunAt` venció, avanza cada
 * uno con `planAdvance` (lógica pura de _shared/journeys) y ejecuta los efectos
 * (mover etapa, webhook, enviar, encolar dialer) con los libs existentes; después
 * persiste el nuevo estado. Reentrante e idempotente.
 *
 * v1 (3A-core): efectos moveStage + webhook REALES; send + enqueueDialer se
 * REGISTRAN en el history del enrollment (el wiring real de los senders/dialer =
 * 3A.2, reusa send-whatsapp-template + el dialer priorizado por score de 2B).
 * Procesa la tabla pooled (tenant demo). Multi-tenant con assume-role = follow-up.
 */
const dynamo = new DynamoDBClient({});
const JOURNEYS_TABLE = process.env.JOURNEYS_TABLE || "connectview-journeys";
const ENROLLMENTS_TABLE =
  process.env.JOURNEY_ENROLLMENTS_TABLE || "connectview-journey-enrollments";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";

async function loadJourney(tenantId: string, journeyId: string): Promise<JourneyDef | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: JOURNEYS_TABLE,
      Key: { tenantId: { S: tenantId }, journeyId: { S: journeyId } },
    }),
  );
  return r.Item ? (unmarshall(r.Item) as JourneyDef) : null;
}

async function loadLead(leadId: string): Promise<Record<string, unknown> | null> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } }),
  );
  return r.Item ? (unmarshall(r.Item) as Record<string, unknown>) : null;
}

/** Ejecuta un efecto. moveStage/webhook reales; send/enqueueDialer registrados. */
async function runEffect(
  effect: { type: string; action?: string; channel?: string; params: Record<string, unknown> },
  leadId: string,
  lead: Record<string, unknown>,
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
    // Gate de supresión (real) + registro. El envío real del template/email se
    // cablea en 3A.2 (reusa send-whatsapp-template + el mailer). Aquí probamos que
    // el journey NO le manda a un suprimido.
    const phone = String(lead.phone || "");
    const channel = effect.channel || "whatsapp";
    try {
      const v = await evaluateSend(dynamo, {
        phone,
        channel: channel === "email" ? "email" : "whatsapp",
      });
      return v.allowed
        ? `send:${channel}:allowed(pending-wire)`
        : `send:${channel}:suppressed:${v.blockedBy}`;
    } catch {
      return `send:${channel}:gate-error`;
    }
  }

  if (effect.type === "action" && effect.action === "enqueueDialer") {
    return "enqueueDialer:recorded(pending-wire)";
  }

  return `${effect.type}:noop`;
}

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
        // El tenant vive en el journey; el enrollment guarda journeyId. Buscamos el
        // journey escaneando por journeyId (v1 pooled) — o el enrollment trae tenantId.
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
          notes.push(await runEffect(eff, enr.leadId, lead));
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
  const res = await processDueEnrollments(nowMs);
  console.log(
    `[journey-runner] due=${res.processed} advanced=${res.advanced} @${new Date(nowMs).toISOString()}`,
  );
  return { statusCode: 200, body: JSON.stringify(res) };
};
