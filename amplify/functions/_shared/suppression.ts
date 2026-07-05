/**
 * suppression — motor central de supresión / consentimiento (Pilar 3, R6).
 *
 * UNA librería compartida por la que pasa TODO envío saliente antes de salir.
 * Convierte la dedup manual de Adriana en garantía por política + compliance
 * Meta (opt-out/STOP, cuarentena de número, do-not-contact).
 *
 * Decisión de arquitectura (design/pilar-3-supresion.md §2): el gate es esta
 * lib en proceso (patrón leadSync/phone), NO un Lambda con hop de red. El
 * cliente DynamoDB se pasa EXPLÍCITO a cada función (cada sender ya lo resolvió
 * con resolveDynamo) → sin estado de módulo oculto, testeable.
 *
 * Tabla `connectview-suppression` (PK = phone digits normalizados). El teléfono
 * —no el lead— es la clave: un número que escribe STOP puede no ser lead aún, y
 * el opt-out debe respetarse igual y sobrevivir a la rotación de leads.
 *
 * FASE A (este archivo): solo causas DURAS — opt_out / quarantine / dnc,
 * channel-scoped. La Fase B suma dedup-window (R6) + frequency + quiet-hours +
 * converted leyendo `connectview-suppression-rules` + GSI byPhone de hsm-sends.
 *
 * Fail-open por diseño: si la lectura de la tabla falla (no creada / AccessDenied
 * / throttle), NO bloqueamos el envío — un error de infra no debe frenar TODO el
 * outbound. La compliance se enforce cuando la tabla está sana; el error se loguea.
 */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { normalizePhone } from "./phone";

const SUPPRESSION_TABLE = process.env.SUPPRESSION_TABLE || "connectview-suppression";
const RULES_TABLE = process.env.SUPPRESSION_RULES_TABLE || "connectview-suppression-rules";
const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";
const DAY_MS = 86_400_000;

/** Canales sobre los que el motor decide. WhatsApp-first en v1 (R6 + activo frágil). */
export type SuppressionChannel = "whatsapp" | "voice" | "email";

/** Por qué un número está en la lista. Todas son bloqueo DURO (channel-scoped).
 *  "converted" = lead ganado: no recontactar (Fase C, gated por la regla
 *  suppressAfterConversion; se escribe al cerrar la gestión). */
export type SuppressionStatus = "opted_out" | "quarantined" | "dnc" | "converted";

export interface SuppressionEntry {
  /** PK — dígitos normalizados (de _shared/phone.ts), clave natural cross-lead. */
  phone: string;
  /** Forma legible "+51999…". */
  e164?: string;
  status: SuppressionStatus;
  /** Canales suprimidos: ["whatsapp"] | ["voice"] | ["all"] | combinación. */
  channels: string[];
  reason?: string;
  source: "inbound_keyword" | "status_webhook" | "manual" | "import" | "conversion";
  tenantId?: string;
  /** Lead ligado, si se pudo resolver (conveniencia para la UI). */
  leadId?: string;
  createdAt: string;
  createdBy?: string;
  /** Opcional: cuarentena temporal. Opt-out = permanente (sin expiresAt). */
  expiresAt?: string;
}

/** Causa del bloqueo. Fase A = las tres duras; el resto entra en Fase B. */
export type BlockReason =
  | "opt_out"
  | "quarantine"
  | "dnc"
  | "dedup_window"
  | "frequency"
  | "quiet_hours"
  | "converted";

export interface SendVerdict {
  allowed: boolean;
  blockedBy?: BlockReason;
  detail?: string;
}

/** Tope de frecuencia por canal: máx N envíos en una ventana de días. */
export interface FreqCap {
  channel: string; // "whatsapp" | "all"
  max: number; // 0 = sin tope
  windowDays: number;
}

/** Quiet hours por canal: no contactar fuera de [startHour, endHour) en la TZ. */
export interface QuietHours {
  channel: string;
  startHour: number; // 0-23
  endHour: number; // 0-23 (exclusivo)
  timezone: string; // "America/Lima"
  daysOfWeek?: number[]; // 0=Dom … 6=Sáb; vacío = todos
}

