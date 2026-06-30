import type { Handler } from "aws-lambda";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo, resolveBedrock } from "../_shared/tenantConnect";

/**
 * bot-runtime — the engine that "runs" a visual chat-flow bot (roadmap #16).
 * Channel-agnostic and STATELESS: it receives the bot graph + the current
 * conversation state + the latest user input, advances through the graph
 * (emitting outbound messages) until it needs input again or terminates, and
 * returns the messages + the new state. The same engine powers the in-builder
 * "Probar bot" simulator and (in production) a Connect contact flow that calls
 * this Lambda turn-by-turn.
 *
 * The `ai_agent` step calls Amazon Bedrock with the model chosen in the
 * builder (falling back to a known-available Claude if that model isn't
 * enabled), so the digital agent actually converses.
 *
 * POST { bot | botId, state?, input? } → { messages, state, awaiting, done, handoff?, modelUsed? }
 */
// BYO Bedrock: el bot corre en la cuenta del CLIENTE (su quota de Bedrock, sus
// modelos habilitados). `bedrock` se reasigna por request vía resolveBedrock —
// mismo patrón mutable que `dynamo`. El legacy (cuenta de Vox) es el fallback
// para Novasys o tenants que aún no conectaron su Connect/rol.
const legacyBedrock = new BedrockRuntimeClient({ maxAttempts: 3 });
let bedrock: BedrockRuntimeClient = legacyBedrock;
// BYO Data Plane (#46): tabla del tenant.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const BOTS_TABLE = process.env.BOTS_TABLE || "connectview-bots";
// Pilar 8 — fuentes de grounding (RAG) del agente.
const CATALOGS_TABLE = process.env.CATALOGS_TABLE || "connectview-catalogs";
const PROGRAMS_TABLE = process.env.PROGRAMS_TABLE || "connectview-programs";
const KB_TABLE = process.env.KB_TABLE || "connectview-knowledge-bases";
// Conversation logs go here. Defaults to the bots table (conv# items); set
// CONV_TABLE to a dedicated table to split them out — no code change needed.
const CONV_TABLE = process.env.CONV_TABLE || BOTS_TABLE;
const CORS = { "Content-Type": "application/json" };

// UI label → Bedrock model id. Unverified ids fall back to a known-available
// Claude so the simulator always answers.
const MODELS: Record<string, string> = {
  "Claude Opus 4.8 (Bedrock)": "us.anthropic.claude-opus-4-8-20250930-v1:0",
  "Claude Sonnet 4.6 (Bedrock)": "us.anthropic.claude-sonnet-4-6-20250930-v1:0",
  "Claude Haiku 4.5 (Bedrock)": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
};
const FALLBACK_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

interface Node {
  id: string;
  kind: string;
  data: Record<string, unknown>;
}
interface Edge {
  source: string;
  sourceHandle?: string | null;
  target: string;
}
interface Bot {
  botId?: string;
  nodes: Node[];
  edges: Edge[];
}
interface ChatMsg {
  role: "bot" | "user";
  text: string;
}
interface State {
  nodeId?: string;
  awaiting?: "text" | "choice" | null;
  vars: Record<string, string>;
  history: ChatMsg[];
  aiTurns?: number;
  toolsUsed?: string[];
  logged?: boolean;
}
interface OutMsg {
  kind: "bot" | "note";
  text: string;
  buttons?: { id: string; label: string }[];
  rows?: { id: string; title: string; description?: string }[];
  media?: { type: string; url: string; caption?: string };
}

const str = (v: unknown, d = ""): string => (typeof v === "string" && v ? v : d);

/** Reemplaza {{variable}} por su valor capturado (o deja el token si no existe). */
function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, name) => {
    const v = vars[String(name).trim()];
    return v != null && v !== "" ? v : `{{${String(name).trim()}}}`;
  });
}

function replyButtons(buttons: unknown): { id: string; label: string }[] {
  const arr = Array.isArray(buttons)
    ? (buttons as { id: string; label: string; type?: string }[])
    : [];
  return arr.filter((b) => !b.type || b.type === "reply");
}

async function loadBot(botId: string): Promise<Bot | null> {
  const res = await dynamo.send(
    new GetItemCommand({ TableName: BOTS_TABLE, Key: { botId: { S: botId } } }),
  );
  if (!res.Item) return null;
  return unmarshall(res.Item) as Bot;
}

