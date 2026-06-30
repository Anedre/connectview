import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

/**
 * get-bot-report — Reporte del Agente IA (Pilar 9 · Fase B). Agrega los registros
 * `conv#` que el bot-runtime persiste al terminar cada conversación de agente
 * (Pilar 8 · logConversation): cuántas resuelve solo vs deriva a un humano, por
 * qué deriva (motivo), confianza promedio, fuentes más citadas y herramientas más
 * usadas. Es un diferenciador frente a Chattigo (que no tiene agente conversacional).
 *
 * BYO Data Plane: resuelve la tabla del tenant (connectview-ai-conversations, donde
 * el runtime escribe los conv# — OJO: no es connectview-bots). Authorization Bearer
 * idToken obligatorio (sin token → blockedDynamoClient → vacío).
 *
 * GET ?days=30 → { report }
 */
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
// bot-runtime escribe los conv# en connectview-ai-conversations (no connectview-bots).
const TABLE = process.env.CONV_TABLE || "connectview-ai-conversations";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

interface Conv {
  recType?: string;
  agentName?: string;
  source?: string;
  outcome?: string;
  turns?: number;
  toolsUsed?: string[];
  toolCalls?: number;
  confidenceAvg?: number | null;
  citations?: string[];
  handoffReason?: string | null;
  lastUserText?: string;
  createdAt?: string;
}

const HANDOFF_LABELS: Record<string, string> = {
  low_confidence: "Baja confianza",
  tool_budget: "Límite de acciones",
  max_turns: "Máx. de turnos",
  ai_error: "Error de IA",
  agent: "Decisión del agente",
};
const TOOL_LABELS: Record<string, string> = {
  book_appointment: "Agendó cita",
  upsert_lead: "Creó/actualizó lead",
  lookup_customer: "Buscó cliente",
  send_whatsapp_template: "Envió plantilla",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  const params = event.queryStringParameters || {};
  const days = Math.min(365, Math.max(1, Number(params.days) || 30));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const convs: Conv[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }),
      );
      for (const it of res.Items || []) {
        const u = unmarshall(it) as Conv;
        if (u.recType !== "conversation") continue;
        if (u.createdAt && new Date(u.createdAt).getTime() < cutoff) continue;
        convs.push(u);
      }
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    const total = convs.length;
    // "Derivada" = tiene motivo de derivación; si no, el agente la resolvió solo.
    const derived = convs.filter((c) => !!c.handoffReason);
    const derivedCount = derived.length;
    const resolvedCount = total - derivedCount;

    const byReasonMap: Record<string, number> = {};
    for (const c of derived) {
      const r = c.handoffReason || "agent";
      byReasonMap[r] = (byReasonMap[r] || 0) + 1;
    }
    const byReason = Object.entries(byReasonMap)
      .map(([reason, count]) => ({ reason, label: HANDOFF_LABELS[reason] || reason, count }))
      .sort((a, b) => b.count - a.count);

    const confs = convs
      .map((c) => c.confidenceAvg)
      .filter((n): n is number => typeof n === "number");
    const avgConfidence = confs.length
      ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length)
      : null;
    const turnsArr = convs.map((c) => c.turns || 0);
    const avgTurns = total
      ? Math.round((turnsArr.reduce((a, b) => a + b, 0) / total) * 10) / 10
      : 0;
    const totalToolCalls = convs.reduce((a, c) => a + (c.toolCalls || 0), 0);

    const toolMap: Record<string, number> = {};
    for (const c of convs) for (const t of c.toolsUsed || []) toolMap[t] = (toolMap[t] || 0) + 1;
    const toolUsage = Object.entries(toolMap)
      .map(([tool, count]) => ({ tool, label: TOOL_LABELS[tool] || tool, count }))
      .sort((a, b) => b.count - a.count);

    const citeMap: Record<string, number> = {};
    for (const c of convs)
      for (const lab of c.citations || []) citeMap[lab] = (citeMap[lab] || 0) + 1;
    const topCitations = Object.entries(citeMap)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const recent = convs
      .slice()
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 12)
      .map((c) => ({
        agentName: c.agentName || "Agente IA",
        outcome: c.handoffReason ? "handoff" : "resolved",
        handoffReason: c.handoffReason || null,
        handoffLabel: c.handoffReason ? HANDOFF_LABELS[c.handoffReason] || c.handoffReason : null,
        turns: c.turns || 0,
        confidenceAvg: typeof c.confidenceAvg === "number" ? c.confidenceAvg : null,
        citations: Array.isArray(c.citations) ? c.citations.slice(0, 4) : [],
        lastUserText: (c.lastUserText || "").slice(0, 120),
        createdAt: c.createdAt || null,
      }));

    return ok({
      report: {
        windowDays: days,
        total,
        resolved: resolvedCount,
        handoff: derivedCount,
        resolveRate: total ? resolvedCount / total : 0,
        byReason,
        avgConfidence,
        avgTurns,
        totalToolCalls,
        toolUsage,
        topCitations,
        recent,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("get-bot-report error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