/** Política de supresión por tenant (1 doc). connectview-suppression-rules. */
export interface SuppressionRules {
  tenantId: string;
  /** R6: no reenviar al mismo número en N días. 1 = "mismo día". 0 = desactivado. */
  dedupWindowDays?: number;
  freqCaps?: FreqCap[];
  quietHours?: QuietHours[];
  /** No contactar leads ya convertidos (se evalúa en el preview batch). */
  suppressAfterConversion?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

/** Default cuando el tenant no configuró reglas: anti-doble-envío 1 día (R6 out-of-the-box). */
const DEFAULT_RULES: Omit<SuppressionRules, "tenantId"> = { dedupWindowDays: 1 };

// Caché de reglas por tenant (TTL corto) — evita un GetItem por cada envío.
const rulesCache = new Map<string, { rules: SuppressionRules; exp: number }>();
const RULES_TTL_MS = 60_000;

/** Lee la política del tenant (cacheada 60s). Default = anti-doble-envío 1 día. */
export async function getRules(
  dynamo: DynamoDBClient,
  tenantId?: string,
): Promise<SuppressionRules> {
  const key = tenantId || "_legacy";
  const now = Date.now();
  const hit = rulesCache.get(key);
  if (hit && hit.exp > now) return hit.rules;
  let rules: SuppressionRules = { tenantId: key, ...DEFAULT_RULES };
  try {
    const r = await dynamo.send(
      new GetItemCommand({ TableName: RULES_TABLE, Key: { tenantId: { S: key } } }),
    );
    if (r.Item) rules = unmarshall(r.Item) as SuppressionRules;
  } catch (err) {
    console.warn("getRules failed (default):", err instanceof Error ? err.message : err);
  }
  rulesCache.set(key, { rules, exp: now + RULES_TTL_MS });
  return rules;
}

/** Guarda la política del tenant. Invalida el caché. */
export async function saveRules(
  dynamo: DynamoDBClient,
  tenantId: string,
  patch: Partial<SuppressionRules>,
  actor?: string,
): Promise<SuppressionRules> {
  const key = tenantId || "_legacy";
  const prev = await getRules(dynamo, key);
  const rules: SuppressionRules = {
    ...prev,
    ...patch,
    tenantId: key,
    updatedAt: new Date().toISOString(),
    updatedBy: actor || prev.updatedBy,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: RULES_TABLE,
      Item: marshall(rules, { removeUndefinedValues: true }),
    }),
  );
  rulesCache.delete(key);
  return rules;
}

/** Palabras de baja por defecto (es/en). Configurable por tenant en Fase B. */
export const DEFAULT_STOP_KEYWORDS = [
  "STOP",
  "BAJA",
  "CANCELAR",
  "CANCELAR SUSCRIPCION",
  "DAR DE BAJA",
  "DARME DE BAJA",
  "NO MOLESTAR",
  "NO CONTACTAR",
  "NO ME ESCRIBAN",
  "NO ENVIAR",
  "ELIMINAR",
  "REMOVER",
  "UNSUBSCRIBE",
  "REMOVE",
];

/** Palabras de re-alta (reactivar el contacto). */
export const DEFAULT_OPTIN_KEYWORDS = ["ALTA", "SUSCRIBIR", "SUSCRIBIRME", "START", "REACTIVAR"];

/** ¿El texto inbound es una palabra de baja? Match exacto o palabra completa. */
export function matchesStopKeyword(
  text: string,
  keywords: string[] = DEFAULT_STOP_KEYWORDS,
): boolean {
  return matchesKeyword(text, keywords);
}