async function invokeModel(modelId: string, system: string, user: string): Promise<string> {
  const resp = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
      }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(resp.body));
  return (parsed.content?.[0]?.text || "").trim();
}

/**
 * Pilar 8 — RAG: arma el bloque de conocimiento del agente cargando EN VIVO las
 * fuentes seleccionadas en el nodo (catálogos + programas + base de conocimiento)
 * y sumándolas al `knowledge` estático. Best-effort: si una fuente falla, se
 * saltea (el agente sigue con lo que tenga). Tablas chicas → se inyectan enteras.
 */
async function buildKnowledge(data: Record<string, unknown>): Promise<string> {
  const parts: string[] = [];
  const staticK = str(data.knowledge);
  if (staticK) parts.push(staticK);

  const catIds = Array.isArray(data.ragCatalogs) ? (data.ragCatalogs as string[]) : [];
  for (const id of catIds.slice(0, 6)) {
    try {
      const r = await dynamo.send(
        new GetItemCommand({ TableName: CATALOGS_TABLE, Key: { catalogId: { S: id } } }),
      );
      if (!r.Item) continue;
      const c = unmarshall(r.Item) as { name?: string; columns?: string[]; rows?: string[][] };
      const head = (c.columns || []).join(" | ");
      const body = (c.rows || [])
        .slice(0, 120)
        .map((row) => (Array.isArray(row) ? row.join(" | ") : ""))
        .join("\n");
      parts.push(`📋 Catálogo "${c.name || id}":\n${head}\n${body}`);
    } catch {
      /* fuente opcional */
    }
  }

  // Robusto ante "Sí"/"si"/true (y excluye "No"/""/false) — evita líos de encoding.
  const wantPrograms =
    !!data.ragPrograms && data.ragPrograms !== "No" && data.ragPrograms !== false;
  if (wantPrograms) {
    try {
      const r = await dynamo.send(new ScanCommand({ TableName: PROGRAMS_TABLE }));
      const active = (r.Items || [])
        .map(
          (it) =>
            unmarshall(it) as {
              name?: string;
              code?: string;
              faculty?: string;
              status?: string;
              description?: string;
            },
        )
        .filter((p) => p.status === "activo")
        .slice(0, 60);
      console.log(`[rag] programs: ${r.Items?.length || 0} total, ${active.length} activos`);
      if (active.length) {
        parts.push(
          "🎓 Programas activos:\n" +
            active
              .map(
                (p) =>
                  `- ${p.code || ""} · ${p.name || ""}${p.faculty ? ` (${p.faculty})` : ""}${p.description ? `: ${p.description}` : ""}`,
              )
              .join("\n"),
        );
      }
    } catch (e) {
      console.warn("[rag] programs scan falló:", e instanceof Error ? e.message : e);
    }
  }

  const kbId = str(data.ragKbId);
  if (kbId) {
    try {
      const r = await dynamo.send(
        new GetItemCommand({ TableName: KB_TABLE, Key: { kbId: { S: kbId } } }),
      );
      if (r.Item) {
        const kb = unmarshall(r.Item) as { name?: string; entries?: { q?: string; a?: string }[] };
        const faqs = (kb.entries || [])
          .slice(0, 80)
          .map((e) => `P: ${e.q}\nR: ${e.a}`)
          .join("\n\n");
        if (faqs) parts.push(`❓ Preguntas frecuentes "${kb.name || kbId}":\n${faqs}`);
      }
    } catch {
      /* fuente opcional */
    }
  }

  return parts.join("\n\n");
}

