import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ConnectClient, SearchContactsCommand } from "@aws-sdk/client-connect";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { resolveTenantId, isLegacyTenant } from "../_shared/cognitoAuth";
import { resolveConnect } from "../_shared/tenantConnect";
import { PRICES, ASSUME, usd, type CostLine } from "../_shared/pricing";

/**
 * get-cost-report — calculadora de "Consumo" (Configuración): cuánto gasta el
 * tenant en su Amazon Connect y su Meta (WhatsApp) según su uso de ARIA, con
 * ESTIMACIÓN (volumen × precios del modelo, _shared/pricing.ts) y, cuando hay
 * fuente, el COBRO REAL:
 *   · WhatsApp real → Graph API conversation_analytics (COST) del WABA del tenant.
 *   · Connect real  → AWS Cost Explorer (build-ahead: requiere ce:GetCostAndUsage
 *                     en el rol cross-account del cliente).
 *
 * Cada línea degrada elegante: si su fuente falla o está vacía, muestra lo que
 * tiene (o 0) + una nota, nunca rompe el reporte. GET ?days=30 (o ?from&to ISO).
 * Ver design/consumo.md.
 */
const legacyDynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});
const legacyConnect = new ConnectClient({});
// Cost Explorer es GLOBAL (endpoint us-east-1). El client legacy usa las creds del
// Lambda (cuenta de la plataforma, tenant fundador); para BYO se asume el rol del
// tenant. STS para ese assume-role.
const legacyCostExplorer = new CostExplorerClient({ region: "us-east-1" });
const sts = new STSClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const HSM_SENDS_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "connectview-conversations";
const AI_CONV_TABLE = process.env.AI_CONVERSATIONS_TABLE || "connectview-ai-conversations";
const CONNECT_INSTANCE_ID =
  process.env.CONNECT_INSTANCE_ID || "2345d564-4bd4-4318-9cf0-75649bad5197";
const GRAPH = "https://graph.facebook.com/v20.0";

const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

interface TenantMeta {
  wabaId?: string;
  waPhoneId?: string;
  waMode?: string;
  hasConnect?: boolean;
  // BYO cross-account (para Cost Explorer sobre la cuenta del cliente).
  roleArn?: string;
  externalId?: string;
  region?: string;
}

async function getTenantMeta(tenantId: string): Promise<TenantMeta> {
  try {
    const it = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (!it.Item) return {};
    const cfg = JSON.parse(unmarshall(it.Item).configJson || "{}");
    return {
      wabaId: cfg.whatsapp?.wabaId,
      waPhoneId: cfg.whatsapp?.metaPhoneNumberId || cfg.whatsapp?.phoneNumberId,
      waMode: cfg.whatsapp?.mode,
      hasConnect: !!cfg.connect?.instanceUrl,
      roleArn: cfg.connect?.roleArn,
      externalId: cfg.connect?.externalId,
      region: cfg.connect?.region,
    };
  } catch {
    return {};
  }
}

/**
 * Resuelve el cliente de Cost Explorer para la cuenta correcta: BYO asume el rol
 * cross-account del tenant (su cuenta); fundador/legacy (sin roleArn) usa las creds
 * del Lambda (cuenta de la plataforma Novasys). Compartido por `connectRealCost`
 * (gasto de Connect en la cuenta del tenant) y `platformRealByTag` (gasto de la
 * infra de ARIA — que vive en Novasys; el fundador t_3176 apunta ahí vía su rol).
 */
async function resolveCeClient(meta: TenantMeta): Promise<CostExplorerClient> {
  if (meta.roleArn) {
    try {
      const a = await sts.send(
        new AssumeRoleCommand({
          RoleArn: meta.roleArn,
          RoleSessionName: "vox-cost-report",
          ExternalId: meta.externalId,
          DurationSeconds: 900,
        }),
      );
      const cr = a.Credentials;
      if (cr?.AccessKeyId && cr.SecretAccessKey && cr.SessionToken) {
        return new CostExplorerClient({
          region: "us-east-1",
          credentials: {
            accessKeyId: cr.AccessKeyId,
            secretAccessKey: cr.SecretAccessKey,
            sessionToken: cr.SessionToken,
          },
        });
      }
    } catch (e) {
      // Sin assume (el rol no extendió ce:) → caemos a las creds legacy.
      console.warn("cost assume-role falló:", e instanceof Error ? e.message : e);
    }
  }
  return legacyCostExplorer;
}

