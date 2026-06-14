#!/usr/bin/env node
/**
 * gen-costos-xlsx.mjs — genera docs/costos/aria-costos.xlsx: la calculadora de
 * costos de ARIA con FÓRMULAS VIVAS (cambiás un parámetro y recalcula).
 *
 * Modelo: dos perspectivas (lo que paga ARIA por operar la plataforma, y lo que
 * paga el CLIENTE por usarla en su cuenta BYO) × 3 escenarios (Piloto / Pyme /
 * Enterprise). Precios unitarios editables (us-east-1, jun-2026).
 *
 * v3 (2026-06-07) — auditoría de cobertura de costos:
 *   • Precios corregidos vs AWS Price List API: telefonía Perú entrante
 *     (0.0022→0.0075) y saliente (0.025→0.0067); DynamoDB on-demand a la mitad
 *     (WRU 1.25→0.625, RRU 0.25→0.125, recorte AWS nov-2024); Contact Lens chat
 *     (0.0045→0.0015); Meta WhatsApp marketing (0.01→0.02, verificar Perú).
 *   • Customer Profiles re-modelado por perfil-utilizado/día ($0.005), no por
 *     "solicitud". Amazon Q in Connect re-modelado por minuto de voz ($0.008),
 *     no por "sugerencia plana".
 *   • Líneas NUEVAS que el sistema sí factura y faltaban: AMD (detección de
 *     contestador, por llamada saliente), WhatsApp EUM Social (transporte AWS),
 *     Connect Tasks, y egreso/reproducción de grabaciones desde S3.
 *   • Secretos/tenant 2→4 (SF + WhatsApp + OAuth SF…).
 *   • La licencia Salesforce sale del TOTAL AWS (se muestra aparte como externa).
 *   • Una sola definición de margen: 'PrecioARIA' y 'Resumen' comparten el opex;
 *     'Resumen' distingue margen de contribución (infra) vs margen bruto (incl opex).
 *
 * Regenerar:  node scripts/gen-costos-xlsx.mjs
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import * as echarts from "echarts";
import { mkdirSync } from "node:fs";
import { readFile, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "costos", "aria-costos.xlsx");
const OUT_HTML = join(ROOT, "docs", "costos", "udep-comparativa.html");
mkdirSync(dirname(OUT), { recursive: true });

const wb = new ExcelJS.Workbook();
wb.creator = "ARIA";
wb.created = new Date(0); // fijo (evita ruido en git)

const MONEY = '"$"#,##0.00';
const MONEY4 = '"$"#,##0.0000';
const NUM = "#,##0";
const PCT = "0.0%";
const COLF = { pil: "B", pyme: "C", ent: "D" };
const SCEN = ["pil", "pyme", "ent"]; // índices 0/1/2

// ═══════════════════════ DATOS NUMÉRICOS (fuente única) ═══════════════════════
// Estos objetos son la fuente de los valores por defecto que se inyectan en las
// celdas editables, y también los usa el verificador numérico al final (que
// imprime los totales para que el .md de costos reporte cifras fieles).

// Parámetros de uso por escenario [Piloto, Pyme, Enterprise].
const PARAMS = {
  agentes: [5, 25, 100],
  diasMes: [22, 22, 22],
  voiceContactsIn: [1500, 6000, 32000],
  voiceCallsOut: [800, 3500, 18000],
  nDIDs: [2, 5, 20],
  waMessages: [8000, 30000, 150000],
  waHsm: [1500, 6000, 30000],
  chats: [1000, 5000, 25000],
  emails: [500, 2500, 12000],
  botConversations: [1000, 4500, 22000],
  aiSummaries: [1500, 8000, 45000],
  connectTasks: [200, 1000, 5000],
  sfSeats: [2, 8, 30],
  clPctVoice: [0.5, 0.5, 0.5],
  recordingGB: [50, 300, 1500],
  recordingPlaybackGB: [5, 30, 150],
  lambdaInvocations: [2000000, 12000000, 55000000],
  ddbMetaOps: [1000000, 6000000, 28000000],
  ddbBizOps: [2000000, 12000000, 55000000],
  logsGB: [5, 25, 110],
  dataTransferGB: [20, 120, 600],
  amplifyFixed: [15, 40, 120],
};

// Precios unitarios (us-east-1, jun-2026). Ver columna 'fuente/nota' en la hoja.
const PRICES = {
  connectChat: 0.004,
  connectEmail: 0.05,
  connectWBM: 0.01,
  outboundCampaignCall: 0.005,
  connectTaskEach: 0.04,
  connectVoiceMin: 0.018,
  telephonyInMin: 0.0075,
  telephonyOutMin: 0.0067,
  didPerDay: 0.06,
  amdPerCall: 0.0085,
  contactLensMin: 0.015,
  contactLensChat: 0.0015,
  customerProfilesDaily: 0.005,
  qConnectVoiceMin: 0.008,
  eumSocialMsg: 0.005,
  metaWhatsAppMsg: 0.02,
  bedrockHaikuIn: 0.0008,
  bedrockHaikuOut: 0.004,
  bedrockSonnetIn: 0.003,
  bedrockSonnetOut: 0.015,
  lambdaPerReq: 0.2,
  lambdaGBs: 0.0000166667,
  ddbWRU: 0.625,
  ddbRRU: 0.125,
  s3Storage: 0.023,
  s3Put: 0.005,
  cognitoMAU: 0.015,
  secretsMonth: 0.4,
  cwLogsGB: 0.5,
  dataTransferGB: 0.09,
  sfSeatMonth: 100,
};

// Supuestos de cálculo.
const ASSUME = {
  voiceMinIn: 5,
  voiceMinOut: 3,
  qPctVoice: 0.3,
  botTurns: 4,
  tokInBot: 1200,
  tokOutBot: 350,
  tokInSum: 2500,
  tokOutSum: 250,
  lambdaGBsInv: 0.075,
  ddbWriteFrac: 0.3,
  secretsTenant: 4,
};

// Opex por agente (soporte, dev, ventas, overhead) — editable, baja con la escala.
const OPEX = [12, 8, 6];
// Tarifa de suscripción ARIA por agente — editable (punto entre piso y techo).
const TARIFA = [45, 39, 29];

// ═══════════════════════ UDEP — FACTURA REAL (caso real, 1 mes) ═══════════════════════
// Datos reales de la factura AWS de la instancia Amazon Connect de la UDEP (us-east-1,
// 1 mes). Fuente: desglose de facturación AWS entregado por la UDEP. Se guarda acá para
// que quede en el repo (el .docx vino en temp) y para alimentar la hoja 'UDEP (real)'.
//   group: 'core'      = contact center que se mantiene en AWS (lo paga el cliente, BYO)
//          'analytics' = stack de analítica nativo (QuickSight/Kinesis/OpenSearch/Athena)
//                        que el dashboard de ARIA REEMPLAZA → sale de la factura AWS
//          'zero'      = sin cargo (free tier / sin uso)
// Validaciones de precio (coinciden EXACTO con la hoja 'Precios'): voz $0.018/min,
// chat $0.004/msg, Contact Lens voz $0.015/min y chat $0.0015/msg, DynamoDB lectura
// $0.125/M y escritura $0.625/M, S3 $0.023/GB y PUT $0.005/1k, secreto $0.40.
// Telefonía: $0 en AWS (ni un line-item) → la UDEP usa BYOC / troncal SIP propia.
const UDEP = {
  lines: [
    { k: "vozIn",   label: "Amazon Connect — voz (end-customer-mins)",            usd: 161.20, group: "core",      detail: "8.955,65 min × $0.018/min" },
    { k: "qs",      label: "QuickSight (3 autores + 1 lector)",                   usd: 75.00,  group: "analytics", detail: "licencias por asiento ($24 + $3)" },
    { k: "cl",      label: "Contact Lens (voz 3.432 min + chat 260 msg)",         usd: 51.88,  group: "core",      detail: "$0.015/min voz · $0.0015/msg chat" },
    { k: "ddb",     label: "DynamoDB (306,9M lecturas / 298k escrituras)",        usd: 39.20,  group: "core",      detail: "lectura-dominante (0,1% escritura)" },
    { k: "kinesis", label: "Kinesis (1 stream on-demand 24/7)",                   usd: 29.76,  group: "analytics", detail: "744 h × $0.04" },
    { k: "os",      label: "OpenSearch (1× t2.small.search 24/7)",                usd: 28.13,  group: "analytics", detail: "744 h × $0.036 + 10 GB" },
    { k: "s3",      label: "S3 — grabaciones (~1 TB)",                            usd: 23.82,  group: "core",      detail: "storage + PUT/GET" },
    { k: "lambda",  label: "Lambda",                                              usd: 8.68,   group: "core",      detail: "515k GB-s · 422k invocaciones" },
    { k: "chat",    label: "Amazon Connect — chat",                               usd: 3.08,   group: "core",      detail: "770 msgs × $0.004" },
    { k: "athena",  label: "Athena",                                              usd: 1.67,   group: "analytics", detail: "0,333 TB × $5/TB" },
    { k: "kms",     label: "Key Management Service (KMS)",                        usd: 1.57,   group: "core",      detail: "1 key + 191k requests" },
    { k: "cw",      label: "CloudWatch",                                          usd: 1.16,   group: "core",      detail: "8 alarmas + ~0,5 GB logs" },
    { k: "secrets", label: "Secrets Manager",                                     usd: 0.80,   group: "core",      detail: "2 secretos × $0.40" },
    { k: "apigw",   label: "API Gateway",                                         usd: 0.73,   group: "core",      detail: "~227k requests" },
    { k: "dt",      label: "Data Transfer",                                       usd: 0.20,   group: "core",      detail: "egreso mínimo" },
    { k: "ssm",     label: "Systems Manager",                                     usd: 0.05,   group: "core",      detail: "1 parámetro avanzado" },
    { k: "otros",   label: "Otros (Customer Profiles, Amplify, SNS, Backup, Glue)", usd: 0.00, group: "zero",      detail: "free tier / sin cargo" },
  ],
  agentes: 4,      // escala estimada: 3 autores + 1 lector QuickSight; voz ≈ 149 h/mes
  tarifaAria: 45,  // tarifa piloto ARIA por agente (editable en la hoja)
};
const UDEP_SHEET = "UDEP (real)";

// ───────────────────────── helpers de estilo ─────────────────────────
const HEAD = { bold: true, color: { argb: "FFFFFFFF" } };
const HEADFILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
const SUBFILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5EDFF" } };
const TOTFILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
const EXTFILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E8FF" } };

function titleRow(ws, text, span = 5) {
  const r = ws.addRow([text]);
  r.font = { bold: true, size: 14 };
  ws.mergeCells(r.number, 1, r.number, span);
  ws.addRow([]);
  return r;
}
function headerRow(ws, cells) {
  const r = ws.addRow(cells);
  r.eachCell((c) => {
    c.font = HEAD;
    c.fill = HEADFILL;
    c.alignment = { horizontal: "center" };
  });
  r.getCell(1).alignment = { horizontal: "left" };
  return r;
}

// ============================================================ 1) PARÁMETROS
const ws1 = wb.addWorksheet("Parametros", { views: [{ state: "frozen", ySplit: 3 }] });
ws1.columns = [{ width: 48 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 30 }];
titleRow(ws1, "Parámetros de uso (editables) — un volumen por escenario");
headerRow(ws1, ["Parámetro", "Piloto", "Pyme", "Enterprise", "Unidad / nota"]);

const P = {}; // key -> row number
function param(key, label, unit, fmt = NUM) {
  const [pil, pyme, ent] = PARAMS[key];
  const r = ws1.addRow([label, pil, pyme, ent, unit]);
  for (const col of ["B", "C", "D"]) {
    r.getCell(col).numFmt = fmt;
    r.getCell(col).fill = SUBFILL;
  }
  P[key] = r.number;
}
param("agentes", "Agentes (en operación)", "agentes");
param("diasMes", "Días operativos al mes", "días");
// Volúmenes de llamadas realistas: ~15–23 llamadas por agente por día hábil
// (un agente omnicanal no está 8 h al teléfono: también atiende chat/WhatsApp/email).
param("voiceContactsIn", "Llamadas de voz ENTRANTES / mes", "llamadas");
param("voiceCallsOut", "Llamadas de voz SALIENTES (campañas) / mes", "llamadas");
param("nDIDs", "Números telefónicos (DID) activos", "números");
param("waMessages", "Mensajes WhatsApp / mes (entrada + salida)", "mensajes");
param("waHsm", "Plantillas WhatsApp marketing (HSM) / mes", "mensajes Meta");
param("chats", "Chats web / mes", "mensajes");
param("emails", "Emails gestionados / mes", "mensajes");
param("botConversations", "Conversaciones de bot/Agente IA / mes", "conversaciones");
param("aiSummaries", "Resúmenes IA (Bedrock) / mes", "invocaciones");
param("connectTasks", "Tareas de Connect (Tasks) / mes", "tareas");
param("sfSeats", "Licencias Salesforce (usuarios) — EXTERNO, opcional", "usuarios SF (0 si no usa)");
param("clPctVoice", "% de interacciones con Contact Lens (voz y chat)", "0–1 (proporción)", "0%");
param("recordingGB", "Grabaciones almacenadas (acumulado)", "GB");
param("recordingPlaybackGB", "Grabaciones reproducidas/descargadas / mes", "GB (egreso S3)");
param("lambdaInvocations", "Invocaciones Lambda / mes (estimado)", "invocaciones");
param("ddbMetaOps", "Operaciones DynamoDB metadata (ARIA) / mes", "operaciones");
param("ddbBizOps", "Operaciones DynamoDB negocio (cliente) / mes", "operaciones");
param("logsGB", "Logs CloudWatch / mes", "GB");
param("dataTransferGB", "Transferencia de datos saliente / mes", "GB");
param("amplifyFixed", "Hosting Amplify (fijo mensual)", "USD/mes", MONEY);
ws1.addRow([]);
const note1 = ws1.addRow(["▸ Editá las columnas Piloto/Pyme/Enterprise. Las hojas de costo recalculan solas."]);
note1.font = { italic: true, color: { argb: "FF6B7280" } };
ws1.mergeCells(note1.number, 1, note1.number, 5);

const pref = (key, scen) => `Parametros!${COLF[scen]}${P[key]}`;

// ============================================================ 2) PRECIOS
const ws2 = wb.addWorksheet("Precios", { views: [{ state: "frozen", ySplit: 3 }] });
ws2.columns = [{ width: 50 }, { width: 16 }, { width: 18 }, { width: 46 }];
titleRow(ws2, "Precios unitarios y supuestos (editables) — us-east-1, jun-2026", 4);
headerRow(ws2, ["Concepto", "Valor", "Unidad", "Fuente / nota"]);

const PR = {}; // key -> cell ref (Precios!B<row>)
function price(key, label, unit, src, fmt = MONEY4) {
  const r = ws2.addRow([label, PRICES[key], unit, src]);
  r.getCell("B").numFmt = fmt;
  r.getCell("B").fill = SUBFILL;
  PR[key] = `Precios!B${r.number}`;
}
function section(text) {
  const r = ws2.addRow([text]);
  r.font = { bold: true };
  r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  ws2.mergeCells(r.number, 1, r.number, 4);
}

section("Amazon Connect — omnicanal (PRECIOS REALES API, efectivo 2026-05-01)");
price("connectChat", "Connect — chat", "$/mensaje", "AWS Price List API (verificado)");
price("connectEmail", "Connect — email", "$/mensaje", "AWS Price List API (verificado)");
price("connectWBM", "Connect — WhatsApp (WBM serviced)", "$/mensaje", "AWS Price List API (verificado)");
price("outboundCampaignCall", "Connect — campañas voz (conector)", "$/llamada", "AWS Price List API (verificado)");
price("connectTaskEach", "Connect — tarea (Task)", "$/tarea", "AWS Connect pricing (Tasks)");
section("Amazon Connect — voz / telefonía (PERÚ — verificar operador/destino)");
price("connectVoiceMin", "Connect — uso de voz (servicio)", "$/min", "AWS Price List API (verificado, end-customer mins)");
price("telephonyInMin", "Telefonía entrante DID (Perú)", "$/min", "Connect Global Telephony Perú — verificar");
price("telephonyOutMin", "Telefonía saliente (Perú, DID)", "$/min", "Connect bajó Sudamérica nov-2023; móvil mayor — verificar");
price("didPerDay", "Número DID", "$/día", "AWS Connect pricing (rango por país)");
price("amdPerCall", "Detección de contestador (AMD)", "$/llamada", "AWS Connect AMD — por llamada saliente");
section("Analítica e IA de Connect — Contact Lens · Customer Profiles · Amazon Q");
price("contactLensMin", "Contact Lens — analítica de voz", "$/min", "AWS Price List API (verificado)");
price("contactLensChat", "Contact Lens — analítica de chat", "$/mensaje", "AWS Price List API (verificado, ChatAnalytics)");
price("customerProfilesDaily", "Customer Profiles — perfil utilizado/día", "$/perfil-día", "AWS Customer Profiles (2 perfiles gratis/contacto voz·chat)");
price("qConnectVoiceMin", "Amazon Q in Connect — asistencia voz", "$/min", "AWS Q in Connect (voz $0.008/min; chat/email/task aparte)");
section("WhatsApp — transporte AWS (EUM Social) + cargo de Meta");
price("eumSocialMsg", "AWS End User Messaging Social — WhatsApp", "$/mensaje", "Transporte AWS; puede solaparse con WBM si TODO va por Connect — ajustar");
price("metaWhatsAppMsg", "Meta — conversación marketing (Perú aprox.)", "$/mensaje", "Meta cobra por mensaje desde 2025; LatAm mkt $0.02–0.07 — verificar Perú");
section("Amazon Bedrock — Claude (lista pública on-demand)");
price("bedrockHaikuIn", "Claude 3.5 Haiku — entrada", "$/1K tokens", "AWS Bedrock pricing (verificado, $0.80/M)");
price("bedrockHaikuOut", "Claude 3.5 Haiku — salida", "$/1K tokens", "AWS Bedrock pricing (verificado, $4.00/M)");
price("bedrockSonnetIn", "Claude Sonnet 4 — entrada", "$/1K tokens", "AWS Bedrock pricing");
price("bedrockSonnetOut", "Claude Sonnet 4 — salida", "$/1K tokens", "AWS Bedrock pricing");
section("Cómputo y almacenamiento (lista pública)");
price("lambdaPerReq", "Lambda — solicitudes", "$/1M req", "AWS Lambda pricing (verificado)", MONEY);
price("lambdaGBs", "Lambda — cómputo", "$/GB-segundo", "AWS Lambda pricing (verificado, tier 1)", '"$"#,##0.00000000');
price("ddbWRU", "DynamoDB — escritura on-demand", "$/1M WRU", "AWS DynamoDB (verificado, recorte 50% nov-2024)", MONEY4);
price("ddbRRU", "DynamoDB — lectura on-demand", "$/1M RRU", "AWS DynamoDB (verificado, recorte 50% nov-2024)");
price("s3Storage", "S3 Standard — almacenamiento", "$/GB-mes", "AWS S3 pricing (verificado)");
price("s3Put", "S3 — solicitudes PUT", "$/1K", "AWS S3 pricing (verificado)");
price("cognitoMAU", "Cognito — usuario activo (MAU)", "$/MAU", "AWS Cognito (Essentials; Lite $0.0055)");
price("secretsMonth", "Secrets Manager — secreto", "$/secreto-mes", "AWS Secrets Manager (verificado)");
price("cwLogsGB", "CloudWatch Logs — ingesta", "$/GB", "AWS CloudWatch (verificado)");
price("dataTransferGB", "Transferencia de datos saliente", "$/GB", "AWS pricing (verificado, primeros 10 TB)");
section("Licencias externas (NO son AWS) — software de terceros del cliente");
price("sfSeatMonth", "Salesforce — licencia por usuario", "$/usuario-mes", "Licencia externa de Salesforce (NO AWS) — verificar plan", MONEY);

section("Supuestos de cálculo (editables)");
const AS = {};
function assume(key, label, unit, fmt = NUM) {
  const r = ws2.addRow([label, ASSUME[key], unit, ""]);
  r.getCell("B").numFmt = fmt;
  r.getCell("B").fill = SUBFILL;
  AS[key] = `Precios!B${r.number}`;
}
assume("voiceMinIn", "Duración media llamada entrante", "min");
assume("voiceMinOut", "Duración media llamada saliente", "min");
assume("qPctVoice", "% de minutos de voz con asistencia Amazon Q", "0–1", "0%");
assume("botTurns", "Turnos por conversación de bot", "turnos");
assume("tokInBot", "Tokens de entrada por turno de bot", "tokens");
assume("tokOutBot", "Tokens de salida por turno de bot", "tokens");
assume("tokInSum", "Tokens de entrada por resumen", "tokens");
assume("tokOutSum", "Tokens de salida por resumen", "tokens");
assume("lambdaGBsInv", "GB-segundo por invocación Lambda", "GB-s (256MB·300ms)", "#,##0.000");
assume("ddbWriteFrac", "Proporción de escrituras DynamoDB", "0–1", "0%");
assume("secretsTenant", "Secretos por tenant (SF + WhatsApp + OAuth)", "secretos");

// ============================================================ definición de líneas
// Cada línea: { label, how, pocket, external?, f(p) -> fórmula Excel, n(g,i) -> número }
//   p(key)  -> cellref del parámetro (Excel)
//   g(key,i)-> valor numérico del parámetro en el escenario i (verificador)
// PR.x y AS.x = cellrefs de precio/supuesto; PRICES.x y ASSUME.x = números.

const CLIENT_LINES = [
  { label: "Voz entrante — servicio Connect", how: "llamadas × min × $/min", pocket: "client",
    f: (p) => `${p("voiceContactsIn")}*${AS.voiceMinIn}*${PR.connectVoiceMin}`,
    n: (g, i) => g("voiceContactsIn", i) * ASSUME.voiceMinIn * PRICES.connectVoiceMin },
  { label: "Voz entrante — telefonía (DID Perú)", how: "llamadas × min × $/min", pocket: "client",
    f: (p) => `${p("voiceContactsIn")}*${AS.voiceMinIn}*${PR.telephonyInMin}`,
    n: (g, i) => g("voiceContactsIn", i) * ASSUME.voiceMinIn * PRICES.telephonyInMin },
  { label: "Voz saliente — servicio Connect", how: "llamadas × min × $/min", pocket: "client",
    f: (p) => `${p("voiceCallsOut")}*${AS.voiceMinOut}*${PR.connectVoiceMin}`,
    n: (g, i) => g("voiceCallsOut", i) * ASSUME.voiceMinOut * PRICES.connectVoiceMin },
  { label: "Voz saliente — telefonía (Perú)", how: "llamadas × min × $/min", pocket: "client",
    f: (p) => `${p("voiceCallsOut")}*${AS.voiceMinOut}*${PR.telephonyOutMin}`,
    n: (g, i) => g("voiceCallsOut", i) * ASSUME.voiceMinOut * PRICES.telephonyOutMin },
  { label: "Campañas de voz — conector", how: "llamadas × $/llamada", pocket: "client",
    f: (p) => `${p("voiceCallsOut")}*${PR.outboundCampaignCall}`,
    n: (g, i) => g("voiceCallsOut", i) * PRICES.outboundCampaignCall },
  { label: "Detección de contestador (AMD) — salientes", how: "llamadas salientes × $/llamada", pocket: "client",
    f: (p) => `${p("voiceCallsOut")}*${PR.amdPerCall}`,
    n: (g, i) => g("voiceCallsOut", i) * PRICES.amdPerCall },
  { label: "Contact Lens — analítica de VOZ", how: "min con CL × $/min", pocket: "client",
    f: (p) => `(${p("voiceContactsIn")}*${AS.voiceMinIn}+${p("voiceCallsOut")}*${AS.voiceMinOut})*${p("clPctVoice")}*${PR.contactLensMin}`,
    n: (g, i) => (g("voiceContactsIn", i) * ASSUME.voiceMinIn + g("voiceCallsOut", i) * ASSUME.voiceMinOut) * g("clPctVoice", i) * PRICES.contactLensMin },
  { label: "Contact Lens — analítica de CHAT", how: "chats × % CL × $/msg", pocket: "client",
    f: (p) => `${p("chats")}*${p("clPctVoice")}*${PR.contactLensChat}`,
    n: (g, i) => g("chats", i) * g("clPctVoice", i) * PRICES.contactLensChat },
  { label: "Customer Profiles — perfil utilizado/día", how: "contactos × $/perfil-día (≈ perfiles únicos)", pocket: "client",
    f: (p) => `(${p("voiceContactsIn")}+${p("voiceCallsOut")}+${p("chats")}+${p("emails")})*${PR.customerProfilesDaily}`,
    n: (g, i) => (g("voiceContactsIn", i) + g("voiceCallsOut", i) + g("chats", i) + g("emails", i)) * PRICES.customerProfilesDaily },
  { label: "Amazon Q in Connect — copiloto (voz)", how: "min voz × % con Q × $/min", pocket: "client",
    f: (p) => `(${p("voiceContactsIn")}*${AS.voiceMinIn}+${p("voiceCallsOut")}*${AS.voiceMinOut})*${AS.qPctVoice}*${PR.qConnectVoiceMin}`,
    n: (g, i) => (g("voiceContactsIn", i) * ASSUME.voiceMinIn + g("voiceCallsOut", i) * ASSUME.voiceMinOut) * ASSUME.qPctVoice * PRICES.qConnectVoiceMin },
  { label: "Números DID (renta)", how: "números × $/día × días", pocket: "client",
    f: (p) => `${p("nDIDs")}*${PR.didPerDay}*${p("diasMes")}`,
    n: (g, i) => g("nDIDs", i) * PRICES.didPerDay * g("diasMes", i) },
  { label: "WhatsApp — servicio Connect (WBM)", how: "mensajes × $/msg", pocket: "client",
    f: (p) => `${p("waMessages")}*${PR.connectWBM}`,
    n: (g, i) => g("waMessages", i) * PRICES.connectWBM },
  { label: "WhatsApp — transporte AWS (EUM Social)", how: "mensajes × $/msg (verificar solapamiento con WBM)", pocket: "client",
    f: (p) => `${p("waMessages")}*${PR.eumSocialMsg}`,
    n: (g, i) => g("waMessages", i) * PRICES.eumSocialMsg },
  { label: "WhatsApp — conversaciones Meta (HSM)", how: "plantillas × $/msg", pocket: "client",
    f: (p) => `${p("waHsm")}*${PR.metaWhatsAppMsg}`,
    n: (g, i) => g("waHsm", i) * PRICES.metaWhatsAppMsg },
  { label: "Chat web", how: "mensajes × $/msg", pocket: "client",
    f: (p) => `${p("chats")}*${PR.connectChat}`,
    n: (g, i) => g("chats", i) * PRICES.connectChat },
  { label: "Email", how: "mensajes × $/msg", pocket: "client",
    f: (p) => `${p("emails")}*${PR.connectEmail}`,
    n: (g, i) => g("emails", i) * PRICES.connectEmail },
  { label: "Connect Tasks (tareas)", how: "tareas × $/tarea", pocket: "client",
    f: (p) => `${p("connectTasks")}*${PR.connectTaskEach}`,
    n: (g, i) => g("connectTasks", i) * PRICES.connectTaskEach },
  { label: "Bedrock — bots / Agente IA", how: "conv × turnos × tokens × $", pocket: "client",
    f: (p) => `${p("botConversations")}*${AS.botTurns}*(${AS.tokInBot}/1000*${PR.bedrockHaikuIn}+${AS.tokOutBot}/1000*${PR.bedrockHaikuOut})`,
    n: (g, i) => g("botConversations", i) * ASSUME.botTurns * (ASSUME.tokInBot / 1000 * PRICES.bedrockHaikuIn + ASSUME.tokOutBot / 1000 * PRICES.bedrockHaikuOut) },
  { label: "Bedrock — resúmenes / copiloto", how: "invocaciones × tokens × $", pocket: "client",
    f: (p) => `${p("aiSummaries")}*(${AS.tokInSum}/1000*${PR.bedrockHaikuIn}+${AS.tokOutSum}/1000*${PR.bedrockHaikuOut})`,
    n: (g, i) => g("aiSummaries", i) * (ASSUME.tokInSum / 1000 * PRICES.bedrockHaikuIn + ASSUME.tokOutSum / 1000 * PRICES.bedrockHaikuOut) },
  { label: "DynamoDB — datos de negocio (BYO)", how: "ops × mezcla R/W × $", pocket: "client",
    f: (p) => `${p("ddbBizOps")}*${AS.ddbWriteFrac}/1000000*${PR.ddbWRU}+${p("ddbBizOps")}*(1-${AS.ddbWriteFrac})/1000000*${PR.ddbRRU}`,
    n: (g, i) => g("ddbBizOps", i) * ASSUME.ddbWriteFrac / 1e6 * PRICES.ddbWRU + g("ddbBizOps", i) * (1 - ASSUME.ddbWriteFrac) / 1e6 * PRICES.ddbRRU },
  { label: "S3 — grabaciones (almacenamiento + PUT)", how: "GB × $/GB + PUT", pocket: "client",
    f: (p) => `${p("recordingGB")}*${PR.s3Storage}+(${p("voiceContactsIn")}+${p("voiceCallsOut")})/1000*${PR.s3Put}`,
    n: (g, i) => g("recordingGB", i) * PRICES.s3Storage + (g("voiceContactsIn", i) + g("voiceCallsOut", i)) / 1000 * PRICES.s3Put },
  { label: "S3 — egreso de grabaciones (reproducción/descarga)", how: "GB reproducidos × $/GB", pocket: "client",
    f: (p) => `${p("recordingPlaybackGB")}*${PR.dataTransferGB}`,
    n: (g, i) => g("recordingPlaybackGB", i) * PRICES.dataTransferGB },
  { label: "Salesforce — licencia (EXTERNA, no AWS) · opcional", how: "usuarios SF × $/usuario — poné 0 si no usa SF; es licencia que el cliente ya paga", pocket: "client", external: true,
    f: (p) => `${p("sfSeats")}*${PR.sfSeatMonth}`,
    n: (g, i) => g("sfSeats", i) * PRICES.sfSeatMonth },
];

const PLATFORM_LINES = [
  { label: "Lambda — solicitudes", how: "invocaciones × $/1M", pocket: "platform",
    f: (p) => `${p("lambdaInvocations")}/1000000*${PR.lambdaPerReq}`,
    n: (g, i) => g("lambdaInvocations", i) / 1e6 * PRICES.lambdaPerReq },
  { label: "Lambda — cómputo", how: "invocaciones × GB-s × $", pocket: "platform",
    f: (p) => `${p("lambdaInvocations")}*${AS.lambdaGBsInv}*${PR.lambdaGBs}`,
    n: (g, i) => g("lambdaInvocations", i) * ASSUME.lambdaGBsInv * PRICES.lambdaGBs },
  { label: "DynamoDB — metadata SaaS", how: "ops × mezcla R/W × $", pocket: "platform",
    f: (p) => `${p("ddbMetaOps")}*${AS.ddbWriteFrac}/1000000*${PR.ddbWRU}+${p("ddbMetaOps")}*(1-${AS.ddbWriteFrac})/1000000*${PR.ddbRRU}`,
    n: (g, i) => g("ddbMetaOps", i) * ASSUME.ddbWriteFrac / 1e6 * PRICES.ddbWRU + g("ddbMetaOps", i) * (1 - ASSUME.ddbWriteFrac) / 1e6 * PRICES.ddbRRU },
  { label: "Cognito — usuarios activos (MAU)", how: "agentes × $/MAU", pocket: "platform",
    f: (p) => `${p("agentes")}*${PR.cognitoMAU}`,
    n: (g, i) => g("agentes", i) * PRICES.cognitoMAU },
  { label: "Secrets Manager", how: "secretos × $/mes", pocket: "platform",
    f: () => `${AS.secretsTenant}*${PR.secretsMonth}`,
    n: () => ASSUME.secretsTenant * PRICES.secretsMonth },
  { label: "CloudWatch Logs", how: "GB × $/GB", pocket: "platform",
    f: (p) => `${p("logsGB")}*${PR.cwLogsGB}`,
    n: (g, i) => g("logsGB", i) * PRICES.cwLogsGB },
  { label: "Amplify Hosting", how: "fijo mensual", pocket: "platform",
    f: (p) => `${p("amplifyFixed")}`,
    n: (g, i) => g("amplifyFixed", i) },
  { label: "Transferencia de datos", how: "GB × $/GB", pocket: "platform",
    f: (p) => `${p("dataTransferGB")}*${PR.dataTransferGB}`,
    n: (g, i) => g("dataTransferGB", i) * PRICES.dataTransferGB },
];

// ============================================================ helpers de costo
function addCostLine(ws, ln) {
  const row = ws.addRow([ln.label, null, null, null, ln.how || ""]);
  for (const scen of SCEN) {
    const p = (key) => pref(key, scen);
    const cell = row.getCell(COLF[scen]);
    cell.value = { formula: ln.f(p) };
    cell.numFmt = MONEY;
  }
  row.getCell(5).font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  return row.number;
}

function costSheet(name, title, lines) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 48 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 34 }];
  titleRow(ws, title);
  headerRow(ws, ["Concepto", "Piloto", "Pyme", "Enterprise", "Cómo se calcula"]);

  const core = lines.filter((l) => !l.external);
  const ext = lines.filter((l) => l.external);

  const first = ws.rowCount + 1;
  for (const ln of core) addCostLine(ws, ln);
  const last = ws.rowCount;

  const tot = ws.addRow(["TOTAL " + name.replace("Costo", "") + " — AWS (USD/mes)"]);
  tot.font = { bold: true };
  for (const col of ["B", "C", "D"]) {
    const c = tot.getCell(col);
    c.value = { formula: `SUM(${col}${first}:${col}${last})` };
    c.numFmt = MONEY;
    c.fill = TOTFILL;
    c.font = { bold: true };
  }
  const perAgent = ws.addRow(["  Costo AWS por agente (USD/mes)"]);
  for (const scen of SCEN) {
    const col = COLF[scen];
    const c = perAgent.getCell(col);
    c.value = { formula: `${col}${tot.number}/${pref("agentes", scen)}` };
    c.numFmt = MONEY;
  }

  let externalTotalRow = null;
  let grandTotalRow = tot.number;
  if (ext.length) {
    ws.addRow([]);
    const sec = ws.addRow(["Licencias externas (NO son AWS) — se facturan aparte"]);
    sec.font = { bold: true };
    sec.getCell(1).fill = EXTFILL;
    ws.mergeCells(sec.number, 1, sec.number, 5);
    const extFirst = ws.rowCount + 1;
    for (const ln of ext) addCostLine(ws, ln);
    const extLast = ws.rowCount;
    const extTot = ws.addRow(["  Subtotal licencias externas (USD/mes)"]);
    for (const col of ["B", "C", "D"]) {
      const c = extTot.getCell(col);
      c.value = { formula: `SUM(${col}${extFirst}:${col}${extLast})` };
      c.numFmt = MONEY;
      c.fill = EXTFILL;
    }
    externalTotalRow = extTot.number;
    const grand = ws.addRow(["TOTAL con licencias externas (USD/mes)"]);
    grand.font = { bold: true };
    for (const col of ["B", "C", "D"]) {
      const c = grand.getCell(col);
      c.value = { formula: `${col}${tot.number}+${col}${extTot.number}` };
      c.numFmt = MONEY;
      c.fill = TOTFILL;
      c.font = { bold: true };
    }
    grandTotalRow = grand.number;
  }
  return { ws, totalRow: tot.number, externalTotalRow, grandTotalRow };
}

// ============================================================ 3) COSTO CLIENTE
const cliente = costSheet(
  "CostoCliente",
  "Costo del CLIENTE (AWS en su cuenta BYO) — USD/mes · la licencia Salesforce va aparte",
  CLIENT_LINES
);

// ============================================================ 4) COSTO ARIA
const vox = costSheet(
  "CostoARIA",
  "Costo de ARIA (plataforma · cuenta 731736972577) — USD/mes por tenant",
  PLATFORM_LINES
);

// ============================================================ 5) RESUMEN
const ws5 = wb.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 3 }] });
ws5.columns = [{ width: 52 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 26 }];
titleRow(ws5, "Resumen ejecutivo de costos — USD/mes");
headerRow(ws5, ["Concepto", "Piloto", "Pyme", "Enterprise", "Nota"]);

function sumRow(label, fn, fmt = MONEY, fill, note = "") {
  const r = ws5.addRow([label, null, null, null, note]);
  for (const scen of SCEN) {
    const col = COLF[scen];
    const c = r.getCell(col);
    c.value = { formula: fn(scen, col) };
    c.numFmt = fmt;
    if (fill) c.fill = fill;
  }
  if (note) r.getCell(5).font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  return r.number;
}

const rCli = sumRow("Costo del CLIENTE — AWS BYO (sin licencias)", (s, col) => `CostoCliente!${col}${cliente.totalRow}`);
const rCliPA = sumRow("  · por agente", (s, col) => `${col}${rCli}/${pref("agentes", s)}`);
const rCliSF = sumRow("Licencia Salesforce (externa, opcional)", (s, col) => `CostoCliente!${col}${cliente.externalTotalRow}`, MONEY, EXTFILL);
const rVox = sumRow("Costo de la PLATAFORMA (ARIA)", (s, col) => `CostoARIA!${col}${vox.totalRow}`);
const rVoxPA = sumRow("  · por agente", (s, col) => `${col}${rVox}/${pref("agentes", s)}`);
ws5.addRow([]);

// Opex (FUENTE ÚNICA — la hoja PrecioARIA lo referencia) → costo de servir y margen
const rOpex = ws5.addRow(["Opex por agente (soporte, dev, ventas) — EDITABLE", ...OPEX, "baja con la escala"]);
for (const col of ["B", "C", "D"]) { rOpex.getCell(col).numFmt = MONEY; rOpex.getCell(col).fill = SUBFILL; }
rOpex.getCell(5).font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
const rServe = sumRow("Costo de servir por agente (infra + opex)", (s, col) => `${col}${rVoxPA}+${col}${rOpex.number}`, MONEY, SUBFILL);
ws5.addRow([]);

// Tarifa ARIA (editable) → ingreso y márgenes
const rTarifa = ws5.addRow(["Tarifa ARIA por agente (USD/mes) — EDITABLE", ...TARIFA, "ver análisis en hoja 'PrecioARIA'"]);
for (const col of ["B", "C", "D"]) { rTarifa.getCell(col).numFmt = MONEY; rTarifa.getCell(col).fill = SUBFILL; }
rTarifa.getCell(5).font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
const rIng = sumRow("Ingreso de ARIA (tarifa × agentes)", (s, col) => `${col}${rTarifa.number}*${pref("agentes", s)}`);
const rMargenBruto = sumRow("Margen BRUTO de ARIA (incl. opex)", (s, col) => `(${col}${rTarifa.number}-${col}${rServe})/${col}${rTarifa.number}`, PCT, TOTFILL, "el margen 'real' del SaaS");
const rMargenContrib = sumRow("Margen de contribución (solo infra)", (s, col) => `(${col}${rIng}-${col}${rVox})/${col}${rIng}`, PCT, null, "ignora opex — NO confundir con margen bruto");
const rUtil = sumRow("Utilidad bruta ARIA / tenant", (s, col) => `(${col}${rTarifa.number}-${col}${rServe})*${pref("agentes", s)}`, MONEY, TOTFILL);
ws5.addRow([]);
const rTotCli = sumRow("COSTO TOTAL para el cliente (AWS propio + tarifa ARIA)", (s, col) => `${col}${rCli}+${col}${rIng}`, MONEY, TOTFILL);
sumRow("  · por agente", (s, col) => `${col}${rTotCli}/${pref("agentes", s)}`);

ws5.addRow([]);
const foot = ws5.addRow(["▸ 'Costo del cliente' = lo que paga a AWS en SU cuenta (BYO); la licencia Salesforce es externa y va aparte. 'Costo de la plataforma' = lo que paga ARIA por operar. Dos márgenes: BRUTO (incl. opex, el real) y CONTRIBUCIÓN (solo infra, más alto)."]);
foot.font = { italic: true, color: { argb: "FF6B7280" } };
ws5.mergeCells(foot.number, 1, foot.number, 5);

// ============================================================ 6) PRECIO ARIA (¿cuánto cobrar?)
const ws6 = wb.addWorksheet("PrecioARIA", { views: [{ state: "frozen", ySplit: 3 }] });
ws6.columns = [{ width: 54 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 36 }];
titleRow(ws6, "¿Cuánto cobrar por ARIA? — análisis de precio (USD/mes por agente)");
headerRow(ws6, ["Concepto", "Piloto", "Pyme", "Enterprise", "Nota"]);

const psec = (t) => {
  const r = ws6.addRow([t]);
  r.font = { bold: true };
  r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  ws6.mergeCells(r.number, 1, r.number, 5);
};
function prow(label, fn, fmt = MONEY, fill, note = "") {
  const r = ws6.addRow([label, null, null, null, note]);
  for (const scen of SCEN) {
    const col = COLF[scen];
    const c = r.getCell(col);
    c.value = { formula: fn(scen, col) };
    c.numFmt = fmt;
    if (fill) c.fill = fill;
  }
  if (note) r.getCell(5).font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  return r.number;
}
function pinput(label, vals, unit, fmt = MONEY) {
  const r = ws6.addRow([label, ...vals, unit]);
  for (const col of ["B", "C", "D"]) { r.getCell(col).numFmt = fmt; r.getCell(col).fill = SUBFILL; }
  r.getCell(5).font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  return r.number;
}

psec("A) Costo de servir — lo que le cuesta a ARIA operar (por agente)");
const rPlat = prow("Costo de plataforma / agente (viene de 'Resumen')", (s, col) => `Resumen!${col}${rVoxPA}`, MONEY, null, "infra: Lambda, DynamoDB, Cognito, hosting…");
const rOpexP = prow("+ Opex / agente (viene de 'Resumen' — fuente única)", (s, col) => `Resumen!${col}${rOpex.number}`, MONEY, null, "soporte, dev, ventas, overhead");
const rServeP = prow("= Costo de servir / agente", (s, col) => `${col}${rPlat}+${col}${rOpexP}`, MONEY, SUBFILL);
ws6.addRow([]);

psec("B) Tres formas de poner el precio");
const rMargin = pinput("Margen bruto objetivo (para costo-plus)", [0.75, 0.75, 0.75], "EDITABLE (0–1)", PCT);
prow("1) COSTO-PLUS · precio = costo de servir ÷ (1 − margen)", (s, col) => `${col}${rServeP}/(1-${col}${rMargin})`, MONEY, null, "piso: cubre costo + margen");
const rCeiling = pinput("Techo de VALOR: licencia/agente de Kommo+Chattigo+Salesforce", [120, 110, 95], "EDITABLE — software que reemplaza", MONEY);
const rCapture = pinput("  % de ese valor que captura ARIA", [0.35, 0.35, 0.3], "EDITABLE (0–1)", PCT);
prow("2) POR VALOR · precio = techo de valor × % capturado", (s, col) => `${col}${rCeiling}*${col}${rCapture}`, MONEY, null, "techo: lo que el cliente ya paga hoy");
const rMarkup = pinput("Markup sobre el AWS del cliente (servicio gestionado)", [0.15, 0.12, 0.1], "EDITABLE (0–1)", PCT);
prow("3) POR SERVICIO · markup × (consumo BYO / agente)", (s, col) => `Resumen!${col}${rCliPA}*${col}${rMarkup}`, MONEY, null, "add-on: el CLIENTE sigue pagando su AWS; ARIA solo lo opera");
ws6.addRow([]);

psec("C) Recomendación ARIA — híbrido: suscripción por agente + consumo BYO a costo");
const rReco = prow("» Precio recomendado / agente (= tarifa de 'Resumen')", (s, col) => `Resumen!${col}${rTarifa.number}`, MONEY, SUBFILL, "editá la tarifa en 'Resumen'");
prow("Margen bruto resultante", (s, col) => `(${col}${rReco}-${col}${rServeP})/${col}${rReco}`, PCT, TOTFILL);
prow("Descuento vs. su software actual (techo de valor)", (s, col) => `1-${col}${rReco}/${col}${rCeiling}`, PCT, null, "qué tan barato es el SOFTWARE vs. lo que paga hoy");
prow("Ingreso ARIA / tenant (precio × agentes)", (s, col) => `${col}${rReco}*${pref("agentes", s)}`, MONEY, TOTFILL);
prow("Utilidad bruta ARIA / tenant", (s, col) => `(${col}${rReco}-${col}${rServeP})*${pref("agentes", s)}`, MONEY);
ws6.addRow([]);

psec("D) Si ARIA HOSPEDA la instancia del cliente (NO-BYO) — alerta de cobertura");
prow("Costo total si corre en la cuenta de ARIA / agente", (s, col) => `Resumen!${col}${rCliPA}+${col}${rServeP}`, MONEY, EXTFILL, "instancia del cliente + servir: aquí la suscripción NO alcanza");
prow("Precio all-inclusive para break-even / agente", (s, col) => `Resumen!${col}${rCliPA}+${col}${rServeP}`, MONEY, null, "piso absoluto: 0% margen");
prow("Precio all-inclusive para margen objetivo / agente", (s, col) => `(Resumen!${col}${rCliPA}+${col}${rServeP})/(1-${col}${rMargin})`, MONEY, null, "con el margen objetivo de arriba");
ws6.addRow([]);

[
  "Metodología — cómo se decide el precio:",
  "  • Costo-plus (PISO): la infraestructura de ARIA cuesta ~US$3–5 por agente al mes. Aun sumando soporte y",
  "    desarrollo, el costo de servir queda bajo. Cobrar 'a costo + margen' dejaría mucha plata sobre la mesa.",
  "  • Por valor (TECHO): el cliente HOY paga US$80–200 por agente en LICENCIAS de Kommo, Chattigo y Salesforce.",
  "    Ese es el techo. ARIA captura ~1/3 de ese valor y aun así es muchísimo más barato para él.",
  "  • Por servicio (ADD-ON): en BYO el cliente paga su propio AWS. ARIA puede gestionarlo con un markup (10–15%)",
  "    como servicio administrado — el cliente SIGUE pagando su AWS, ARIA solo lo opera. No es el modelo principal.",
  "",
  "Recomendación: SUSCRIPCIÓN POR AGENTE (precio plano, predecible) + el consumo variable de AWS (telefonía,",
  "WhatsApp, IA) que el cliente paga directo a AWS, a costo y sin markup. Es transparente, fácil de vender y",
  "deja 63–71% de margen bruto. El 'por servicio' se ofrece sólo como add-on gestionado.",
  "",
  "⚠ ALERTA (sección D): si en un PILOTO o en 'AWS gestionado' la instancia corre en la CUENTA DE ARIA en vez de",
  "la del cliente, ARIA paga TAMBIÉN la instancia (~$96–124/agente). Ahí la suscripción de $29–45 NO cubre: hay",
  "que facturar el consumo aparte o cobrar all-inclusive (ver sección D). En BYO real esto no pasa: lo paga el cliente.",
  "",
  "Comparación justa: el precio ARIA (software) se compara contra la LICENCIA del software que reemplaza, no",
  "contra el total. La telefonía/WhatsApp el cliente la paga con CUALQUIER herramienta — con ARIA la paga a",
  "costo AWS (normalmente más barata que la que viene 'empaquetada' en las plataformas tradicionales).",
].forEach((t) => {
  const r = ws6.addRow([t]);
  if (t.endsWith(":")) r.font = { bold: true };
  else r.font = { italic: true, color: { argb: "FF4B5563" } };
  ws6.mergeCells(r.number, 1, r.number, 5);
});

// ============================================================ LÉEME
const ws0 = wb.addWorksheet("Léeme");
ws0.columns = [{ width: 104 }];
[
  "CALCULADORA DE COSTOS — ARIA (Connectview) · v3 2026-06-07",
  "",
  "Cómo usarla:",
  "  1. Editá la hoja 'Parametros' (volúmenes por escenario: agentes, llamadas, mensajes, etc.).",
  "  2. Si cambian los precios, editá 'Precios' (precios unitarios y supuestos).",
  "  3. 'CostoCliente', 'CostoARIA', 'Resumen' y 'PrecioARIA' recalculan automáticamente.",
  "",
  "Dos perspectivas (modelo BYO):",
  "  • Costo del CLIENTE  = lo que la empresa paga a AWS en SU propia cuenta",
  "    (Amazon Connect, telefonía, WhatsApp, Bedrock, DynamoDB de negocio, S3 de grabaciones).",
  "    La licencia de Salesforce es EXTERNA (no AWS) y se muestra aparte, fuera del TOTAL AWS.",
  "  • Costo de ARIA       = lo que paga la plataforma por operar el servicio para ese tenant",
  "    (Lambda, DynamoDB de metadata, Cognito, Secrets Manager, CloudWatch, hosting, transferencia).",
  "",
  "Escenarios de referencia: Piloto (~5 agentes), Pyme (~25), Enterprise (~100). Todo es editable.",
  "",
  "Hoja 'UDEP (real)': caso REAL con la factura AWS de la instancia Amazon Connect de la UDEP (1 mes,",
  "us-east-1, total $426.93). Compara la factura de HOY (analítica DIY: QuickSight + Kinesis + OpenSearch +",
  "Athena) contra el escenario CON ARIA, donde el dashboard de ARIA reemplaza ese stack (~$134.56/mes, −31.5%",
  "de la factura AWS) a cambio de la suscripción. Trae 3 gráficos nativos editables y valida cada precio",
  "unitario contra la realidad. El one-pager visual equivalente: docs/costos/udep-comparativa.html.",
  "",
  "IMPORTANTE — cobertura (sección D de 'PrecioARIA'): en BYO la instancia del cliente la paga EL CLIENTE",
  "directo a AWS; la suscripción solo cubre la plataforma de ARIA (~$3–5/agente) y deja 63–71% de margen.",
  "PERO si la instancia corriera en la cuenta de ARIA (piloto sin BYO, o add-on 'AWS gestionado' mal hecho),",
  "ARIA pagaría también la instancia y la suscripción NO alcanza: hay que facturar el consumo o ir all-inclusive.",
  "",
  "Dos definiciones de margen en 'Resumen': BRUTO (incl. opex, el real, ~63–71%) y CONTRIBUCIÓN (solo infra,",
  "~89–91%). No confundirlas: para decisiones de precio usá el margen BRUTO.",
  "",
  "v3 — correcciones de la auditoría (2026-06-07): precios verificados vs AWS Price List API; telefonía Perú",
  "(entrante 0.0075, saliente 0.0067), DynamoDB on-demand a la mitad, Contact Lens chat 0.0015, Meta WhatsApp",
  "0.02 (verificar Perú); Customer Profiles por perfil-día y Amazon Q por minuto de voz; líneas nuevas: AMD,",
  "WhatsApp EUM Social, Connect Tasks y egreso de grabaciones; secretos/tenant 2→4. Ítems aún marcados",
  "'verificar' (telefonía/Meta por país, EUM Social posible solapamiento): confirmá antes de cotizar.",
  "",
  "Generada con: node scripts/gen-costos-xlsx.mjs",
].forEach((t, i) => {
  const r = ws0.addRow([t]);
  if (i === 0) r.font = { bold: true, size: 14 };
  if (t.endsWith(":")) r.font = { bold: true };
});

// ════════════════════ HOJA 'UDEP (real)' + GRÁFICOS NATIVOS ════════════════════
// ExcelJS no soporta charts; los inyectamos como partes OOXML nativas (editables) en el
// .xlsx ya escrito, con JSZip. La hoja se arma con ExcelJS; los gráficos referencian sus
// celdas, así que se actualizan si editás los volúmenes o la tarifa.

const xmlesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const C_NS = `xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const numCache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>` + vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("") + `</c:numCache>`;
const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>` + vals.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlesc(v)}</c:v></c:pt>`).join("") + `</c:strCache>`;
const catEl = (f, cache) => `<c:cat><c:strRef><c:f>${xmlesc(f)}</c:f>${strCache(cache)}</c:strRef></c:cat>`;
const valEl = (f, cache) => `<c:val><c:numRef><c:f>${xmlesc(f)}</c:f>${numCache(cache)}</c:numRef></c:val>`;
const titleEl = (t) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr><a:r><a:rPr lang="es-PE" sz="1100" b="1"/><a:t>${xmlesc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
const MONEYFMT = `&quot;$&quot;#,##0`;

function chartXml(spec) {
  if (spec.type === "pie") {
    const dpt = spec.highlightIdx != null
      ? `<c:dPt><c:idx val="${spec.highlightIdx}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="F59E0B"/></a:solidFill></c:spPr></c:dPt>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${C_NS}><c:chart>${titleEl(spec.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${dpt}${catEl(spec.catF, spec.catCache)}${valEl(spec.valF, spec.valCache)}</c:ser><c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls><c:firstSliceAng val="0"/></c:pieChart></c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
  }
  const stacked = spec.type === "barStacked";
  const ax1 = 511110001, ax2 = 511110002;
  const ser = spec.series.map((s, i) => {
    const tx = s.name ? `<c:tx><c:v>${xmlesc(s.name)}</c:v></c:tx>` : "";
    const sp = s.color ? `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr>` : "";
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${sp}${catEl(spec.catF, spec.catCache)}${valEl(s.valF, s.valCache)}</c:ser>`;
  }).join("");
  const legend = spec.series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` : "";
  const dLbls = `<c:dLbls><c:numFmt formatCode="${MONEYFMT}" sourceLinked="0"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${C_NS}><c:chart>${titleEl(spec.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="${stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${ser}${dLbls}<c:gapWidth val="${stacked ? 60 : 90}"/>${stacked ? '<c:overlap val="100"/>' : ""}<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:barChart><c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="${ax2}"/></c:catAx><c:valAx><c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="${MONEYFMT}" sourceLinked="0"/><c:crossAx val="${ax1}"/></c:valAx></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

const ANCHORS = [
  { fromCol: 7, fromRow: 1, toCol: 17, toRow: 21 },
  { fromCol: 7, fromRow: 22, toCol: 17, toRow: 42 },
  { fromCol: 7, fromRow: 43, toCol: 17, toRow: 63 },
];
function drawingXml(n) {
  let anchors = "";
  for (let i = 0; i < n; i++) {
    const a = ANCHORS[i] || ANCHORS[ANCHORS.length - 1];
    anchors += `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

async function injectUdepCharts(path, specs) {
  const zip = await JSZip.loadAsync(await readFile(path));
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sm = wbXml.match(new RegExp(`<sheet[^>]*name="${UDEP_SHEET.replace(/[()]/g, "\\$&")}"[^>]*r:id="([^"]+)"`));
  if (!sm) throw new Error("inject: no encuentro la hoja " + UDEP_SHEET);
  const rm = relsXml.match(new RegExp(`<Relationship[^>]*Id="${sm[1]}"[^>]*Target="([^"]+)"`));
  if (!rm) throw new Error("inject: no encuentro el target de " + sm[1]);
  const sheetPath = "xl/" + rm[1].replace(/^\/?xl\//, "").replace(/^\//, "");
  const sheetBase = rm[1].split("/").pop();
  specs.forEach((s, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(s)));
  zip.file("xl/drawings/drawing1.xml", drawingXml(specs.length));
  zip.file("xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    specs.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("") +
    `</Relationships>`);
  zip.file(`xl/worksheets/_rels/${sheetBase}.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  let sx = await zip.file(sheetPath).async("string");
  if (!/<drawing /.test(sx)) sx = sx.replace("</worksheet>", `<drawing r:id="rId1"/></worksheet>`);
  zip.file(sheetPath, sx);
  let ct = await zip.file("[Content_Types].xml").async("string");
  const adds = `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
    specs.map((s, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("");
  ct = ct.replace("</Types>", adds + "</Types>");
  zip.file("[Content_Types].xml", ct);
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fsWriteFile(path, out);
}

function buildUdepSheet(wb) {
  const ws = wb.addWorksheet(UDEP_SHEET, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 46 }, { width: 14 }, { width: 12 }, { width: 22 }, { width: 32 }];
  const t = ws.addRow(["UDEP — caso real: factura AWS hoy vs. con ARIA"]);
  t.font = { bold: true, size: 14 }; ws.mergeCells(t.number, 1, t.number, 5);
  const ctx = ws.addRow(["Factura real de Amazon Connect (1 mes, us-east-1). Total $426.93. Escala ~4 agentes (3 autores + 1 lector QuickSight; 8.956 min de voz ≈ 149 h/mes). Telefonía $0 en AWS → BYOC/SIP propia. Cada precio unitario coincide exacto con la hoja 'Precios'."]);
  ctx.font = { italic: true, color: { argb: "FF6B7280" } }; ws.mergeCells(ctx.number, 1, ctx.number, 5);
  ws.addRow([]);

  // ── Bloque A: factura real por servicio ──
  headerRow(ws, ["Servicio AWS (factura real)", "USD/mes", "% factura", "¿ARIA lo reemplaza?", "Detalle"]);
  const aFirst = ws.rowCount + 1;
  const rowOf = {};
  for (const ln of UDEP.lines) {
    const r = ws.addRow([ln.label, ln.usd, null, ln.group === "analytics" ? "Sí — analítica" : ln.group === "zero" ? "—" : "No (core)", ln.detail]);
    r.getCell("B").numFmt = MONEY;
    r.getCell("B").fill = ln.group === "analytics" ? EXTFILL : SUBFILL;
    r.getCell("C").numFmt = PCT;
    r.getCell("E").font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
    if (ln.group === "analytics") r.getCell("D").font = { bold: true, color: { argb: "FF92400E" } };
    rowOf[ln.k] = r.number;
  }
  const aLast = ws.rowCount;
  const total = ws.addRow(["TOTAL factura AWS de la UDEP (USD/mes)"]);
  total.font = { bold: true };
  total.getCell("B").value = { formula: `SUM(B${aFirst}:B${aLast})` };
  total.getCell("B").numFmt = MONEY; total.getCell("B").fill = TOTFILL; total.getCell("B").font = { bold: true };
  for (let r = aFirst; r <= aLast; r++) ws.getCell(`C${r}`).value = { formula: `B${r}/$B$${total.number}` };
  const anaRows = UDEP.lines.filter((l) => l.group === "analytics").map((l) => rowOf[l.k]);
  const subAna = ws.addRow(["  Subtotal — analítica que ARIA reemplaza (QuickSight+Kinesis+OpenSearch+Athena)"]);
  subAna.getCell("B").value = { formula: anaRows.map((r) => `B${r}`).join("+") };
  subAna.getCell("B").numFmt = MONEY; subAna.getCell("B").fill = EXTFILL; subAna.font = { bold: true };
  const subCore = ws.addRow(["  Subtotal — core contact center (se mantiene en AWS)"]);
  subCore.getCell("B").value = { formula: `B${total.number}-B${subAna.number}` };
  subCore.getCell("B").numFmt = MONEY; subCore.getCell("B").fill = SUBFILL; subCore.font = { bold: true };

  // ── Bloque B: comparativa hoy vs con ARIA ──
  ws.addRow([]);
  const bt = ws.addRow(["Comparativa: hoy (analítica DIY en AWS) vs. con ARIA"]);
  bt.font = { bold: true, size: 12 }; ws.mergeCells(bt.number, 1, bt.number, 5);
  const inAg = ws.addRow(["Agentes UDEP (editable)", UDEP.agentes, null, null, "estimado: asientos QuickSight + volumen de voz"]);
  inAg.getCell("B").numFmt = NUM; inAg.getCell("B").fill = SUBFILL; inAg.getCell("E").font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  const inTar = ws.addRow(["Tarifa ARIA / agente (USD/mes, editable)", UDEP.tarifaAria, null, null, "tarifa piloto; ver hoja 'Resumen'"]);
  inTar.getCell("B").numFmt = MONEY; inTar.getCell("B").fill = SUBFILL; inTar.getCell("E").font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  ws.addRow([]);
  headerRow(ws, ["Concepto", "Hoy (DIY)", "Con ARIA", "", "Nota"]);
  const cCore = ws.addRow(["AWS — core contact center (voz, chat, CL, datos, grabaciones)", null, null, null, "igual; lo paga directo a AWS (BYO)"]);
  cCore.getCell("B").value = { formula: `B${subCore.number}` }; cCore.getCell("C").value = { formula: `B${subCore.number}` };
  const cAna = ws.addRow(["AWS — stack de analítica (QuickSight+Kinesis+OpenSearch+Athena)", null, null, null, "el dashboard de ARIA lo reemplaza"]);
  cAna.getCell("B").value = { formula: `B${subAna.number}` }; cAna.getCell("C").value = { formula: "0" };
  const cSub = ws.addRow(["Suscripción ARIA (software)", null, null, null, "dashboard + omnicanal + IA + soporte"]);
  cSub.getCell("B").value = { formula: "0" }; cSub.getCell("C").value = { formula: `B${inAg.number}*B${inTar.number}` };
  for (const r of [cCore, cAna, cSub]) {
    r.getCell("B").numFmt = MONEY; r.getCell("C").numFmt = MONEY;
    r.getCell("E").font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  }
  const cTot = ws.addRow(["TOTAL mensual"]);
  cTot.font = { bold: true };
  cTot.getCell("B").value = { formula: `B${cCore.number}+B${cAna.number}+B${cSub.number}` };
  cTot.getCell("C").value = { formula: `C${cCore.number}+C${cAna.number}+C${cSub.number}` };
  for (const col of ["B", "C"]) { cTot.getCell(col).numFmt = MONEY; cTot.getCell(col).fill = TOTFILL; cTot.getCell(col).font = { bold: true }; }
  const cSave = ws.addRow(["Ahorro en infraestructura AWS (hoy → con ARIA)", null, null, null, "lo que ARIA saca de la factura AWS"]);
  cSave.getCell("C").value = { formula: `B${cAna.number}-C${cAna.number}` };
  cSave.getCell("C").numFmt = MONEY; cSave.getCell("C").fill = SUBFILL; cSave.getCell("E").font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  const cSavePct = ws.addRow(["  · como % de la factura AWS de hoy"]);
  cSavePct.getCell("C").value = { formula: `(B${cAna.number}-C${cAna.number})/B${total.number}` };
  cSavePct.getCell("C").numFmt = PCT;
  ws.addRow([]);
  const note = ws.addRow(["▸ La infraestructura de analítica baja $134.56/mes (−31,5% de la factura AWS). La suscripción ARIA reemplaza ese pipeline (Kinesis→OpenSearch→QuickSight) —que además hay que mantener— y agrega omnicanal, IA y soporte. El software ARIA se compara contra la LICENCIA que reemplaza, no contra el total de AWS."]);
  note.font = { italic: true, color: { argb: "FF4B5563" } }; ws.mergeCells(note.number, 1, note.number, 5);

  // ── Datos para gráficos (fórmulas vivas; el caché numérico es solo para el render inicial) ──
  ws.addRow([]);
  const cd = ws.addRow(["Datos para gráficos (calculados — no editar)"]);
  cd.font = { bold: true, color: { argb: "FF6B7280" } }; ws.mergeCells(cd.number, 1, cd.number, 5);
  const pie = [
    ["Voz", `B${rowOf.vozIn}`],
    ["Analítica (ARIA reemplaza)", `B${subAna.number}`],
    ["Contact Lens", `B${rowOf.cl}`],
    ["DynamoDB", `B${rowOf.ddb}`],
    ["S3 grabaciones", `B${rowOf.s3}`],
    ["Lambda", `B${rowOf.lambda}`],
  ];
  const pieFirst = ws.rowCount + 1;
  for (const [cat, f] of pie) { const r = ws.addRow([cat, null]); r.getCell("B").value = { formula: f }; r.getCell("B").numFmt = MONEY; }
  const otros = ws.addRow(["Otros", null]);
  otros.getCell("B").value = { formula: `B${total.number}-(B${rowOf.vozIn}+B${subAna.number}+B${rowOf.cl}+B${rowOf.ddb}+B${rowOf.s3}+B${rowOf.lambda})` };
  otros.getCell("B").numFmt = MONEY;
  const pieLast = ws.rowCount;
  const stkH = ws.addRow(["(stack)", "Hoy", "Con ARIA"]);
  const stkCore = ws.addRow(["AWS core", null, null]);
  stkCore.getCell("B").value = { formula: `B${cCore.number}` }; stkCore.getCell("C").value = { formula: `C${cCore.number}` };
  const stkAna = ws.addRow(["Analítica AWS", null, null]);
  stkAna.getCell("B").value = { formula: `B${cAna.number}` }; stkAna.getCell("C").value = { formula: `C${cAna.number}` };
  const stkSub = ws.addRow(["Suscripción ARIA", null, null]);
  stkSub.getCell("B").value = { formula: `B${cSub.number}` }; stkSub.getCell("C").value = { formula: `C${cSub.number}` };
  for (const r of [stkCore, stkAna, stkSub]) { r.getCell("B").numFmt = MONEY; r.getCell("C").numFmt = MONEY; }
  const anB = [["QuickSight", `B${rowOf.qs}`], ["Kinesis", `B${rowOf.kinesis}`], ["OpenSearch", `B${rowOf.os}`], ["Athena", `B${rowOf.athena}`]];
  const anFirst = ws.rowCount + 1;
  for (const [cat, f] of anB) { const r = ws.addRow([cat, null]); r.getCell("B").value = { formula: f }; r.getCell("B").numFmt = MONEY; }
  const anLast = ws.rowCount;

  const q = (a1) => `'${UDEP_SHEET}'!${a1}`;
  const subARIA = UDEP.agentes * UDEP.tarifaAria;
  return [
    { type: "pie", title: "¿En qué se va la factura AWS de la UDEP hoy?",
      catF: q(`$A$${pieFirst}:$A$${pieLast}`), catCache: ["Voz", "Analítica (ARIA reemplaza)", "Contact Lens", "DynamoDB", "S3 grabaciones", "Lambda", "Otros"],
      valF: q(`$B$${pieFirst}:$B$${pieLast}`), valCache: [161.20, 134.56, 51.88, 39.20, 23.82, 8.68, 7.59], highlightIdx: 1 },
    { type: "barStacked", title: "Costo mensual: hoy vs. con ARIA",
      catF: q(`$B$${stkH.number}:$C$${stkH.number}`), catCache: ["Hoy", "Con ARIA"],
      series: [
        { name: "AWS core", valF: q(`$B$${stkCore.number}:$C$${stkCore.number}`), valCache: [292.37, 292.37], color: "2563EB" },
        { name: "Analítica AWS (ARIA reemplaza)", valF: q(`$B$${stkAna.number}:$C$${stkAna.number}`), valCache: [134.56, 0], color: "F59E0B" },
        { name: "Suscripción ARIA", valF: q(`$B$${stkSub.number}:$C$${stkSub.number}`), valCache: [0, subARIA], color: "10B981" },
      ] },
    { type: "bar", title: "Infra de analítica que ARIA elimina (USD/mes)",
      catF: q(`$A$${anFirst}:$A$${anLast}`), catCache: ["QuickSight", "Kinesis", "OpenSearch", "Athena"],
      series: [{ name: "USD/mes", valF: q(`$B$${anFirst}:$B$${anLast}`), valCache: [75, 29.76, 28.13, 1.67], color: "F59E0B" }] },
  ];
}

// One-pager HTML autocontenido (SVG pre-renderizado con ECharts SSR — sin JS ni CDN,
// abre offline y sirve para presentar). Misma fuente de datos que la hoja 'UDEP (real)'.
function svgChart(option, w, h) {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: w, height: h });
  chart.setOption(option);
  const svg = chart.renderToSVGString().replace(/^<svg width="\d+" height="\d+"/, `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block"`);
  chart.dispose();
  return svg;
}
async function buildUdepHtml() {
  const sum = (g) => UDEP.lines.filter((l) => (g ? l.group === g : true)).reduce((s, l) => s + l.usd, 0);
  const get = (k) => UDEP.lines.find((l) => l.k === k).usd;
  const total = sum(), core = sum("core"), ana = sum("analytics");
  const subARIA = UDEP.agentes * UDEP.tarifaAria;
  const otros = total - (get("vozIn") + ana + get("cl") + get("ddb") + get("s3") + get("lambda"));
  const m = (x) => "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const BLUE = "#2563EB", AMBER = "#F59E0B", GREEN = "#10B981", SLATE = "#64748B";

  const svgPie = svgChart({
    title: { text: "¿En qué se va la factura AWS de la UDEP hoy?", left: "center", textStyle: { fontSize: 15, fontWeight: 600 } },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [{ type: "pie", radius: ["40%", "64%"], center: ["50%", "44%"],
      label: { formatter: "{d}%", fontSize: 11, fontWeight: 600 }, labelLine: { length: 8, length2: 8 },
      data: [
        { name: "Voz", value: get("vozIn"), itemStyle: { color: BLUE } },
        { name: "Analítica (ARIA reemplaza)", value: ana, itemStyle: { color: AMBER } },
        { name: "Contact Lens", value: get("cl"), itemStyle: { color: "#8B5CF6" } },
        { name: "DynamoDB", value: get("ddb"), itemStyle: { color: "#0EA5E9" } },
        { name: "S3 grabaciones", value: get("s3"), itemStyle: { color: "#14B8A6" } },
        { name: "Lambda", value: get("lambda"), itemStyle: { color: "#F472B6" } },
        { name: "Otros", value: otros, itemStyle: { color: SLATE } },
      ] }],
  }, 560, 440);

  const svgStack = svgChart({
    title: { text: "Costo mensual: hoy vs. con ARIA", left: "center", textStyle: { fontSize: 15, fontWeight: 600 } },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 64, right: 20, top: 50, bottom: 70 },
    xAxis: { type: "category", data: ["Hoy (DIY)", "Con ARIA"], axisLabel: { fontWeight: 600 } },
    yAxis: { type: "value", axisLabel: { formatter: "${value}" } },
    series: [
      { name: "AWS core", type: "bar", stack: "t", data: [core, core], color: BLUE },
      { name: "Analítica AWS (ARIA reemplaza)", type: "bar", stack: "t", data: [ana, 0], color: AMBER, label: { show: true, formatter: (p) => (p.value ? m(p.value) : ""), color: "#7c2d12", fontSize: 10 } },
      { name: "Suscripción ARIA", type: "bar", stack: "t", data: [0, subARIA], color: GREEN, label: { show: true, formatter: (p) => (p.value ? m(p.value) : ""), color: "#064e3b", fontSize: 10 } },
    ],
  }, 560, 400);

  const svgBar = svgChart({
    title: { text: "Infra de analítica que ARIA elimina (USD/mes)", left: "center", textStyle: { fontSize: 15, fontWeight: 600 } },
    grid: { left: 60, right: 24, top: 50, bottom: 40 },
    xAxis: { type: "category", data: ["QuickSight", "Kinesis", "OpenSearch", "Athena"] },
    yAxis: { type: "value", axisLabel: { formatter: "${value}" } },
    series: [{ type: "bar", color: AMBER, data: [get("qs"), get("kinesis"), get("os"), get("athena")],
      label: { show: true, position: "top", formatter: (p) => m(p.value), fontSize: 11 } }],
  }, 560, 360);

  const kpi = (label, value, sub, accent) =>
    `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value" style="color:${accent}">${value}</div><div class="kpi-sub">${sub}</div></div>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UDEP — costos hoy vs. con ARIA</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc}
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 24px 56px}
  h1{font-size:24px;margin:0 0 4px} .sub{color:var(--muted);margin:0 0 24px;font-size:14px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:26px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .kpi-label{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
  .kpi-value{font-size:26px;font-weight:700;margin:6px 0 2px} .kpi-sub{font-size:12px;color:var(--muted)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px}
  .card.full{grid-column:1 / -1}
  .note{background:#fff;border:1px solid var(--line);border-left:4px solid ${AMBER};border-radius:12px;padding:16px 18px;margin-top:18px;font-size:14px;line-height:1.55;color:#334155}
  .foot{color:var(--muted);font-size:12px;margin-top:22px}
  @media(max-width:760px){.kpis{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
  <h1>UDEP — caso real: factura AWS hoy vs. con ARIA</h1>
  <p class="sub">Factura real de Amazon Connect (1 mes, us-east-1) · escala ~${UDEP.agentes} agentes · telefonía $0 en AWS (BYOC).</p>
  <div class="kpis">
    ${kpi("Factura AWS hoy", m(total), "todo en su cuenta", BLUE)}
    ${kpi("ARIA saca de AWS", "−" + m(ana), `−${((ana / total) * 100).toFixed(1)}% de la factura`, AMBER)}
    ${kpi("Factura AWS con ARIA", m(core), "sin stack de analítica", GREEN)}
    ${kpi("Suscripción ARIA", m(subARIA), `${UDEP.agentes} ag × ${m(UDEP.tarifaAria)}`, "#0f172a")}
  </div>
  <div class="grid">
    <div class="card">${svgPie}</div>
    <div class="card">${svgStack}</div>
    <div class="card full">${svgBar}</div>
  </div>
  <div class="note"><b>Lectura:</b> la infraestructura de analítica nativa de AWS (QuickSight + Kinesis + OpenSearch + Athena = ${m(ana)}/mes, el ${((ana / total) * 100).toFixed(1)}% de la factura) la reemplaza el dashboard de ARIA. La suscripción ARIA cubre ese pipeline —que además hay que <b>mantener</b>— y suma omnicanal, IA y soporte. El software ARIA se compara contra la licencia que reemplaza, no contra el total de AWS. Validación: cada precio unitario de la factura (voz $0.018/min, chat $0.004/msg, Contact Lens, DynamoDB, S3, secretos) coincide exacto con el modelo de costos.</div>
  <p class="foot">Generado por scripts/gen-costos-xlsx.mjs · gráficos nativos editables también en la hoja “UDEP (real)” de aria-costos.xlsx.</p>
</div></body></html>`;
  await fsWriteFile(OUT_HTML, html);
}

const udepSpecs = buildUdepSheet(wb);

// reordenar: Léeme y 'UDEP (real)' al frente (ExcelJS ordena las pestañas por 'orderNo').
wb.eachSheet((ws) => {
  ws.orderNo = ws.name === "Léeme" ? -2 : ws.name === UDEP_SHEET ? -1 : ws.orderNo;
});

await wb.xlsx.writeFile(OUT);
await injectUdepCharts(OUT, udepSpecs);
await buildUdepHtml();
console.log("✅ Generado:", OUT, "(+ hoja 'UDEP (real)' con 3 gráficos nativos)");
console.log("✅ Generado:", OUT_HTML, "(one-pager UDEP hoy vs. ARIA)");

// ═══════════════════ VERIFICADOR NUMÉRICO (mismo modelo, en JS) ═══════════════════
// Recalcula los totales con los mismos números para imprimir un resumen y para que
// el .md de costos reporte cifras fieles. Si esto difiere de la hoja, hay un bug.
const g = (key, i) => PARAMS[key][i];
const fmt = (x) => "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x) => (x * 100).toFixed(1) + "%";
const names = ["Piloto", "Pyme", "Enterprise"];

console.log("\n──────── Verificación numérica (USD/mes) ────────");
for (let i = 0; i < 3; i++) {
  const clientAws = CLIENT_LINES.filter((l) => !l.external).reduce((s, l) => s + l.n(g, i), 0);
  const sf = CLIENT_LINES.filter((l) => l.external).reduce((s, l) => s + l.n(g, i), 0);
  const platform = PLATFORM_LINES.reduce((s, l) => s + l.n(g, i), 0);
  const ag = g("agentes", i);
  const clientPA = clientAws / ag;
  const platformPA = platform / ag;
  const serve = platformPA + OPEX[i];
  const tarifa = TARIFA[i];
  const ingreso = tarifa * ag;
  const margenBruto = (tarifa - serve) / tarifa;
  const margenContrib = (ingreso - platform) / ingreso;
  const utilidad = (tarifa - serve) * ag;
  console.log(`\n${names[i]} (${ag} agentes):`);
  console.log(`  Cliente AWS (BYO, sin SF):  ${fmt(clientAws)}   · por agente ${fmt(clientPA)}`);
  console.log(`  Salesforce (externo):       ${fmt(sf)}`);
  console.log(`  Plataforma ARIA:            ${fmt(platform)}   · por agente ${fmt(platformPA)}`);
  console.log(`  Tarifa/agente ${fmt(tarifa)} · opex ${fmt(OPEX[i])} · costo de servir ${fmt(serve)}`);
  console.log(`  Ingreso ARIA/tenant: ${fmt(ingreso)} · Utilidad bruta ${fmt(utilidad)}`);
  console.log(`  Margen BRUTO (incl opex): ${pct(margenBruto)} · Contribución (infra): ${pct(margenContrib)}`);
}
console.log("\n(Para cobertura NO-BYO ver sección D de la hoja 'PrecioARIA'.)");

// UDEP — caso real (alimenta la hoja 'UDEP (real)' y el one-pager HTML)
const uTotal = UDEP.lines.reduce((s, l) => s + l.usd, 0);
const uAna = UDEP.lines.filter((l) => l.group === "analytics").reduce((s, l) => s + l.usd, 0);
const uCore = uTotal - uAna;
const uSub = UDEP.agentes * UDEP.tarifaAria;
console.log("\n──────── UDEP (caso real, 1 mes) ────────");
console.log(`  Factura AWS hoy: ${fmt(uTotal)} · analítica que ARIA reemplaza ${fmt(uAna)} (${pct(uAna / uTotal)})`);
console.log(`  Con ARIA: AWS core ${fmt(uCore)} + suscripción ${fmt(uSub)} (${UDEP.agentes} ag × ${fmt(UDEP.tarifaAria)}) = ${fmt(uCore + uSub)}`);
