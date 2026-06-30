import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";
import { normalizePhone } from "../_shared/phone";

/**
 * get-hsm-report — the HSM (WhatsApp template) Outbound report (roadmap #6),
 * Chattigo's most-detailed report. Aggregates connectview-hsm-sends by
 * template: sent / delivered / read / failed / expired / pending, plus
 * response & conversion when available. delivered/read/failed are filled by
 * the status events (roadmap #14); until then they read 0 and only "sent"
 * is populated, which is already a useful volume-by-template report.
 *
 * Pilar 9 · Fase C (R16/R17): además del agregado por plantilla, devuelve el
 * detalle POR NÚMERO (cliente) y la TASA DE RESPUESTA + TIEMPO DE 1ª RESPUESTA,
 * cruzando los envíos (outbound) con el inbound de WhatsApp del inbox omnicanal
 * (connectview-conversations, Pilar 6). Caveat: para números anclados a Connect
 * el inbound vive en Connect (no en conversations) → ahí la respuesta no se mide.
 */
// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "connectview-conversations";

const CORS = { "Content-Type": "application/json" };

interface Row {
  templateName?: string;
  status?: string;
  sentAt?: string;
  language?: string;
  phone?: string;
}

const phoneKey = (p?: string): string => (p ? normalizePhone(p)?.e164 || p : "");

/** Por número: junta los timestamps de mensajes ENTRANTES de WhatsApp del inbox
 *  (connectview-conversations) → para detectar respuesta y medir 1ª respuesta.
 *  Best-effort: si la tabla no existe o no hay acceso, devuelve un mapa vacío. */
async function inboundTimesByPhone(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  try {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({ TableName: CONVERSATIONS_TABLE, ExclusiveStartKey: lastKey as never }),
      );
      for (const it of res.Items || []) {
        const c = unmarshall(it) as {
          channel?: string;
          phone?: string;
          senderId?: string;
          messages?: Array<{ direction?: string; ts?: string }>;
        };
        if (c.channel && c.channel !== "whatsapp") continue;
        const key = phoneKey(c.phone || c.senderId);
        if (!key) continue;
        const ins = (c.messages || [])
          .filter((m) => m.direction === "in" && m.ts)
          .map((m) => m.ts as string);
        if (ins.length) map.set(key, [...(map.get(key) || []), ...ins]);
      }
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    for (const [, arr] of map) arr.sort();
  } catch {
    /* sin inbox / sin acceso → sin métricas de respuesta */
  }
  return map;
}

const STATUSES = ["sent", "delivered", "read", "failed", "expired", "pending"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    // Scan the whole table (send volumes are modest; paginate if it grows).
    const rows: Row[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: HSM_TABLE,
          ExclusiveStartKey: lastKey as never,
        }),
      );
      for (const it of res.Items || []) rows.push(unmarshall(it) as Row);
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const byTemplate = new Map<
      string,
      { template: string; lastSentAt: string } & Record<string, number>
    >();
    // Pilar 9 Fase C — detalle por número (cliente).
    interface PhoneAgg {
      phone: string;
      sends: number;
      delivered: number;
      read: number;
      failed: number;
      lastTemplate: string;
      lastSentAt: string;
      firstSentAt: string;
      lastStatus: string;
    }
    const byPhone = new Map<string, PhoneAgg>();
    const totals: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    totals.total = 0;

    for (const r of rows) {
      const tpl = r.templateName || "(sin nombre)";
      if (!byTemplate.has(tpl)) {
        const seed: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
        byTemplate.set(tpl, { template: tpl, lastSentAt: "", ...seed });
      }
      const agg = byTemplate.get(tpl)!;
      // Every row counts as a send; its current status bumps that bucket too.
      const st = (r.status || "sent").toLowerCase();
      if (STATUSES.includes(st as never)) {
        agg[st] = (agg[st] || 0) + 1;
        totals[st] = (totals[st] || 0) + 1;
      }
      totals.total += 1;
      if (r.sentAt && r.sentAt > (agg.lastSentAt || "")) agg.lastSentAt = r.sentAt;

      // Por número.
      const pk = phoneKey(r.phone);
      if (pk) {
        if (!byPhone.has(pk)) {
          byPhone.set(pk, {
            phone: pk,
            sends: 0,
            delivered: 0,
            read: 0,
            failed: 0,
            lastTemplate: "",
            lastSentAt: "",
            firstSentAt: "",
            lastStatus: "",
          });
        }
        const p = byPhone.get(pk)!;
        p.sends += 1;
        if (st === "delivered") p.delivered += 1;
        if (st === "read") p.read += 1;
        if (st === "failed") p.failed += 1;
        if (r.sentAt) {
          if (r.sentAt > (p.lastSentAt || "")) {
            p.lastSentAt = r.sentAt;
            p.lastTemplate = tpl;
            p.lastStatus = st;
          }
          if (!p.firstSentAt || r.sentAt < p.firstSentAt) p.firstSentAt = r.sentAt;
        }
      }
    }

    const templates = [...byTemplate.values()].sort((a, b) => (b.sent || 0) - (a.sent || 0));

    // Pilar 9 Fase C — respuesta + 1ª respuesta: cruza el inbound de WhatsApp.
    const inbound = await inboundTimesByPhone();
    let respondedPhones = 0;
    const frtSecs: number[] = [];
    const phones = [...byPhone.values()].map((p) => {
      const ins = inbound.get(p.phone) || [];
      const firstReply = p.firstSentAt ? ins.find((t) => t >= p.firstSentAt) : undefined;
      let firstResponseSec: number | null = null;
      if (firstReply && p.firstSentAt) {
        const sec = Math.round(
          (new Date(firstReply).getTime() - new Date(p.firstSentAt).getTime()) / 1000,
        );
        if (sec >= 0 && sec <= 14 * 24 * 3600) {
          firstResponseSec = sec;
          frtSecs.push(sec);
        }
      }
      const responded = !!firstReply;
      if (responded) respondedPhones += 1;
      return { ...p, responded, firstResponseSec };
    });
    const sentPhones = phones.length;
    const response = {
      sentPhones,
      respondedPhones,
      responseRate: sentPhones ? respondedPhones / sentPhones : 0,
      avgFirstResponseSec: frtSecs.length
        ? Math.round(frtSecs.reduce((a, b) => a + b, 0) / frtSecs.length)
        : null,
      inboundTracked: inbound.size > 0,
    };
    const byPhoneList = phones
      .sort(
        (a, b) =>
          (b.sends || 0) - (a.sends || 0) || (b.lastSentAt || "").localeCompare(a.lastSentAt || ""),
      )
      .slice(0, 60);

    // Embudo: "leído" implica "entregado" (delivered ⊇ read, como Chattigo). Los
    // buckets guardan el ÚLTIMO estado (mutuamente excluyentes), así que el
    // "entregado del embudo" = delivered + read. readRate = leídos / entregados.
    const deliveredFunnel = (totals.delivered || 0) + (totals.read || 0);
    const readRate = deliveredFunnel > 0 ? Math.round((totals.read / deliveredFunnel) * 100) : 0;
    const failRate = totals.total > 0 ? Math.round((totals.failed / totals.total) * 100) : 0;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        totals,
        templates,
        rates: { readRate, failRate },
        byPhone: byPhoneList,
        response,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("get-hsm-report error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "report failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
