/**
 * seed-demo-agents.mjs — SIEMBRA DE DEMO (one-shot).
 *
 * Atribuye a cada lead demo de connectview-leads un agente REAL del equipo de
 * Connect (los que aparecen en Reportes → Operación → Rendimiento de agente),
 * para que el tab Pipeline muestre nombres en la columna Agente y en el panel
 * "Rendimiento por agente". Escribe SOLO el campo `assignedAgent` vía UpdateItem
 * directo (NO usa el endpoint manage-leads, que dispararía push a Salesforce +
 * eventos de history por cada lead). NO toca updatedAt (para no resetear el
 * cálculo de "leads enfriándose").
 *
 * Reparto ponderado por volumen de contactos de cada agente, determinístico por
 * leadId (re-correr = mismo resultado). El reporte usa `typ?.agent ||
 * assignedAgent`, así que los leads sin agente en su evento de tipificación
 * caen a este assignedAgent.
 *
 * Uso:  node scripts/seed-demo-agents.mjs [--dry]
 */
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const DRY = process.argv.includes("--dry");
const TABLE = "connectview-leads";
const ddb = new DynamoDBClient({ region: "us-east-1" });

// Agentes reales de Connect (username tal cual se ve en Operación), ponderados
// por su volumen de contactos → Andre-Alata lidera, cola con los demás.
const WEIGHTED = [
  ["Andre-Alata", 5],
  ["carloscl", 2],
  ["Yubirytl", 2],
  ["gisela.vega", 1],
  ["patricia.fernandez", 1],
  ["pfernandezr", 1],
];
const POOL = WEIGHTED.flatMap(([name, w]) => Array(w).fill(name));

// Hash determinístico (djb2-ish) → índice estable en el pool por leadId.
function pick(leadId) {
  let h = 0;
  for (let i = 0; i < leadId.length; i++) h = (h * 31 + leadId.charCodeAt(i)) >>> 0;
  return POOL[h % POOL.length];
}

// 1. Traer todos los leads.
const leads = [];
let ExclusiveStartKey;
do {
  const r = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
  leads.push(...(r.Items || []));
  ExclusiveStartKey = r.LastEvaluatedKey;
} while (ExclusiveStartKey);

// 2. Asignar + escribir.
const dist = {};
const tenants = new Set();
let written = 0;
let historyFixed = 0;
for (const raw of leads) {
  const lead = unmarshall(raw);
  const leadId = lead.leadId;
  if (!leadId) continue;
  tenants.add(lead.tenantId || "(sin tenant)");
  const agent = pick(leadId);
  dist[agent] = (dist[agent] || 0) + 1;

  // El reporte usa `typ?.agent || assignedAgent`: si un evento de tipificación
  // trae agent="agente" (cuenta QA) o vacío, GANA sobre assignedAgent y muestra
  // ese valor feo. Alineamos el agente DENTRO del history al agente asignado.
  let history = Array.isArray(lead.history) ? lead.history : null;
  let touchedHistory = false;
  if (history) {
    history = history.map((ev) => {
      if (ev && typeof ev === "object" && (!ev.agent || ev.agent === "agente")) {
        // Solo estampa en eventos de gestión/tipificación (los que el reporte lee).
        if (ev.stageLabel || ev.type === "stage_change" || ev.type === "gestion") {
          touchedHistory = true;
          return { ...ev, agent };
        }
      }
      return ev;
    });
    if (touchedHistory) historyFixed++;
  }

  if (!DRY) {
    const expr = touchedHistory ? "SET assignedAgent = :a, #h = :h" : "SET assignedAgent = :a";
    const vals = { ":a": agent };
    if (touchedHistory) vals[":h"] = history;
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: expr,
        ...(touchedHistory ? { ExpressionAttributeNames: { "#h": "history" } } : {}),
        ExpressionAttributeValues: marshall(vals, { removeUndefinedValues: true }),
      }),
    );
  }
  written++;
}

console.log(DRY ? "— DRY RUN (sin escribir) —" : "— ESCRITO —");
console.log("leads:", leads.length, "| actualizados:", written, "| history alineado:", historyFixed);
console.log("tenants presentes:", [...tenants]);
console.log("distribución de agentes:", dist);