/**
 * Cobro REAL de Amazon Connect del período vía AWS Cost Explorer (servicio de
 * facturación). Devuelve el gasto de los servicios de Connect (Amazon Connect + End
 * User Messaging + Contact Lens) o null si no hay permiso `ce:` / no se pudo.
 * NOTA: los datos de CE tienen ~24h de retraso; el día en curso puede ir parcial.
 */
async function connectRealCost(
  meta: TenantMeta,
  ceStart: string,
  ceEnd: string,
): Promise<{ byService: Record<string, number>; total: number } | null> {
  try {
    const ce = await resolveCeClient(meta);
    const res = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: ceStart, End: ceEnd },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        // Amazon Bedrock incluido: es el "Agente IA" del panel (servicio asociado),
        // aunque no sea Connect. GroupBy SERVICE → real aproximado por-fila.
        Filter: {
          Dimensions: {
            Key: "SERVICE",
            Values: [
              "Amazon Connect",
              "AWS End User Messaging",
              "AWS End User Messaging Social",
              "Contact Lens for Amazon Connect",
              "Amazon Bedrock",
            ],
          },
        },
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      }),
    );
    const byService: Record<string, number> = {};
    let total = 0;
    for (const t of res.ResultsByTime || []) {
      for (const g of t.Groups || []) {
        const svc = g.Keys?.[0] || "otros";
        const amt = Number(g.Metrics?.UnblendedCost?.Amount || 0);
        byService[svc] = (byService[svc] || 0) + amt;
        total += amt;
      }
    }
    return { byService, total: usd(total) };
  } catch (e) {
    console.warn("connectRealCost falló:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Servicio de Cost Explorer → fila del panel Connect (real aproximado por-fila).
 *  Voz = Amazon Connect + Contact Lens; WBM = End User Messaging; IA = Bedrock. */
const CE_SERVICE_TO_CONNECT: Record<string, string> = {
  "Amazon Connect": "connect_voice",
  "Contact Lens for Amazon Connect": "connect_voice",
  "AWS End User Messaging": "connect_wbm_out",
  "AWS End User Messaging Social": "connect_wbm_out",
  "Amazon Bedrock": "bot_bedrock",
};

/**
 * Cobro REAL de la infraestructura PROPIA de ARIA vía Cost Explorer, filtrado por
 * la etiqueta de asignación de costos `aria:product=ARIA` y agrupado por servicio
 * (AWS Lambda, Amazon DynamoDB, …). Así se aísla lo que gasta SOLO ARIA, sin traer
 * toda la factura de la cuenta. Devuelve `{ byService, total }` o null.
 *
 * 🔑 Requiere: (1) los recursos etiquetados con `aria:product=ARIA` (Lambdas ya lo
 * están vía scripts/tag-lambdas.mjs; DynamoDB y demás vía scripts/tag-resources.mjs);
 * (2) activar `aria:product` como *cost allocation tag* en la consola de Facturación
 * (no es retroactivo, ~24 h para poblar). Si no está activa, CE devuelve vacío → null.
 */
async function platformRealByTag(
  meta: TenantMeta,
  ceStart: string,
  ceEnd: string,
): Promise<{ byService: Record<string, number>; total: number } | null> {
  try {
    const ce = await resolveCeClient(meta);
    const res = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: ceStart, End: ceEnd },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
        Filter: { Tags: { Key: "aria:product", Values: ["ARIA"], MatchOptions: ["EQUALS"] } },
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      }),
    );
    const byService: Record<string, number> = {};
    let total = 0;
    for (const t of res.ResultsByTime || []) {
      for (const g of t.Groups || []) {
        const svc = g.Keys?.[0] || "otros";
        const amt = Number(g.Metrics?.UnblendedCost?.Amount || 0);
        byService[svc] = (byService[svc] || 0) + amt;
        total += amt;
      }
    }
    // Sin grupos = la etiqueta no está activa como cost-allocation o no hay costo aún.
    if (Object.keys(byService).length === 0) return null;
    return { byService, total: usd(total) };
  } catch (e) {
    console.warn("platformRealByTag falló:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Nombre de servicio en Cost Explorer → componente (línea) de plataforma. */
const CE_SERVICE_TO_COMPONENT: Record<string, string> = {
  "AWS Lambda": "platform_lambda",
  "Amazon DynamoDB": "platform_dynamodb",
  AmazonCloudWatch: "platform_logs",
  "AWS Secrets Manager": "platform_secrets",
  "Amazon Cognito": "platform_cognito",
};

async function getWaToken(tenantId: string): Promise<string | null> {
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    const raw = r.SecretString || "";
    try {
      const j = JSON.parse(raw);
      if (j && typeof j.token === "string") return j.token;
    } catch {
      /* string plano */
    }
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/** Cuenta filas de una tabla cuyo campo timestamp cae en [fromIso, toIso].
 *  Best-effort + capado; `pred` opcional filtra además por tenant/estado. */
async function scanWindow<T>(
  dynamo: DynamoDBClient,
  table: string,
  tsField: string,
  fromIso: string,
  toIso: string,
  onItem: (item: T) => void,
): Promise<void> {
  let ESK: Record<string, unknown> | undefined;
  let pages = 0;
  do {
    const r = await dynamo.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: ESK as never }),
    );
    for (const it of r.Items || []) {
      const obj = unmarshall(it) as Record<string, unknown> & T;
      const ts = String((obj as Record<string, unknown>)[tsField] || "");
      if (ts && ts >= fromIso && ts <= toIso) onItem(obj);
    }
    ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ESK && ++pages < 50);
}