async function runAi(
  data: Record<string, unknown>,
  history: ChatMsg[],
): Promise<{ reply: string; status: "continue" | "resolved" | "handoff"; modelUsed: string }> {
  const objective = str(data.objective);
  const instructions = str(data.instructions);
  const knowledge = str(data.knowledge);
  const guardrails = str(data.guardrails);
  const handoffWhen = str(data.handoffWhen);
  const convo = history
    .map((h) => `${h.role === "user" ? "CLIENTE" : "BOT"}: ${h.text}`)
    .join("\n");

  const system =
    `Sos un asistente conversacional de atención al cliente. ${instructions}\n` +
    (objective ? `Tu objetivo: ${objective}\n` : "") +
    (knowledge
      ? `Base de conocimiento que podés usar para responder (no inventes fuera de esto):\n${knowledge}\n`
      : "") +
    (guardrails ? `Restricciones — NO hagas esto: ${guardrails}\n` : "") +
    (handoffWhen ? `Derivá a un humano si: ${handoffWhen}.\n` : "") +
    `Responde SIEMPRE en español, breve (1-3 oraciones), tono cordial.`;
  const user =
    `Conversación hasta ahora:\n${convo || "(aún no hay mensajes)"}\n\n` +
    `Generá el siguiente mensaje del BOT para avanzar hacia el objetivo. ` +
    `Responde SOLO un JSON válido: {"reply":"<tu mensaje>","status":"continue"|"resolved"|"handoff","confidence":<0-100>}. ` +
    `Usa "resolved" cuando ya lograste el objetivo, "handoff" si hay que pasar a un humano, si no "continue". ` +
    `"confidence" = qué tan seguro estás de tu respuesta (0=adivinando, 100=certeza).`;

  const chosen = MODELS[str(data.model)] || FALLBACK_MODEL;
  let raw = "";
  let modelUsed = chosen;
  try {
    raw = await invokeModel(chosen, system, user);
  } catch (e1) {
    const m1 = e1 instanceof Error ? `${e1.name}: ${e1.message}` : String(e1);
    try {
      raw = await invokeModel(FALLBACK_MODEL, system, user);
      modelUsed = FALLBACK_MODEL;
    } catch (e2) {
      const m2 = e2 instanceof Error ? `${e2.name}: ${e2.message}` : String(e2);
      console.error("bot-runtime AI invoke failed:", m1, "||", m2);
      return {
        reply: "Disculpá, no pude procesar eso ahora mismo. Te paso con un asesor.",
        status: "handoff",
        modelUsed: "none",
      };
    }
  }
  // Parse the JSON the model returned (tolerant: extract first {...}).
  let reply = raw;
  let status: "continue" | "resolved" | "handoff" = "continue";
  let confidence = 100;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      reply = str(j.reply, raw);
      if (j.status === "resolved" || j.status === "handoff") status = j.status;
      if (typeof j.confidence === "number") confidence = j.confidence;
    }
  } catch {
    /* keep raw as reply */
  }
  // Pilar 8 — human-in-the-loop por confianza: si el agente no está seguro y no
  // resolvió, escala a un humano (rama handoff).
  const threshold = Number(data.confidenceThreshold) || 0;
  if (status !== "resolved" && threshold > 0 && confidence < threshold) {
    status = "handoff";
  }
  return { reply, status, modelUsed };
}

/* ── Tool-using agent runtime (Claude function-calling) ───────────────
 * Maps an agent's enabled tool keys → a Claude tool schema + how to call the
 * real Lambda (by Function URL passed from the client in `toolEndpoints`, so
 * no new IAM/env is needed). Two control tools (handoff/resolve) drive the
 * agent's outlets. Falls back to the plain runAi path when no tools are set.
 */
const BOOK_DEF = {
  name: "book_appointment",
  description: "Agenda una cita para el cliente. Pedí teléfono y fecha/hora si no los tenés.",
  input_schema: {
    type: "object",
    properties: {
      customerPhone: { type: "string", description: "Telefono E.164, ej +51999000111" },
      customerName: { type: "string" },
      title: { type: "string", description: "Asunto de la cita" },
      whenISO: {
        type: "string",
        description: "Fecha y hora ISO 8601, ej 2026-06-10T15:00:00.000Z",
      },
      durationMin: { type: "number" },
      notes: { type: "string" },
    },
    required: ["customerPhone", "whenISO"],
  },
};
const LEAD_DEF = {
  name: "upsert_lead",
  description: "Crea o actualiza un lead en el CRM con los datos del cliente.",
  input_schema: {
    type: "object",
    properties: {
      phone: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      company: { type: "string" },
    },
    required: ["phone"],
  },
};
const LOOKUP_DEF = {
  name: "lookup_customer",
  description: "Busca el perfil e historial de un cliente por su telefono.",
  input_schema: { type: "object", properties: { phone: { type: "string" } }, required: ["phone"] },
};
const WA_DEF = {
  name: "send_whatsapp_template",
  description:
    "Envia una plantilla de WhatsApp aprobada al cliente. Usa SOLO un templateName que exista (no lo inventes). Si la plantilla tiene variables {{1}}, {{2}}…, completalas EN ORDEN en 'variables'.",
  input_schema: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Telefono E.164" },
      templateName: { type: "string" },
      language: { type: "string", description: "es o en" },
      variables: {
        type: "array",
        items: { type: "string" },
        description: "Valores ordenados que llenan {{1}}, {{2}}, … de la plantilla",
      },
    },
    required: ["phone", "templateName"],
  },
};