/** ¿El texto inbound es una palabra de re-alta? */
export function matchesOptInKeyword(
  text: string,
  keywords: string[] = DEFAULT_OPTIN_KEYWORDS,
): boolean {
  return matchesKeyword(text, keywords);
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  const t = (text || "").trim().toUpperCase();
  if (!t) return false;
  for (const k of keywords) {
    const kk = k.trim().toUpperCase();
    if (!kk) continue;
    if (t === kk) return true;
    // palabra completa dentro de un mensaje corto ("por favor STOP")
    const esc = kk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|\\s)${esc}(\\s|$|[.!,])`).test(t)) return true;
  }
  return false;
}

/** Clave de tabla a partir de un teléfono crudo (dígitos normalizados). */
function keyOf(phone: string): string | null {
  return normalizePhone(phone)?.digits || null;
}

/**
 * BUG-M1 (compat lista↔set): `channels` se ESCRIBE ahora como String Set (SS)
 * para poder mergear con `ADD channels :c` sin read-modify-write (dos writes
 * concurrentes ya no se pisan). Pero al leer, `unmarshall` devuelve un SS como
 * `Set<string>` de JS, mientras que los items VIEJOS (guardados por el Put anterior)
 * vienen como `string[]` (List). Este helper normaliza AMBAS formas —y undefined— a
 * un `string[]` estable, para que TODO consumidor downstream (channelBlocked, el
 * merge de recordSuppression, y el `entry` que la API serializa a JSON hacia el
 * frontend) siga viendo un array. Sin esto, un Set colapsaría a `{}` en JSON.stringify. */
function toChannelArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v instanceof Set) return Array.from(v, String);
  return [];
}

function channelBlocked(entry: SuppressionEntry, channel: SuppressionChannel): boolean {
  const ch = toChannelArray(entry.channels);
  return ch.includes("all") || ch.includes(channel);
}

/** Lee la entrada de supresión de un número (O(1) GetItem). Fail-open: null si falla. */
export async function getSuppression(
  dynamo: DynamoDBClient,
  phone: string,
): Promise<SuppressionEntry | null> {
  const key = keyOf(phone);
  if (!key) return null;
  try {
    const r = await dynamo.send(
      new GetItemCommand({ TableName: SUPPRESSION_TABLE, Key: { phone: { S: key } } }),
    );
    if (!r.Item) return null;
    const e = unmarshall(r.Item) as SuppressionEntry;
    // Normaliza `channels` (SS→array | List→array) para consumidores y JSON. Ver toChannelArray.
    e.channels = toChannelArray(e.channels);
    // Cuarentena temporal vencida → ya no bloquea.
    if (e.expiresAt && e.expiresAt < new Date().toISOString()) return null;
    return e;
  } catch (err) {
    console.warn("getSuppression failed (fail-open):", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Veredicto de bloqueo DURO a partir de una entrada de supresión. */
function hardVerdict(entry: SuppressionEntry): SendVerdict {
  const blockedBy: BlockReason =
    entry.status === "opted_out"
      ? "opt_out"
      : entry.status === "quarantined"
        ? "quarantine"
        : entry.status === "converted"
          ? "converted"
          : "dnc";
  return { allowed: false, blockedBy, detail: entry.reason };
}

/** ¿La hora actual cae FUERA de la ventana permitida [startHour,endHour) / día? → bloquea. */
function outsideContactWindow(qh: QuietHours, now: Date): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: qh.timezone || "America/Lima",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const wd = parts.find((p) => p.type === "weekday")?.value || "";
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = map[wd] ?? -1;
    const days = qh.daysOfWeek && qh.daysOfWeek.length ? qh.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(weekday)) return true;
    return !(hour >= qh.startHour && hour < qh.endHour);
  } catch {
    return false; // fail-open
  }
}

/** Timestamps (sentAt) de los HSM a este número desde {sinceISO} (GSI byPhone). Fail-open: []. */
async function recentSendTimes(
  dynamo: DynamoDBClient,
  phoneDigits: string,
  sinceISO: string,
): Promise<string[]> {
  const out: string[] = [];
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: HSM_TABLE,
          IndexName: "byPhone",
          KeyConditionExpression: "phoneDigits = :p AND sentAt >= :s",
          ExpressionAttributeValues: { ":p": { S: phoneDigits }, ":s": { S: sinceISO } },
          ProjectionExpression: "sentAt",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ExclusiveStartKey: ESK as any,
        }),
      );
      for (const it of r.Items || []) {
        const m = unmarshall(it);
        if (m.sentAt) out.push(String(m.sentAt));
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
  } catch (err) {
    console.warn("recentSendTimes failed (fail-open):", err instanceof Error ? err.message : err);
  }
  return out;
}

/**
 * Aplica las causas de POLÍTICA (configurables): quiet-hours + (WhatsApp)
 * dedup-window R6 + frequency cap + converted (solo en batch con convertedDigits).
 * Las causas DURAS (opt-out/dnc/quarantine) se evalúan antes, aparte.
 */
async function applyPolicy(
  dynamo: DynamoDBClient,
  c: { phone: string; channel: SuppressionChannel; programId?: string; ignoreFrequency?: boolean },
  rules: SuppressionRules,
  convertedDigits?: Set<string>,
): Promise<SendVerdict> {
  const now = new Date();
  const digits = normalizePhone(c.phone)?.digits;

  // Quiet hours / ventana de contacto (por canal o "all").
  const qh = (rules.quietHours || []).find((q) => q.channel === c.channel || q.channel === "all");
  if (qh && outsideContactWindow(qh, now)) {
    return {
      allowed: false,
      blockedBy: "quiet_hours",
      detail: `fuera de ${qh.startHour}-${qh.endHour}h`,
    };
  }

  // No contactar convertidos (solo se evalúa si el caller pasó el set — preview batch).
  if (rules.suppressAfterConversion && digits && convertedDigits?.has(digits)) {
    return { allowed: false, blockedBy: "converted" };
  }

  // Dedup-window (R6) + frequency cap — WhatsApp en v1 (usa el GSI byPhone de hsm-sends).
  if (c.channel === "whatsapp" && !c.ignoreFrequency && digits) {
    const dedupDays = rules.dedupWindowDays ?? 0;
    const cap = (rules.freqCaps || []).find((f) => f.channel === "whatsapp" || f.channel === "all");
    const windows: number[] = [];
    if (dedupDays > 0) windows.push(dedupDays);
    if (cap && cap.max > 0) windows.push(cap.windowDays);
    if (windows.length) {
      const sinceISO = new Date(now.getTime() - Math.max(...windows) * DAY_MS).toISOString();
      const times = await recentSendTimes(dynamo, digits, sinceISO);
      if (dedupDays > 0) {
        const dedupSince = now.getTime() - dedupDays * DAY_MS;
        if (times.some((t) => Date.parse(t) >= dedupSince)) {
          return {
            allowed: false,
            blockedBy: "dedup_window",
            detail: `ya enviado en ${dedupDays}d`,
          };
        }
      }
      if (cap && cap.max > 0) {
        const capSince = now.getTime() - cap.windowDays * DAY_MS;
        const n = times.filter((t) => Date.parse(t) >= capSince).length;
        if (n >= cap.max) {
          return {
            allowed: false,
            blockedBy: "frequency",
            detail: `${n}/${cap.max} en ${cap.windowDays}d`,
          };
        }
      }
    }
  }

  return { allowed: true };
}

/**
 * ¿Se puede enviar a {phone} por {channel}? Causas duras (opt-out/cuarentena/DNC)
 * + política (quiet-hours + dedup-window R6 + frequency). `tenantId` para leer las
 * reglas; `ignoreFrequency` = override del supervisor.
 */
export async function evaluateSend(
  dynamo: DynamoDBClient,
  c: {
    phone: string;
    channel: SuppressionChannel;
    programId?: string;
    tenantId?: string;
    ignoreFrequency?: boolean;
  },
): Promise<SendVerdict> {
  const entry = await getSuppression(dynamo, c.phone);
  if (entry && channelBlocked(entry, c.channel)) return hardVerdict(entry);
  const rules = await getRules(dynamo, c.tenantId);
  return applyPolicy(dynamo, c, rules);
}

/** Desglose del preview honesto ("de N se excluyen M"). */
export interface BatchSummary {
  total: number;
  willSend: number;
  excluded: {
    optOut: number;
    quarantine: number;
    dnc: number;
    dedupWindow: number;
    frequency: number;
    quietHours: number;
    converted: number;
  };
}

/**
 * Corre evaluateSend sobre una lista (preview del wizard de campañas). Devuelve el
 * desglose por causa. `convertedDigits` (opcional) = set de dígitos de leads ya
 * convertidos (el caller lo calcula con UN scan de leads) para la causa "converted".
 */
export async function evaluateBatch(
  dynamo: DynamoDBClient,
  phones: string[],
  opts: {
    channel: SuppressionChannel;
    tenantId?: string;
    programId?: string;
    convertedDigits?: Set<string>;
  },
): Promise<BatchSummary> {
  const rules = await getRules(dynamo, opts.tenantId);
  const summary: BatchSummary = {
    total: phones.length,
    willSend: 0,
    excluded: {
      optOut: 0,
      quarantine: 0,
      dnc: 0,
      dedupWindow: 0,
      frequency: 0,
      quietHours: 0,
      converted: 0,
    },
  };
  let i = 0;
  const CONC = 8;
  const worker = async () => {
    while (i < phones.length) {
      const phone = phones[i++];
      const entry = await getSuppression(dynamo, phone);
      const v =
        entry && channelBlocked(entry, opts.channel)
          ? hardVerdict(entry)
          : await applyPolicy(
              dynamo,
              { phone, channel: opts.channel, programId: opts.programId },
              rules,
              opts.convertedDigits,
            );
      if (v.allowed) summary.willSend++;
      else {
        const b = v.blockedBy;
        if (b === "opt_out") summary.excluded.optOut++;
        else if (b === "quarantine") summary.excluded.quarantine++;
        else if (b === "dnc") summary.excluded.dnc++;
        else if (b === "dedup_window") summary.excluded.dedupWindow++;
        else if (b === "frequency") summary.excluded.frequency++;
        else if (b === "quiet_hours") summary.excluded.quietHours++;
        else if (b === "converted") summary.excluded.converted++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, phones.length || 1) }, () => worker()));
  return summary;
}

/** Precedencia de `status`: un opt-out (baja explícita del cliente) manda sobre
 *  todo; converted por encima de dnc/quarantine; quarantine es la más débil. Se
 *  usa para NO degradar el status en escrituras concurrentes (BUG-M1). */
const STATUS_RANK: Record<SuppressionStatus, number> = {
  opted_out: 3,
  converted: 2,
  dnc: 1,
  quarantined: 0,
};

/**
 * Registra/actualiza una entrada de supresión. Idempotente: MERGEA los canales
 * con lo existente (un opt-out de voz + uno de WhatsApp → ambos canales), y
 * preserva createdAt/source. "all" es comodín (channelBlocked lo respeta como tal).
 *
 * BUG-M1 (opt-out sin pérdida): antes hacía get→merge→Put del item ENTERO, así que
 * un opt-out y un status-webhook concurrentes se pisaban (perdiendo canales y/o
 * degradando un opt-out a quarantine). Ahora usa UpdateItem: los canales se mergean
 * con `ADD channels :c` (String Set, atómico → sin RMW), y el `status` solo AVANZA
 * en precedencia (STATUS_RANK) vía ConditionExpression, con reintento que preserva el
 * status existente si el nuevo es de menor rango. El resto de campos con if_not_exists
 * donde deben fijarse una sola vez (createdAt/source/phone). Si el item no existe, ADD lo crea.
 */
export async function recordSuppression(
  dynamo: DynamoDBClient,
  phone: string,
  e: {
    status: SuppressionStatus;
    channels?: string[];
    reason?: string;
    source?: SuppressionEntry["source"];
    tenantId?: string;
    leadId?: string;
    createdBy?: string;
    expiresAt?: string;
  },
): Promise<SuppressionEntry | null> {
  const key = keyOf(phone);
  if (!key) return null;
  const now = new Date().toISOString();
  const chan = e.channels?.length ? e.channels : ["whatsapp"];
  const e164 = normalizePhone(phone)?.e164;
  const rank = STATUS_RANK[e.status];

  // Nombres/valores de la expresión. Se arman incrementalmente para NO enviar
  // atributos undefined (que pisarían con vacío) ni valores sin usar.
  const names: Record<string, string> = { "#ch": "channels" };
  const values: Record<string, unknown> = {
    ":now": now,
    ":phone": key,
    ":src": e.source || "manual",
  };
  names["#src"] = "source";

  // Campos sobrescribibles (SET directo) — solo si vienen (no pisar con undefined).
  const overwritable: string[] = [];
  const setField = (attr: string, nameKey: string, valKey: string, val: unknown) => {
    if (val === undefined || val === null) return;
    names[nameKey] = attr;
    values[valKey] = val;
    overwritable.push(`${nameKey} = ${valKey}`);
  };
  setField("e164", "#e164", ":e164", e164);
  setField("reason", "#reason", ":reason", e.reason);
  setField("tenantId", "#tenant", ":tenant", e.tenantId);
  setField("leadId", "#lead", ":lead", e.leadId);
  setField("createdBy", "#by", ":by", e.createdBy);
  setField("expiresAt", "#exp", ":exp", e.expiresAt);

  // Campos "una sola vez" (if_not_exists): phone/createdAt/source no se re-escriben.
  const baseSets = [
    "phone = if_not_exists(phone, :phone)",
    "createdAt = if_not_exists(createdAt, :now)",
    "#src = if_not_exists(#src, :src)",
    ...overwritable,
  ];

  // Emite el UpdateItem. Dos ejes:
  //  · `withStatus` true  → setea status + statusRank, condicionado a NO degradar
  //    (attribute_not_exists(#rank) OR #rank <= :rank). false → reintento que preserva
  //    el status existente (de mayor rango) pero igual mergea el canal.
  //  · `chanMode` "add" → `ADD #ch :c` (String Set, atómico, sin RMW): camino normal.
  //    "set" → `SET #ch = :cl` con la UNIÓN completa: SOLO para migrar items LEGACY
  //    cuyo `channels` se guardó como List (el `ADD` de un set sobre una List lanza
  //    ValidationException). Migra ese item a SS en su primera escritura.
  const run = async (withStatus: boolean, chanMode: "add" | "set", unionChannels?: string[]) => {
    const setParts = [...baseSets];
    const exprNames = { ...names };
    const exprValues: Record<string, unknown> = { ...values };
    if (chanMode === "add") {
      exprValues[":c"] = new Set(chan);
    } else {
      // Unión (previos ∪ nuevos); "all" es comodín pero se conserva junto al resto
      // (channelBlocked ya lo trata como tal). Nunca vacío → set válido para SS.
      const union = Array.from(new Set([...(unionChannels || []), ...chan]));
      exprValues[":cl"] = new Set(union.length ? union : chan);
      setParts.push("#ch = :cl");
    }
    let condition: string | undefined;
    if (withStatus) {
      exprNames["#s"] = "status";
      exprNames["#rank"] = "statusRank";
      exprValues[":status"] = e.status;
      exprValues[":rank"] = rank;
      setParts.push("#s = :status", "#rank = :rank");
      condition = "attribute_not_exists(#rank) OR #rank <= :rank";
    }
    const r = await dynamo.send(
      new UpdateItemCommand({
        TableName: SUPPRESSION_TABLE,
        Key: { phone: { S: key } },
        UpdateExpression: `SET ${setParts.join(", ")}` + (chanMode === "add" ? " ADD #ch :c" : ""),
        ...(condition ? { ConditionExpression: condition } : {}),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: marshall(exprValues, { removeUndefinedValues: true }),
        ReturnValues: "ALL_NEW",
      }),
    );
    const out = unmarshall(r.Attributes || {}) as SuppressionEntry;
    out.channels = toChannelArray(out.channels);
    return out;
  };

  // Ejecuta el intento respetando la precedencia de status; si el canal choca por
  // ser LEGACY List, migra a SS con la unión (leyendo prev una sola vez).
  const attempt = async (withStatus: boolean): Promise<SuppressionEntry> => {
    try {
      return await run(withStatus, "add");
    } catch (err) {
      const name = (err as { name?: string })?.name;
      // `channels` existe como List (item viejo) → `ADD` de set no aplica: migramos.
      if (name === "ValidationException") {
        const prev = await getSuppression(dynamo, phone); // channels ya normalizado a array
        return await run(withStatus, "set", prev?.channels);
      }
      throw err;
    }
  };

  try {
    try {
      return await attempt(true);
    } catch (err) {
      // Condición de status falló → ya existe un status de MAYOR rango (p.ej.
      // opted_out) y el nuevo es más débil (una cuarentena no debe pisar un opt-out):
      // preservamos el status existente pero igual mergeamos el canal.
      if ((err as { name?: string })?.name !== "ConditionalCheckFailedException") throw err;
      return await attempt(false);
    }
  } catch (err) {
    console.warn("recordSuppression failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Atajo: registra un opt-out (baja). Default channel-scoped a WhatsApp. */
export async function recordOptOut(
  dynamo: DynamoDBClient,
  phone: string,
  opts: {
    channels?: string[];
    reason?: string;
    source?: SuppressionEntry["source"];
    tenantId?: string;
    leadId?: string;
    createdBy?: string;
  } = {},
): Promise<SuppressionEntry | null> {
  return recordSuppression(dynamo, phone, {
    status: "opted_out",
    channels: opts.channels?.length ? opts.channels : ["whatsapp"],
    reason: opts.reason || "Opt-out",
    source: opts.source || "inbound_keyword",
    tenantId: opts.tenantId,
    leadId: opts.leadId,
    createdBy: opts.createdBy,
  });
}

/**
 * Pilar 3 Fase C — "no contactar tras conversión". Se llama al CERRAR una gestión
 * (valoracion "cierre"). Escribe una entrada DURA `converted` channel-scoped a
 * "all" para que el gate (voz + WhatsApp + email) la respete en TODO envío futuro.
 *
 * Gated por la regla del tenant `suppressAfterConversion` (opt-in): si está
 * apagada → no-op (return null). Si el cliente quiere recontactar a un convertido,
 * lo quita de la lista (re-alta manual, ya soportado). Idempotente.
 */
export async function recordConversion(
  dynamo: DynamoDBClient,
  phone: string,
  opts: { tenantId?: string; leadId?: string; reason?: string; createdBy?: string } = {},
): Promise<SuppressionEntry | null> {
  const rules = await getRules(dynamo, opts.tenantId);
  if (!rules.suppressAfterConversion) return null; // regla apagada → no suprimir
  return recordSuppression(dynamo, phone, {
    status: "converted",
    channels: ["all"],
    reason: opts.reason || "Convertido — no recontactar",
    source: "conversion",
    tenantId: opts.tenantId,
    leadId: opts.leadId,
    createdBy: opts.createdBy,
  });
}

/** Quita un número de la lista (re-alta / corrección manual). */
export async function removeSuppression(dynamo: DynamoDBClient, phone: string): Promise<boolean> {
  const key = keyOf(phone);
  if (!key) return false;
  try {
    await dynamo.send(
      new DeleteItemCommand({ TableName: SUPPRESSION_TABLE, Key: { phone: { S: key } } }),
    );
    return true;
  } catch (err) {
    console.warn("removeSuppression failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Lista la DNC (scan — la lista es chica). Orden: más reciente primero. */
export async function listSuppression(
  dynamo: DynamoDBClient,
  opts: { limit?: number } = {},
): Promise<SuppressionEntry[]> {
  const out: SuppressionEntry[] = [];
  const limit = opts.limit || 5000;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: SUPPRESSION_TABLE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ExclusiveStartKey: ExclusiveStartKey as any,
        }),
      );
      for (const it of r.Items || []) {
        const e = unmarshall(it) as SuppressionEntry;
        // Normaliza `channels` (SS→array | List→array) para el JSON hacia el frontend.
        e.channels = toChannelArray(e.channels);
        out.push(e);
      }
      ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey && out.length < limit);
  } catch (err) {
    console.warn("listSuppression failed:", err instanceof Error ? err.message : err);
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
