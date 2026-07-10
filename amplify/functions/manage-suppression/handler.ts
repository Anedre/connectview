import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";
import { getIdentity, resolveTenantId } from "../_shared/cognitoAuth";
import {
  evaluateBatch,
  getRules,
  getSuppression,
  listSuppression,
  recordSuppression,
  removeSuppression,
  saveRules,
  type SuppressionChannel,
  type SuppressionRules,
  type SuppressionStatus,
} from "../_shared/suppression";

/**
 * manage-suppression — CRUD de la lista de supresión / DNC (Pilar 3 · R6).
 *
 * La _enforcement_ vive en la lib `_shared/suppression.ts` (gate en proceso por
 * el que pasa cada envío). Este Lambda es solo la config/administración de la
 * lista (camino frío, raro): ver la DNC, agregar un "no contactar" manual,
 * quitar un número (re-alta). Ver design/pilar-3-supresion.md.
 *
 * Tabla: connectview-suppression (PK = phone digits).
 *
 * GET    [?phone=NUM]        → lista DNC (o una entrada si ?phone=)
 * POST   { phone, status?, channels?, reason?, actor? }   → upsert manual (default DNC, todos los canales)
 * POST   { action:"remove", phone }                       → quita de la lista
 * DELETE ?phone=NUM          → quita de la lista
 *
 * Auth/BYO: resolveDynamo (write no-op sin Cognito Bearer; data plane del tenant).
 * La capability `manage_suppression` gatea la UI (Admins por defecto).
 */
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CORS = { "Content-Type": "application/json" };

const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

const VALID_STATUS: SuppressionStatus[] = ["opted_out", "quarantined", "dnc"];
const VALID_CHANNELS = ["whatsapp", "voice", "email", "all"];
const clampHour = (h: unknown) => Math.min(23, Math.max(0, Math.floor(Number(h) || 0)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  // SEC-A5: gate de rol. La lista Do-Not-Contact es compliance (Meta) y su edición
  // bloquea/desbloquea el contacto de un número → operación privilegiada. Antes sólo
  // había aislamiento por-tenant: cualquier usuario autenticado del tenant podía ver
  // y tocar la DNC. Ahora exigimos el grupo Cognito "Admins" (mismo patrón que
  // list-users/manage-connections). El Function URL es auth=NONE → validamos aquí.
  let identity;
  try {
    identity = await getIdentity(event?.headers);
  } catch {
    return bad(401, "no autenticado");
  }
  if (!identity?.groups?.includes("Admins"))
    return bad(403, "Solo un Admin puede gestionar la supresión.");

  // BYO Data Plane: tenant primero, fallback a Vox pooled.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    if (method === "GET") {
      // Política del tenant (reglas de dedup/frecuencia/quiet-hours).
      if (params.rules) {
        const tenantId = await resolveTenantId(event?.headers);
        const rules = await getRules(dynamo, tenantId);
        return ok({ rules });
      }
      if (params.phone) {
        const entry = await getSuppression(dynamo, String(params.phone));
        return ok({ entry });
      }
      const entries = await listSuppression(dynamo, { limit: 5000 });
      return ok({ entries, count: entries.length });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const actor = typeof body.actor === "string" ? body.actor : "unknown";

      // ── Quitar de la lista (re-alta / corrección) ────────────────────────
      if (body.action === "remove") {
        const phone = String(body.phone || "").trim();
        if (!phone) return bad(400, "phone requerido");
        const removed = await removeSuppression(dynamo, phone);
        return ok({ removed, phone });
      }

      // ── Guardar la política del tenant (reglas) ──────────────────────────
      if (body.action === "saveRules") {
        const tenantId = await resolveTenantId(event?.headers);
        if (!tenantId) return bad(401, "no autorizado (sin tenant)");
        const p = (body.rules || {}) as Partial<SuppressionRules>;
        const clean: Partial<SuppressionRules> = {
          dedupWindowDays:
            p.dedupWindowDays == null
              ? undefined
              : Math.max(0, Math.floor(Number(p.dedupWindowDays) || 0)),
          freqCaps: Array.isArray(p.freqCaps)
            ? p.freqCaps
                .filter((f) => f && f.channel)
                .map((f) => ({
                  channel: String(f.channel),
                  max: Math.max(0, Math.floor(Number(f.max) || 0)),
                  windowDays: Math.max(1, Math.floor(Number(f.windowDays) || 7)),
                }))
            : undefined,
          quietHours: Array.isArray(p.quietHours)
            ? p.quietHours
                .filter((q) => q && q.channel)
                .map((q) => ({
                  channel: String(q.channel),
                  startHour: clampHour(q.startHour),
                  endHour: clampHour(q.endHour),
                  timezone: String(q.timezone || "America/Lima"),
                  daysOfWeek: Array.isArray(q.daysOfWeek)
                    ? q.daysOfWeek.map(Number).filter((d) => d >= 0 && d <= 6)
                    : undefined,
                }))
            : undefined,
          suppressAfterConversion:
            typeof p.suppressAfterConversion === "boolean" ? p.suppressAfterConversion : undefined,
        };
        const rules = await saveRules(dynamo, tenantId, clean, actor);
        return ok({ rules, saved: true });
      }

      // ── Preview honesto: "de N se excluyen M" (wizard de campañas) ───────
      if (body.action === "previewBatch") {
        const tenantId = await resolveTenantId(event?.headers);
        const phones = (Array.isArray(body.phones) ? body.phones : [])
          .map(String)
          .filter(Boolean)
          .slice(0, 5000);
        const channel = (
          ["whatsapp", "voice", "email"].includes(body.channel) ? body.channel : "whatsapp"
        ) as SuppressionChannel;
        const summary = await evaluateBatch(dynamo, phones, {
          channel,
          tenantId,
          programId: typeof body.programId === "string" ? body.programId : undefined,
        });
        return ok({ summary });
      }

      // ── Upsert manual (default: DNC en todos los canales) ────────────────
      const phone = String(body.phone || "").trim();
      if (!phone) return bad(400, "phone requerido");
      const status: SuppressionStatus = VALID_STATUS.includes(body.status) ? body.status : "dnc";
      const channels: string[] = Array.isArray(body.channels)
        ? body.channels.map(String).filter((c: string) => VALID_CHANNELS.includes(c))
        : ["all"];
      const entry = await recordSuppression(dynamo, phone, {
        status,
        channels: channels.length ? channels : ["all"],
        reason:
          typeof body.reason === "string" && body.reason.trim()
            ? body.reason.trim()
            : "Bloqueo manual",
        source: "manual",
        createdBy: actor,
      });
      if (!entry) return bad(500, "no se pudo guardar (¿teléfono inválido o sin permisos?)");
      return ok({ entry, saved: true });
    }

    if (method === "DELETE") {
      if (!params.phone) return bad(400, "phone requerido");
      const removed = await removeSuppression(dynamo, String(params.phone));
      return ok({ removed, phone: params.phone });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-suppression error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