const IMPLEMENTED_TOOLS: Record<string, { endpointKey: string; def: object }> = {
  book_appointment: { endpointKey: "manageAppointment", def: BOOK_DEF },
  upsert_lead: { endpointKey: "manageLeads", def: LEAD_DEF },
  lookup_customer: { endpointKey: "lookupCustomerProfile", def: LOOKUP_DEF },
  send_whatsapp_template: { endpointKey: "sendWhatsAppTemplate", def: WA_DEF },
};

async function execTool(
  name: string,
  input: Record<string, unknown>,
  toolEndpoints: Record<string, string>,
  source: string,
): Promise<string> {
  const t = IMPLEMENTED_TOOLS[name];
  if (!t) return "Herramienta no disponible.";
  const url = toolEndpoints[t.endpointKey];
  if (!url) return "Herramienta no configurada en este entorno.";
  // Safety: never send a real WhatsApp message from the test playground.
  if (name === "send_whatsapp_template" && source === "playground") {
    return JSON.stringify({
      simulated: true,
      note: `(Prueba) En producción se enviaría la plantilla "${input.templateName}" a ${input.phone}. En el playground no se envía nada real.`,
    });
  }
  try {
    if (name === "lookup_customer") {
      const r = await fetch(url + "?phone=" + encodeURIComponent(String(input.phone || "")));
      return (await r.text()).slice(0, 1200) || `(status ${r.status})`;
    }
    const payload =
      name === "book_appointment"
        ? { ...input, channel: "agent-ia" }
        : name === "upsert_lead"
          ? { ...input, source: "Agente IA" }
          : input;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await r.text()).slice(0, 1200) || `(status ${r.status})`;
  } catch (e) {
    return "Error al ejecutar la herramienta: " + (e instanceof Error ? e.message : "desconocido");
  }
}

async function invokeWithTools(
  modelId: string,
  system: string,
  messages: Record<string, unknown>[],
  tools: Record<string, unknown>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const resp = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 700,
        system,
        tools,
        messages,
      }),
    }),
  );
  return JSON.parse(new TextDecoder().decode(resp.body));
}

