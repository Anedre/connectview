/**
 * scheduled-export-runner — corre los exports programados (#7).
 *
 * Dual-entry:
 *  · EventBridge tick (rate 1h): escanea connectview-scheduled-exports por jobs
 *    enabled con nextRunAt <= now y corre cada uno.
 *  · Invoke directo { runNow: exportId }: corre ese job ya (botón "Generar ahora").
 *
 * Correr un job = consultar el dataset (v1: leads) → armar XLSX con exceljs →
 * mandarlo como adjunto por SES (email MIME raw) a los destinatarios → actualizar
 * lastRunAt / lastStatus / nextRunAt.
 */
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import ExcelJS from "exceljs";

const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});

const EXPORTS_TABLE = process.env.EXPORTS_TABLE || "connectview-scheduled-exports";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const FROM_EMAIL = process.env.FROM_EMAIL || "ARIA Reportes <reportes@novasys.com.pe>";

interface ScheduledExport {
  exportId: string;
  tenantId?: string;
  name: string;
  dataset: string; // "leads" (v1)
  frequency: "daily" | "weekly" | "monthly";
  hourUtc: number;
  recipients: string[];
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
}

function nowIso() {
  return new Date().toISOString();
}

/** Próxima corrida: la siguiente ocurrencia de hourUtc según la frecuencia. */
export function computeNextRun(freq: string, hourUtc: number, fromMs: number): string {
  const d = new Date(fromMs);
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0, 0),
  );
  if (next.getTime() <= fromMs) {
    if (freq === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else if (freq === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

/** Escanea TODOS los leads (pooled / Novasys) y los devuelve como filas. */
async function fetchLeads(): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await dynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of r.Items || []) rows.push(unmarshall(it));
    lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return rows;
}

interface SheetSpec {
  title: string;
  columns: { header: string; key: string; width?: number }[];
  rows: Record<string, unknown>[];
}

/** Especifica el contenido del XLSX según el dataset. */
async function buildSheet(dataset: string): Promise<SheetSpec> {
  if (dataset === "leads") {
    const leads = await fetchLeads();
    return {
      title: "Leads",
      columns: [
        { header: "Nombre", key: "name", width: 26 },
        { header: "Teléfono", key: "phone", width: 16 },
        { header: "Email", key: "email", width: 28 },
        { header: "Empresa", key: "company", width: 24 },
        { header: "Origen", key: "source", width: 16 },
        { header: "Etapa", key: "stageId", width: 18 },
        { header: "Creado", key: "createdAt", width: 22 },
        { header: "Actualizado", key: "updatedAt", width: 22 },
      ],
      rows: leads.map((l) => ({
        name: l.name || "",
        phone: l.phone || "",
        email: l.email || "",
        company: l.company || "",
        source: l.source || "",
        stageId: l.stageId || "",
        createdAt: l.createdAt || "",
        updatedAt: l.updatedAt || "",
      })),
    };
  }
  // dataset desconocido → hoja vacía con un aviso.
  return {
    title: "Export",
    columns: [{ header: "Aviso", key: "msg", width: 50 }],
    rows: [{ msg: `Dataset '${dataset}' no soportado aún.` }],
  };
}

/** Genera el XLSX como Buffer. */
async function buildXlsx(spec: SheetSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ARIA";
  const ws = wb.addWorksheet(spec.title);
  ws.columns = spec.columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C5698" } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (const r of spec.rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** Construye un email MIME multipart con el XLSX adjunto. */
function buildRawEmail(
  to: string[],
  subject: string,
  bodyText: string,
  filename: string,
  xlsx: Buffer,
): Buffer {
  const boundary = "ARIA_BOUNDARY_" + Math.floor(xlsx.length).toString(36);
  const b64 = xlsx.toString("base64").replace(/(.{76})/g, "$1\r\n");
  const lines = [
    `From: ${FROM_EMAIL}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    "",
    `--${boundary}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64,
    "",
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

/** Corre un job: dataset → XLSX → email. Devuelve un resumen. */
async function runExport(
  job: ScheduledExport,
): Promise<{ ok: boolean; rows: number; messageId?: string; error?: string }> {
  try {
    const spec = await buildSheet(job.dataset);
    const xlsx = await buildXlsx(spec);
    const date = nowIso().slice(0, 10);
    const filename = `${job.dataset}-${date}.xlsx`;
    const subject = `${job.name} — ${date}`;
    const body = `Adjunto el export programado "${job.name}" (${spec.rows.length} filas) generado por ARIA el ${date}.`;
    const raw = buildRawEmail(job.recipients, subject, body, filename, xlsx);
    const res = await ses.send(new SendEmailCommand({ Content: { Raw: { Data: raw } } }));
    return { ok: true, rows: spec.rows.length, messageId: res.MessageId };
  } catch (err) {
    return { ok: false, rows: 0, error: err instanceof Error ? err.message : "error" };
  }
}

async function persistResult(job: ScheduledExport, result: { ok: boolean; error?: string }) {
  const now = nowIso();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EXPORTS_TABLE,
      Key: { exportId: { S: job.exportId } },
      UpdateExpression:
        "SET lastRunAt = :r, lastStatus = :s, nextRunAt = :n, lastError = :e, updatedAt = :u",
      ExpressionAttributeValues: marshall({
        ":r": now,
        ":s": result.ok ? "ok" : "error",
        ":n": computeNextRun(job.frequency, job.hourUtc, Date.now()),
        ":e": result.error || "",
        ":u": now,
      }),
    }),
  );
}

async function loadJob(exportId: string): Promise<ScheduledExport | null> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: EXPORTS_TABLE, Key: { exportId: { S: exportId } } }),
  );
  return r.Item ? (unmarshall(r.Item) as ScheduledExport) : null;
}

async function dueJobs(): Promise<ScheduledExport[]> {
  const now = nowIso();
  const out: ScheduledExport[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await dynamo.send(
      new ScanCommand({
        TableName: EXPORTS_TABLE,
        FilterExpression: "enabled = :t AND nextRunAt <= :now",
        ExpressionAttributeValues: marshall({ ":t": true, ":now": now }),
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of r.Items || []) out.push(unmarshall(it) as ScheduledExport);
    lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any): Promise<unknown> => {
  // Run now (invoke directo o vía manage).
  if (event?.runNow) {
    const job = await loadJob(String(event.runNow));
    if (!job) return { ok: false, error: "job no existe" };
    const result = await runExport(job);
    await persistResult(job, result);
    return result;
  }
  // Tick — corre los vencidos.
  const jobs = await dueJobs();
  const results: Record<string, unknown>[] = [];
  for (const job of jobs) {
    const result = await runExport(job);
    await persistResult(job, result);
    results.push({ exportId: job.exportId, ...result });
  }
  console.log("scheduled-export-runner tick:", { due: jobs.length });
  return { due: jobs.length, results };
};
