/**
 * hsmStatus — ciclo de vida de entrega de un HSM (Pilar 4 · R5/#14).
 *
 * Avanza el `status` de un envío en `connectview-hsm-sends` (PK=sendId=messageId)
 * a medida que llegan los recibos de Meta (sent→delivered→read, o failed/expired).
 * Lo llaman: `whatsapp-meta-webhook` (eventos `value.statuses[]` de Meta Cloud API
 * directa, números meta-standalone) y —a futuro— un handler de SNS para AWS End
 * User Messaging si el cliente desancla el número de Connect.
 *
 * Idempotente y a prueba de desorden: cada estado tiene un `statusRank`; un
 * UpdateItem condicional SOLO avanza (un "delivered" tardío no pisa un "read").
 * `attribute_exists(sendId)` ⇒ nunca crea un row fantasma para un id desconocido
 * (p.ej. de otro tenant/data-plane).
 */
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";

export type HsmStatus = "sent" | "delivered" | "read" | "failed" | "expired" | "pending";

// Orden de avance. failed/expired = terminal (gana sobre todo: es la señal que importa).
const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, expired: 5, failed: 5 };

interface MetaError {
  code?: number | string;
  title?: string;
  error_data?: { details?: string };
}

/** Code de Meta → causa legible (categorizada para el reporte y la acción). */
export function categorizeFailure(code?: number | string, title?: string): string {
  const c = Number(code);
  switch (c) {
    case 131026: // Message undeliverable (no es usuario de WhatsApp / número equivocado)
    case 130472: // User's number is part of an experiment / undeliverable
      return "número inválido";
    case 131031: // Business account locked
    case 131045: // Recipient blocked / cannot be reached
      return "bloqueado";
    case 131047: // Re-engagement message (fuera de la ventana de 24h)
    case 131048: // Spam rate limit
    case 470: // Message failed to send (re-engagement window)
      return "fuera de ventana 24h";
    case 132000:
    case 132001:
    case 132005:
    case 132007:
    case 132012:
    case 132015:
      return "plantilla pausada/inválida";
    case 131056: // Pair rate limit
    case 131049:
      return "límite de frecuencia (Meta)";
    default:
      return title ? String(title).slice(0, 80) : "fallo de entrega";
  }
}

/** ¿La falla es PERMANENTE por el número (→ cuarentena)? vs transitoria (ventana/rate). */
export function isPermanentNumberFailure(code?: number | string): boolean {
  const c = Number(code);
  // Número inválido / equivocado / bloqueado → no vale reintentar, se cuarentena.
  return c === 131026 || c === 130472 || c === 131045;
}

export interface StatusUpdateResult {
  updated: boolean;
  status: HsmStatus;
  isPermanentFailure: boolean;
  reason?: string;
}

/**
 * Avanza el estado de un HSM por messageId. No retrocede (statusRank), no crea
 * rows fantasma (attribute_exists). Devuelve si hubo falla permanente (para
 * disparar la cuarentena en el caller).
 */
export async function updateHsmStatus(
  dynamo: DynamoDBClient,
  messageId: string,
  status: HsmStatus,
  opts: { errors?: MetaError[] } = {}
): Promise<StatusUpdateResult> {
  const rank = RANK[status] ?? 1;
  const now = new Date().toISOString();
  const err = opts.errors?.[0];
  const failureReason = status === "failed" || status === "expired" ? categorizeFailure(err?.code, err?.title) : undefined;
  const failureCode = err?.code != null ? String(err.code) : undefined;
  const isPermanentFailure = status === "failed" && isPermanentNumberFailure(err?.code);

  const sets = ["#s = :status", "statusRank = :rank", "statusAt = :now"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vals: Record<string, any> = {
    ":status": { S: status },
    ":rank": { N: String(rank) },
    ":now": { S: now },
  };
  if (failureReason) { sets.push("failureReason = :fr"); vals[":fr"] = { S: failureReason }; }
  if (failureCode) { sets.push("failureCode = :fc"); vals[":fc"] = { S: failureCode }; }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: HSM_TABLE,
        Key: { sendId: { S: messageId } },
        UpdateExpression: "SET " + sets.join(", "),
        // existe el envío Y (sin rank previo O el nuevo es mayor) → solo avanza.
        ConditionExpression: "attribute_exists(sendId) AND (attribute_not_exists(statusRank) OR statusRank < :rank)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: vals,
      })
    );
    return { updated: true, status, isPermanentFailure, reason: failureReason };
  } catch (e) {
    // ConditionalCheckFailed = id desconocido en esta tabla, o estado más viejo → no-op.
    if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
      return { updated: false, status, isPermanentFailure, reason: failureReason };
    }
    console.warn("updateHsmStatus failed:", e instanceof Error ? e.message : e);
    return { updated: false, status, isPermanentFailure: false };
  }
}