async function runAiWithTools(
  data: Record<string, unknown>,
  history: ChatMsg[],
  toolEndpoints: Record<string, string>,
  source: string,
): Promise<{
  reply: string;
  status: "continue" | "resolved" | "handoff";
  modelUsed: string;
  toolNotes: string[];
}> {
  const enabled = (Array.isArray(data.tools) ? (data.tools as string[]) : []).filter(
    (k) => IMPLEMENTED_TOOLS[k],
  );
  const tools = [
    ...enabled.map((k) => IMPLEMENTED_TOOLS[k].def),
    {
      name: "handoff_to_human",
      description: "Deriva la conversación a un agente humano cuando corresponda.",
      input_schema: { type: "object", properties: { reason: { type: "string" } } },
    },
    {
      name: "resolve_conversation",
      description: "Marcá la conversación como resuelta cuando lograste el objetivo.",
      input_schema: { type: "object", properties: {} },
    },
  ];

  const objective = str(data.objective);
  const instructions = str(data.instructions);
  const knowledge = str(data.knowledge);
  const guardrails = str(data.guardrails);
  const handoffWhen = str(data.handoffWhen);
  const threshold = Number(data.confidenceThreshold) || 0;
  const confirmSensitive = data.confirmSensitive !== false && data.confirmSensitive !== "No"; // default true
  const system =
    `Sos un agente de atención al cliente que puede USAR HERRAMIENTAS para actuar, no solo conversar. ${instructions}\n` +
    (objective ? `Tu objetivo: ${objective}\n` : "") +
    (knowledge ? `Base de conocimiento (no inventes fuera de esto):\n${knowledge}\n` : "") +
    (guardrails ? `Restricciones — NO hagas esto: ${guardrails}\n` : "") +
    (handoffWhen ? `Llamá a handoff_to_human si: ${handoffWhen}.\n` : "") +
    (threshold > 0
      ? `Si tu confianza para resolver bien la consulta es baja (por debajo de ~${threshold}%), NO adivines: llamá a handoff_to_human.\n`
      : "") +
    (confirmSensitive
      ? `IMPORTANTE: antes de ejecutar acciones que envían algo o crean/modifican datos (send_whatsapp_template, book_appointment, upsert_lead), CONFIRMÁ con el cliente primero — resumí qué vas a hacer y esperá su "sí". Las consultas de solo lectura (lookup_customer) NO necesitan confirmación.\n`
      : "") +
    `Cuando te falte un dato para una herramienta (teléfono, fecha…), pedíselo al cliente primero. ` +
    `Llamá a resolve_conversation al completar el objetivo. Responde SIEMPRE en español, breve y cordial.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = history.map((h) => ({
    role: h.role === "user" ? "user" : "assistant",
    content: h.text,
  }));
  if (!messages.length || messages[0].role !== "user")
    messages.unshift({ role: "user", content: "Hola" });

  const chosen = MODELS[str(data.model)] || FALLBACK_MODEL;
  const toolNotes: string[] = [];
  let reply = "";
  let status: "continue" | "resolved" | "handoff" = "continue";
  let modelUsed = chosen;

  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = await invokeWithTools(chosen, system, messages, tools);
    } catch {
      try {
        parsed = await invokeWithTools(FALLBACK_MODEL, system, messages, tools);
        modelUsed = FALLBACK_MODEL;
      } catch {
        return {
          reply: "Disculpá, no pude procesar eso. Te paso con un asesor.",
          status: "handoff",
          modelUsed: "none",
          toolNotes,
        };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = Array.isArray(parsed.content) ? parsed.content : [];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (text) reply = text;
    const toolUses = content.filter((c) => c.type === "tool_use");
    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];
    let terminal: "resolved" | "handoff" | null = null;
    for (const tu of toolUses) {
      if (tu.name === "handoff_to_human") {
        terminal = "handoff";
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "ok" });
        toolNotes.push("👤 Derivar a un humano");
      } else if (tu.name === "resolve_conversation") {
        terminal = "resolved";
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "ok" });
      } else {
        const out = await execTool(tu.name, tu.input || {}, toolEndpoints, source);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
        toolNotes.push(`🔧 ${tu.name}`);
      }
    }
    messages.push({ role: "user", content: results });
    if (terminal) {
      status = terminal;
      break;
    }
  }
  if (!reply)
    reply = status === "handoff" ? "Te paso con un asesor." : "¿Algo más en lo que pueda ayudarte?";
  return { reply, status, modelUsed, toolNotes };
}

function daysOf(preset: string): string[] {
  if (/s[áa]bado/i.test(preset)) return ["mon", "tue", "wed", "thu", "fri", "sat"];
  if (/todos/i.test(preset)) return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return ["mon", "tue", "wed", "thu", "fri"];
}

/** ¿La hora actual (en la zona del paso) cae dentro del horario de atención? */
function isWithinHours(d: Record<string, unknown>): boolean {
  const tz = str(d.timezone, "America/Lima");
  const from = str(d.from, "09:00");
  const to = str(d.to, "18:00");
  const days = daysOf(str(d.daysPreset, "Lunes a viernes"));
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const wd = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase().slice(0, 3);
    let hh = parts.find((p) => p.type === "hour")?.value || "00";
    if (hh === "24") hh = "00";
    const mm = parts.find((p) => p.type === "minute")?.value || "00";
    const now = `${hh}:${mm}`;
    if (!days.includes(wd)) return false;
    return now >= from && now <= to;
  } catch {
    return true; // ante un timezone inválido, no bloquees el flujo
  }
}

function evalCond(data: Record<string, unknown>, vars: Record<string, string>): boolean {
  const v = (vars[str(data.variable)] || "").toLowerCase();
  const target = str(data.value).toLowerCase();
  switch (str(data.op, "equals")) {
    case "equals":
      return v === target;
    case "contains":
      return v.includes(target);
    case "exists":
      return v.length > 0;
    case "gt":
      return Number(v) > Number(target);
    case "lt":
      return Number(v) < Number(target);
    case "regex":
      try {
        return new RegExp(target, "i").test(v);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // BYO Data Plane (#46): tenant primero, fallback Vox. OJO: este Lambda es
  // hand-managed (deploy-lambda.mjs) — si quedó con _shared viejo, resolveDynamo
  // no resuelve el data-plane del tenant y el RAG vuelve vacío. Re-deployá tras
  // tocar tenantConnect/cognitoAuth.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    const body = JSON.parse(event.body || "{}");
    // BYO Bedrock: el playground (authed) trae el tenant en el JWT; una llamada
    // server-to-server desde el Contact Flow del cliente lo pasa en body.tenantId.
    ({ client: bedrock } = await resolveBedrock(event?.headers, legacyBedrock, body?.tenantId));
    let bot: Bot | null = body.bot && Array.isArray(body.bot.nodes) ? (body.bot as Bot) : null;
    if (!bot && body.botId) bot = await loadBot(String(body.botId));
    if (!bot)
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "bot or botId required" }),
      };

    const nodeMap = new Map<string, Node>(bot.nodes.map((n) => [n.id, n]));
    const edges = bot.edges || [];
    const nextFrom = (id: string, handle: string): Node | null => {
      const e = edges.find(
        (ed) =>
          ed.source === id &&
          ((ed.sourceHandle ?? "out") === handle ||
            (handle === "out" && (ed.sourceHandle == null || ed.sourceHandle === "out"))),
      );
      return e ? nodeMap.get(e.target) || null : null;
    };
    const labelOfOutlet = (node: Node, outletId: string): string => {
      if (outletId.startsWith("b:")) {
        const b = (node.data.buttons as { id: string; label: string }[] | undefined)?.find(
          (x) => `b:${x.id}` === outletId,
        );
        return b?.label || outletId;
      }
      if (outletId.startsWith("r:")) {
        const r = (node.data.rows as { id: string; title: string }[] | undefined)?.find(
          (x) => `r:${x.id}` === outletId,
        );
        return r?.title || outletId;
      }
      return outletId;
    };

    const state: State = body.state || { vars: {}, history: [] };
    state.vars = state.vars || {};
    state.history = state.history || [];
    const input = body.input || {};
    const toolEndpoints: Record<string, string> =
      body.toolEndpoints && typeof body.toolEndpoints === "object" ? body.toolEndpoints : {};
    const source: string = typeof body.source === "string" ? body.source : "channel";
    const messages: OutMsg[] = [];
    let modelUsed: string | undefined;

    let cur: Node | null;
    if (state.nodeId) {
      const node = nodeMap.get(state.nodeId) || null;
      cur = node;
      if (node) {
        if (node.kind === "ai_agent") {
          if (input.text) state.history.push({ role: "user", text: String(input.text) });
          // fall through: the advance loop re-runs the ai_agent node
        } else if (node.kind === "question") {
          const saveAs = str(node.data.saveAs);
          if (saveAs) state.vars[saveAs] = String(input.text || "");
          if (input.text) state.history.push({ role: "user", text: String(input.text) });
          cur = nextFrom(node.id, "out");
        } else if (node.kind === "message" || node.kind === "list") {
          if (input.choice) {
            state.history.push({ role: "user", text: labelOfOutlet(node, String(input.choice)) });
            cur = nextFrom(node.id, String(input.choice));
          } else {
            cur = nextFrom(node.id, "out");
          }
        }
      }
    } else {
      const start = bot.nodes.find((n) => n.kind === "start");
      cur = start ? nextFrom(start.id, "out") : null;
    }

    let aiTurns = state.aiTurns || 0;
    let guard = 0;
    while (cur && guard++ < 60) {
      const k = cur.kind;
      const d = cur.data || {};

      if (k === "message") {
        const text = fill(str(d.text), state.vars);
        const reply = replyButtons(d.buttons);
        const msg: OutMsg = { kind: "bot", text };
        if (reply.length > 0)
          msg.buttons = reply.map((b) => ({ id: `b:${b.id}`, label: b.label || "Botón" }));
        if (text) {
          messages.push(msg);
          state.history.push({ role: "bot", text });
        }
        if (reply.length > 0) {
          return done(false, "choice", cur.id);
        }
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "list") {
        const text = fill(str(d.body, str(d.header, "Elegí una opción:")), state.vars);
        const rows = Array.isArray(d.rows)
          ? (d.rows as { id: string; title: string; description?: string }[]).map((r) => ({
              id: `r:${r.id}`,
              title: r.title,
              description: r.description,
            }))
          : [];
        messages.push({ kind: "bot", text, rows });
        state.history.push({ role: "bot", text });
        return done(false, "choice", cur.id);
      }
      if (k === "question") {
        const text = fill(str(d.prompt), state.vars);
        messages.push({ kind: "bot", text });
        state.history.push({ role: "bot", text });
        return done(false, "text", cur.id);
      }
      if (k === "ai_agent") {
        // Pilar 8 — RAG: cargar las fuentes (catálogos/programas/FAQ) al prompt.
        d.knowledge = await buildKnowledge(d);
        const hasTools =
          Array.isArray(d.tools) &&
          (d.tools as string[]).some((t) => IMPLEMENTED_TOOLS[t]) &&
          Object.keys(toolEndpoints).length > 0;
        const ai = hasTools
          ? await runAiWithTools(d, state.history, toolEndpoints, source)
          : { ...(await runAi(d, state.history)), toolNotes: [] as string[] };
        modelUsed = ai.modelUsed;
        for (const n of ai.toolNotes) messages.push({ kind: "note", text: n });
        const usedNames = ai.toolNotes
          .filter((n) => n.startsWith("🔧"))
          .map((n) => n.replace("🔧", "").trim());
        if (usedNames.length) state.toolsUsed = [...(state.toolsUsed || []), ...usedNames];
        if (ai.reply) {
          messages.push({ kind: "bot", text: ai.reply });
          state.history.push({ role: "bot", text: ai.reply });
        }
        aiTurns += 1;
        const max = Number(d.maxTurns) || 6;
        if (ai.status === "resolved") {
          cur = nextFrom(cur.id, "resolved");
          continue;
        }
        if (ai.status === "handoff" || aiTurns >= max) {
          cur = nextFrom(cur.id, "handoff");
          continue;
        }
        return done(false, "text", cur.id);
      }
      if (k === "template") {
        const vars = Array.isArray(d.variables) ? (d.variables as string[]).filter(Boolean) : [];
        messages.push({
          kind: "note",
          text: `📄 Plantilla "${str(d.templateName, "?")}"${vars.length ? ` · ${vars.length} var.` : ""}`,
        });
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "set_field") {
        const val = fill(str(d.value), state.vars);
        if (str(d.field)) state.vars[str(d.field)] = val;
        messages.push({ kind: "note", text: `✏️ ${str(d.field, "campo")} = ${val || "—"}` });
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "delay") {
        messages.push({
          kind: "note",
          text: `⏱ Espera ${str(String(d.amount), "0")} ${str(d.unit, "min")}`,
        });
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "internal_note") {
        messages.push({ kind: "note", text: `📌 Nota interna: ${fill(str(d.text), state.vars)}` });
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "condition") {
        cur = nextFrom(cur.id, evalCond(d, state.vars) ? "true" : "false");
        continue;
      }
      if (k === "webhook") {
        messages.push({ kind: "note", text: `🔗 ${str(d.method, "POST")} ${str(d.url, "—")}` });
        cur = nextFrom(cur.id, "ok");
        continue;
      }
      if (k === "jump") {
        cur = str(d.targetNodeId) ? nodeMap.get(str(d.targetNodeId)) || null : null;
        continue;
      }
      if (k === "handoff") {
        messages.push({
          kind: "note",
          text: `👤 Derivando a un agente${str(d.queue) ? ` (cola ${str(d.queue)})` : ""}`,
        });
        await logConversation("handoff");
        return done(true);
      }
      if (k === "stop") {
        messages.push({ kind: "note", text: "🏁 Fin del bot" });
        await logConversation("resolved");
        return done(false, null, undefined, true);
      }
      if (k === "media") {
        const url = fill(str(d.url), state.vars);
        const caption = fill(str(d.caption), state.vars);
        const mtype = str(d.mediaType, "Imagen");
        if (url) {
          messages.push({ kind: "bot", text: caption, media: { type: mtype, url, caption } });
          state.history.push({ role: "bot", text: caption || `[${mtype}]` });
        } else {
          messages.push({ kind: "note", text: "🖼 (Falta la URL del archivo)" });
        }
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "business_hours") {
        const open = isWithinHours(d);
        messages.push({
          kind: "note",
          text: open ? "🟢 Dentro del horario de atención" : "🔴 Fuera del horario de atención",
        });
        cur = nextFrom(cur.id, open ? "open" : "closed");
        continue;
      }
      if (k === "appointment") {
        const apptUrl = toolEndpoints["manageAppointment"];
        const phone = fill(str(d.phone), state.vars);
        const whenISO = fill(str(d.whenISO), state.vars);
        const title = fill(str(d.title, "Cita"), state.vars);
        const durationMin = Number(d.durationMin) || 30;
        const ready = !!(phone && whenISO && !phone.startsWith("{{") && !whenISO.startsWith("{{"));
        let booked = false;
        let detail = "";
        if (source === "playground") {
          booked = ready;
          detail = ready
            ? "(Prueba) En producción se agendaría la cita."
            : "(Prueba) Falta teléfono o fecha válidos.";
        } else if (apptUrl && ready) {
          try {
            const r = await fetch(apptUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customerPhone: phone,
                whenISO,
                title,
                durationMin,
                channel: "bot",
              }),
            });
            booked = r.ok;
            detail = (await r.text()).slice(0, 160);
          } catch (e) {
            detail = e instanceof Error ? e.message : "error";
          }
        } else {
          detail = "Falta endpoint, teléfono o fecha.";
        }
        messages.push({
          kind: "note",
          text: booked ? `📅 Cita agendada: ${title}` : `📅 No se pudo agendar — ${detail}`,
        });
        cur = nextFrom(cur.id, booked ? "booked" : "failed");
        continue;
      }
      if (k === "payment") {
        const concept = fill(str(d.concept), state.vars);
        const amount = fill(str(d.amount), state.vars);
        const currency = str(d.currency, "PEN");
        const url = fill(str(d.url), state.vars);
        const text = `💳 ${concept || "Pago"}${amount ? ` — ${currency} ${amount}` : ""}\n${url ? `Pagá acá: ${url}` : "(Falta el link de pago)"}`;
        messages.push({ kind: "bot", text });
        state.history.push({ role: "bot", text });
        cur = nextFrom(cur.id, "out");
        continue;
      }
      if (k === "ab_split") {
        const pa = Number(d.percentA);
        const a = Math.random() * 100 < (Number.isFinite(pa) ? pa : 50);
        messages.push({ kind: "note", text: `🔀 División A/B → rama ${a ? "A" : "B"}` });
        cur = nextFrom(cur.id, a ? "a" : "b");
        continue;
      }
      if (k === "tag") {
        const tag = fill(str(d.tag), state.vars).trim();
        const action = str(d.action, "Agregar");
        const list = (state.vars["tags"] || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        let next = list;
        if (tag) {
          if (action === "Quitar") next = list.filter((t) => t !== tag);
          else if (!list.includes(tag)) next = [...list, tag];
        }
        state.vars["tags"] = next.join(", ");
        messages.push({
          kind: "note",
          text: `🏷 ${action === "Quitar" ? "Quité" : "Agregué"} «${tag}» → [${state.vars["tags"]}]`,
        });
        cur = nextFrom(cur.id, "out");
        continue;
      }
      // Unknown node — try to move on.
      cur = nextFrom(cur.id, "out");
    }
    await logConversation("ended");
    return done(false, null, undefined, true);

    // Persists a finished AGENT conversation (aiTurns>0) to connectview-bots as
    // a conv# item — powers the hub's conversation monitoring. Best-effort.
    async function logConversation(outcome: string) {
      if (state.logged || aiTurns < 1) return;
      state.logged = true;
      const lastUser = [...state.history].reverse().find((h) => h.role === "user");
      const rec = {
        botId: "conv#" + randomUUID(),
        recType: "conversation",
        agentBotId: (bot && bot.botId) || "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        agentName: typeof (body.bot as any)?.name === "string" ? (body.bot as any).name : "",
        source: typeof body.source === "string" ? body.source : "channel",
        outcome,
        turns: aiTurns,
        toolsUsed: state.toolsUsed || [],
        lastUserText: (lastUser?.text || "").slice(0, 200),
        history: (state.history || [])
          .slice(-24)
          .map((h) => ({ role: h.role, text: (h.text || "").slice(0, 600) })),
        createdAt: new Date().toISOString(),
      };
      try {
        await dynamo.send(
          new PutItemCommand({
            TableName: CONV_TABLE,
            Item: marshall(rec, { removeUndefinedValues: true }),
          }),
        );
      } catch (e) {
        console.error("logConversation failed", e);
      }
    }

    function done(
      handoff: boolean,
      awaiting: "text" | "choice" | null = null,
      nodeId?: string,
      stopped = false,
    ) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          messages,
          state: { ...state, nodeId, awaiting, aiTurns },
          awaiting,
          done: handoff || stopped || (!nodeId && !awaiting),
          handoff: handoff || undefined,
          modelUsed,
        }),
      };
    }
  } catch (err) {
    console.error("bot-runtime error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err instanceof Error ? err.message : "internal error" }),
    };
  }
};