/** Cobro REAL de WhatsApp del WABA del tenant (Graph conversation_analytics, COST). */
async function whatsappRealCost(
  wabaId: string,
  token: string,
  startSec: number,
  endSec: number,
): Promise<number | null> {
  try {
    const metrics = encodeURIComponent(JSON.stringify(["COST", "CONVERSATION"]));
    const q =
      `${wabaId}/conversation_analytics?start=${startSec}&end=${endSec}` +
      `&granularity=DAILY&metric_types=${metrics}` +
      `&dimensions=${encodeURIComponent(JSON.stringify(["CONVERSATION_CATEGORY"]))}`;
    const r = await fetch(`${GRAPH}/${q}&access_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (!r.ok || j?.error) throw new Error(j?.error?.message || `HTTP ${r.status}`);
    let cost = 0;
    // La respuesta anida data[].data_points[].cost (USD).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (j?.conversation_analytics?.data || j?.data || []) as any[]) {
      for (const dp of block.data_points || []) cost += Number(dp.cost || 0);
    }
    return usd(cost);
  } catch (e) {
    console.warn("whatsappRealCost falló:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Minutos de voz (entrante/saliente) del período vía Connect SearchContacts.
 *  Best-effort: si el rol/instancia no resuelve, devuelve null. */
async function voiceMinutes(
  headers: Record<string, string | undefined> | undefined,
  fromMs: number,
  toMs: number,
): Promise<{ inMin: number; outMin: number; calls: number } | null> {
  try {
    const rc = await resolveConnect(headers, legacyConnect, CONNECT_INSTANCE_ID);
    const client = rc.client;
    const instanceId = rc.instanceId || CONNECT_INSTANCE_ID;
    let inMin = 0,
      outMin = 0,
      calls = 0;
    let next: string | undefined;
    let pages = 0;
    do {
      const res = await client.send(
        new SearchContactsCommand({
          InstanceId: instanceId,
          TimeRange: {
            Type: "INITIATION_TIMESTAMP",
            StartTime: new Date(fromMs),
            EndTime: new Date(toMs),
          },
          SearchCriteria: { Channels: ["VOICE"] },
          MaxResults: 100,
          NextToken: next,
        }),
      );
      for (const c of res.Contacts || []) {
        const init = c.InitiationTimestamp ? c.InitiationTimestamp.getTime() : 0;
        const disc = c.DisconnectTimestamp ? c.DisconnectTimestamp.getTime() : 0;
        const min = init && disc && disc > init ? (disc - init) / 60000 : 0;
        calls++;
        if (c.InitiationMethod === "OUTBOUND") outMin += min;
        else inMin += min;
      }
      next = res.NextToken;
    } while (next && ++pages < 20);
    return { inMin, outMin, calls };
  } catch (e) {
    console.warn("voiceMinutes falló:", e instanceof Error ? e.message : e);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const tenantId = await resolveTenantId(event?.headers);
  if (!tenantId) return bad(401, "no autorizado");

  const q = event?.queryStringParameters || {};
  const days = Math.min(180, Math.max(1, Number(q.days) || 30));
  const toMs = q.to ? Date.parse(q.to) : Date.now();
  const fromMs = q.from ? Date.parse(q.from) : toMs - days * 86400_000;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const startSec = Math.floor(fromMs / 1000);
  const endSec = Math.floor(toMs / 1000);

  const meta = await getTenantMeta(tenantId);
  const lines: CostLine[] = [];

  // ── Meta · WhatsApp HSM (plantillas) ──────────────────────────────────────
  // SEC-A1 — aislamiento por tenant ENDURECIDO. Antes el conteo de HSM NO filtraba
  // por tenant (a diferencia de conversations/ai-conv) → Consumo mezclaba los envíos
  // de TODOS los tenants. Ahora, con hsm-sends ya guardando tenantId:
  //   · Solicitante LEGACY (novasys/default): filas SIN tenantId (históricas) O la suya.
  //   · Tenant REAL: match EXACTO (descarta las sin tenantId).
  const legacy = isLegacyTenant(tenantId);
  const belongsTenant = (rowTenant?: string): boolean =>
    legacy ? !rowTenant || rowTenant === tenantId : rowTenant === tenantId;
  let hsmCount = 0;
  try {
    await scanWindow<{ status?: string; tenantId?: string }>(
      legacyDynamo,
      HSM_SENDS_TABLE,
      "sentAt",
      fromIso,
      toIso,
      (it) => {
        if (!belongsTenant(it.tenantId)) return;
        if (!it.status || it.status !== "failed") hsmCount++;
      },
    );
  } catch (e) {
    console.warn("hsm scan:", e instanceof Error ? e.message : e);
  }
  // Real WhatsApp (todas las conversaciones del WABA, no solo HSM).
  let waReal: number | null = null;
  if (meta.wabaId) {
    const token = await getWaToken(tenantId);
    if (token) waReal = await whatsappRealCost(meta.wabaId, token, startSec, endSec);
  }
  lines.push({
    component: "whatsapp_hsm",
    label: "WhatsApp · plantillas (marketing)",
    group: "meta",
    volume: hsmCount,
    unit: "msg",
    unitCost: PRICES.metaWhatsAppMsg,
    estimated: usd(hsmCount * PRICES.metaWhatsAppMsg),
    real: waReal,
    note: meta.wabaId
      ? "Real = costo de Meta por conversación (todas las categorías) del número conectado."
      : "Conecta tu número de Meta para ver el cobro real de Meta.",
  });

  // ── Amazon Connect · WhatsApp/omnicanal saliente (mensajes) ───────────────
  // De paso contamos la actividad TOTAL (mensajes + agentes distintos) para estimar
  // el uso de la infraestructura de plataforma (Lambda/DynamoDB/…) más abajo.
  let waOutMsgs = 0;
  let convMsgsTotal = 0;
  const agentSet = new Set<string>();
  try {
    await scanWindow<{
      channel?: string;
      messages?: { direction?: string }[];
      tenantId?: string;
      assignedAgentUserId?: string;
    }>(legacyDynamo, CONVERSATIONS_TABLE, "lastMessageAt", fromIso, toIso, (c) => {
      // Guard fuerte: un tenant real NO cuenta las filas pooled sin tenantId
      // (antes `c.tenantId && …` las dejaba pasar → mezcla de tenants en el costo).
      if (!belongsTenant(c.tenantId)) return;
      for (const m of c.messages || []) {
        convMsgsTotal++;
        if (c.channel === "whatsapp" && m.direction === "out") waOutMsgs++;
      }
      if (c.assignedAgentUserId) agentSet.add(c.assignedAgentUserId);
    });
  } catch (e) {
    console.warn("conv scan:", e instanceof Error ? e.message : e);
  }
  lines.push({
    component: "connect_wbm_out",
    label: "WhatsApp saliente vía Connect (WBM)",
    group: "connect",
    volume: waOutMsgs,
    unit: "msg",
    unitCost: PRICES.connectWBM,
    estimated: usd(waOutMsgs * PRICES.connectWBM),
    real: null,
    note: "Mensajes salientes de WhatsApp atendidos por Connect (AWS End User Messaging).",
  });

  // ── Amazon Connect · Voz (minutos) ────────────────────────────────────────
  const voice = await voiceMinutes(event?.headers, fromMs, toMs);
  if (voice) {
    const totalMin = voice.inMin + voice.outMin;
    const est =
      voice.inMin * (PRICES.connectVoiceMin + PRICES.telephonyInMin) +
      voice.outMin * (PRICES.connectVoiceMin + PRICES.telephonyOutMin) +
      voice.calls * 0 + // AMD sólo en salientes de campaña; se omite en MVP
      totalMin * ASSUME.clPctVoice * PRICES.contactLensMin +
      totalMin * ASSUME.qPctVoice * PRICES.qConnectVoiceMin;
    lines.push({
      component: "connect_voice",
      label: "Voz (minutos + telefonía + Contact Lens)",
      group: "connect",
      volume: Math.round(totalMin),
      unit: "min",
      unitCost: PRICES.connectVoiceMin,
      estimated: usd(est),
      real: null,
      note: `${voice.calls} llamadas · ${Math.round(voice.inMin)} min entrantes + ${Math.round(voice.outMin)} min salientes. Incluye Contact Lens (${Math.round(ASSUME.clPctVoice * 100)}%) y Amazon Q (${Math.round(ASSUME.qPctVoice * 100)}%) estimados. Telefonía Perú: verificar tarifa.`,
    });
  } else {
    lines.push({
      component: "connect_voice",
      label: "Voz (minutos + telefonía + Contact Lens)",
      group: "connect",
      volume: 0,
      unit: "min",
      unitCost: PRICES.connectVoiceMin,
      estimated: 0,
      real: null,
      note: "No se pudo leer el histórico de voz de tu Connect (permiso SearchContacts o instancia).",
    });
  }

  // ── Amazon Connect · Bot IA (Bedrock) ─────────────────────────────────────
  let botTurns = 0;
  try {
    await scanWindow<{ recType?: string; turns?: number; tenantId?: string }>(
      legacyDynamo,
      AI_CONV_TABLE,
      "createdAt",
      fromIso,
      toIso,
      (c) => {
        if (c.recType && c.recType !== "conversation") return;
        // Antes sumaba los turnos de TODOS los tenants → el costo Bedrock mezclaba
        // cuentas. Ahora solo los del tenant del reporte.
        if (!belongsTenant(c.tenantId)) return;
        botTurns += Number(c.turns || 0);
      },
    );
  } catch (e) {
    console.warn("ai-conv scan:", e instanceof Error ? e.message : e);
  }
  const botCost =
    ((botTurns * ASSUME.tokInBot) / 1000) * PRICES.bedrockHaikuIn +
    ((botTurns * ASSUME.tokOutBot) / 1000) * PRICES.bedrockHaikuOut;
  lines.push({
    component: "bot_bedrock",
    label: "Agente IA (Bedrock · tokens)",
    group: "connect",
    volume: botTurns,
    unit: "1K tok",
    unitCost: PRICES.bedrockHaikuIn,
    estimated: usd(botCost),
    real: null,
    note: `${botTurns} turnos de bot × ~${ASSUME.tokInBot}/${ASSUME.tokOutBot} tokens (Haiku). Corre en tu Bedrock (BYO).`,
  });

  // ── Plataforma ARIA · infraestructura propia (cuenta Novasys) ─────────────
  // Lo que cuesta OPERAR ARIA para servir a este tenant: Lambda (sus funciones),
  // DynamoDB (la base que crean los templates), identidad, logs, egreso. Es infra
  // COMPARTIDA entre tenants → se ESTIMA por-tenant desde su actividad; no hay un
  // "real" por-tenant (Cost Explorer daría el total mezclado de todos). IAM se
  // lista a $0 porque roles y políticas no se cobran.
  const events = (voice?.calls || 0) + convMsgsTotal + botTurns + hsmCount;
  const periodFrac = days / 30;

  const lambdaInv = Math.round(
    events * ASSUME.lambdaInvPerEvent + ASSUME.lambdaBaselineMonthly * periodFrac,
  );
  const lambdaCost =
    (lambdaInv / 1e6) * PRICES.lambdaPerReq + lambdaInv * ASSUME.lambdaGBsInv * PRICES.lambdaGBs;
  lines.push({
    component: "platform_lambda",
    label: "Lambda — cómputo (las funciones de ARIA)",
    group: "platform",
    volume: lambdaInv,
    unit: "invocación",
    unitCost: PRICES.lambdaPerReq,
    estimated: usd(lambdaCost),
    real: null,
    note: `~${ASSUME.lambdaInvPerEvent} invocaciones por evento (webhook→bot→respuesta) + fijas de tareas programadas. Corre en la plataforma de ARIA.`,
  });

  const ddbOps = Math.round(events * ASSUME.ddbOpsPerEvent);
  const ddbCost =
    ((ddbOps * ASSUME.ddbWriteFrac) / 1e6) * PRICES.ddbWRU +
    ((ddbOps * (1 - ASSUME.ddbWriteFrac)) / 1e6) * PRICES.ddbRRU;
  lines.push({
    component: "platform_dynamodb",
    label: "DynamoDB — base de datos (leads, conversaciones, historial…)",
    group: "platform",
    volume: ddbOps,
    unit: "operación",
    unitCost: PRICES.ddbRRU,
    estimated: usd(ddbCost),
    real: null,
    note: "Las tablas que ARIA crea con sus templates. On-demand: lectura + escritura estimadas del uso.",
  });

  const logsGb = (lambdaInv / 1e6) * ASSUME.logsGbPerMillionInv;
  lines.push({
    component: "platform_logs",
    label: "CloudWatch — logs",
    group: "platform",
    volume: Math.round(logsGb * 100) / 100,
    unit: "GB",
    unitCost: PRICES.cwLogsGB,
    estimated: usd(logsGb * PRICES.cwLogsGB),
    real: null,
    note: "Ingesta de logs de las funciones.",
  });

  const dtGb = (events / 1000) * ASSUME.dtGbPerThousandEvents;
  lines.push({
    component: "platform_transfer",
    label: "Transferencia de datos (egreso)",
    group: "platform",
    volume: Math.round(dtGb * 100) / 100,
    unit: "GB",
    unitCost: PRICES.dataTransferGB,
    estimated: usd(dtGb * PRICES.dataTransferGB),
    real: null,
    note: "Salida de datos de la plataforma.",
  });

  lines.push({
    component: "platform_secrets",
    label: "Secrets Manager — tokens y credenciales",
    group: "platform",
    volume: ASSUME.secretsTenant,
    unit: "secreto",
    unitCost: PRICES.secretsMonth,
    estimated: usd(ASSUME.secretsTenant * PRICES.secretsMonth * periodFrac),
    real: null,
    note: `~${ASSUME.secretsTenant} secretos por tenant (WhatsApp, Salesforce, OAuth…), prorrateado al período.`,
  });

  const agents = agentSet.size || 1;
  lines.push({
    component: "platform_cognito",
    label: "Cognito — identidad de usuarios",
    group: "platform",
    volume: agents,
    unit: "usuario",
    unitCost: PRICES.cognitoMAU,
    estimated: usd(agents * PRICES.cognitoMAU * periodFrac),
    real: null,
    note: `${agents} usuario(s) activo(s) en el período. Suele caer en el tramo gratis de Cognito.`,
  });

  lines.push({
    component: "platform_iam",
    label: "IAM — roles y políticas",
    group: "platform",
    volume: 0,
    unit: "recurso",
    unitCost: 0,
    estimated: 0,
    real: null,
    free: true,
    note: "IAM no tiene costo en AWS: crear roles y políticas es gratis.",
  });

  // ── Cobro REAL de Connect (Cost Explorer) — total de cuenta + aproximado por-fila ─
  const ceStart = new Date(fromMs).toISOString().slice(0, 10);
  const ceEnd = new Date(toMs + 86400_000).toISOString().slice(0, 10); // End exclusivo → +1 día
  const connectRes = await connectRealCost(meta, ceStart, ceEnd);
  const connectReal = connectRes?.total ?? null; // total de cuenta (incluye cargos fuera de las filas)
  if (connectRes) {
    // Real aproximado por-fila: acumular por si dos servicios mapean a la misma
    // (voz = Amazon Connect + Contact Lens).
    const perRow: Record<string, number> = {};
    for (const [svc, amt] of Object.entries(connectRes.byService)) {
      const comp = CE_SERVICE_TO_CONNECT[svc];
      if (comp) perRow[comp] = (perRow[comp] || 0) + amt;
    }
    for (const [comp, amt] of Object.entries(perRow)) {
      const line = lines.find((l) => l.component === comp);
      if (line) line.real = usd(amt);
    }
  }

  // ── Cobro REAL de la infra de ARIA (Cost Explorer filtrado por etiqueta) ──────
  // Solo lo etiquetado `aria:product=ARIA` → el gasto de ARIA aislado, sin el resto
  // de la cuenta. Mapeamos el real por-servicio a cada línea de plataforma (Estimado
  // vs Real vs Δ). Es el total de la infra de ARIA (compartida entre tenants).
  const platformRealTag = await platformRealByTag(meta, ceStart, ceEnd);
  if (platformRealTag) {
    for (const [svc, amt] of Object.entries(platformRealTag.byService)) {
      const comp = CE_SERVICE_TO_COMPONENT[svc];
      if (!comp) continue;
      const line = lines.find((l) => l.component === comp);
      if (line) line.real = usd(amt);
    }
  }

  // ── Totales + disponibilidad del "real" ───────────────────────────────────
  const sum = (g: string) =>
    usd(lines.filter((l) => l.group === g).reduce((n, l) => n + l.estimated, 0));
  const connect = sum("connect");
  const metaEst = sum("meta");
  const platform = sum("platform");
  // realTotal = reales por-línea NO-connect (WhatsApp + plataforma) + el total de
  // Connect (CE). Se excluye el grupo "connect" del per-línea porque `connectReal`
  // ya cubre esos servicios (incluido Bedrock) → evita doble-conteo.
  const realPerLine = lines
    .filter((l) => l.group !== "connect")
    .reduce<number | null>((acc, l) => (l.real != null ? (acc || 0) + l.real : acc), null);
  const realTotal =
    connectReal != null || realPerLine != null ? (realPerLine || 0) + (connectReal || 0) : null;

  return ok({
    period: { from: fromIso, to: toIso, days },
    currency: "USD",
    lines,
    summary: {
      connect,
      connectReal, // gasto real de AWS (Cost Explorer) — nivel cuenta/servicio
      meta: metaEst,
      platform, // infra propia de ARIA (estimada, compartida entre tenants)
      platformReal: platformRealTag?.total ?? null, // real por etiqueta aria:product=ARIA
      total: usd(connect + metaEst + platform),
      realTotal: realTotal != null ? usd(realTotal) : null,
    },
    realAvailable: {
      whatsapp: waReal != null,
      // Connect real disponible cuando Cost Explorer respondió (permiso ce:).
      connect: connectReal != null,
      // Platform real disponible cuando la etiqueta aria:product=ARIA está activa como
      // cost-allocation tag y CE devolvió datos.
      platform: platformRealTag != null,
    },
    notes: {
      pricingModel: "us-east-1, jun-2026 (scripts/gen-costos-xlsx.mjs)",
      peruTelephony: "las tarifas de telefonía Perú están marcadas a validar",
      connectReal:
        "El cobro real de Amazon Connect se activa con el permiso de facturación (Cost Explorer) en tu rol de acceso. El total de cuenta incluye TODO el gasto de Connect y servicios asociados (renta de números/DID, telefonía, Bedrock), por eso puede superar la suma de las filas estimadas.",
    },
    generatedAt: new Date().toISOString(),
  });
};
