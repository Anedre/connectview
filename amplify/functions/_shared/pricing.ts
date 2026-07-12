/**
 * pricing — precios unitarios + supuestos de consumo, FUENTE ÚNICA compartida por
 * el Lambda `get-cost-report` (calculadora de Consumo en Configuración) y el script
 * `scripts/gen-costos-xlsx.mjs` (modelo de costos interno). Copiado 1:1 del objeto
 * PRICES/ASSUME del script (us-east-1, jun-2026) para que la estimación que ve el
 * cliente use EXACTAMENTE los mismos números que el modelo de negocio.
 *
 * 🔑 Los precios de telefonía Perú están marcados "VERIFICAR" en el modelo → en la
 * UI van con disclaimer y son sobreescribibles por tenant (configJson.pricingOverrides).
 */

/** Unidad de cobro de cada línea (para explicarla en la UI). */
export type CostUnit =
  | "min"
  | "msg"
  | "call"
  | "task"
  | "profile-día"
  | "1K tok"
  | "GB-mes"
  | "conv"
  | "invocación"
  | "operación"
  | "GB"
  | "secreto"
  | "usuario"
  | "recurso";

/** Precios unitarios en USD (us-east-1). */
export const PRICES = {
  // Amazon Connect — voz
  connectVoiceMin: 0.018,
  telephonyInMin: 0.0075,
  telephonyOutMin: 0.0067,
  amdPerCall: 0.0085,
  didPerDay: 0.06,
  // Amazon Connect — omnicanal
  connectChat: 0.004,
  connectEmail: 0.05,
  connectWBM: 0.01, // WhatsApp vía Connect (AWS End User Messaging)
  connectTaskEach: 0.04,
  // Amazon Connect — analítica / IA
  contactLensMin: 0.015,
  contactLensChat: 0.0015,
  customerProfilesDaily: 0.005,
  qConnectVoiceMin: 0.008,
  // Meta
  metaWhatsAppMsg: 0.02, // plantilla marketing LatAm (VERIFICAR Perú)
  eumSocialMsg: 0.005,
  // Bedrock (bot IA) — por 1K tokens
  bedrockHaikuIn: 0.0008,
  bedrockHaikuOut: 0.004,
  // Grabaciones
  s3Storage: 0.023, // GB-mes
  // ── Plataforma ARIA (infra propia, cuenta Novasys) — espejo de PLATFORM_LINES
  //    del script gen-costos-xlsx.mjs. Es el costo de OPERAR ARIA (Lambda, la base
  //    de datos que crean los templates, identidad, logs…), compartido entre tenants
  //    y atribuido por-tenant según su uso. (IAM no se lista: roles/políticas = $0.)
  lambdaPerReq: 0.2, // $/1M solicitudes
  lambdaGBs: 0.0000166667, // $/GB-segundo
  ddbWRU: 0.625, // $/1M escrituras on-demand
  ddbRRU: 0.125, // $/1M lecturas on-demand
  cognitoMAU: 0.015, // $/usuario activo (MAU)
  secretsMonth: 0.4, // $/secreto-mes
  cwLogsGB: 0.5, // $/GB ingesta de logs
  dataTransferGB: 0.09, // $/GB egreso
} as const;

/** Supuestos de cálculo (cuando no hay dato exacto de volumen). */
export const ASSUME = {
  voiceMinIn: 5, // duración media llamada entrante (min)
  voiceMinOut: 3, // duración media llamada saliente (min)
  qPctVoice: 0.3, // % de minutos de voz con Amazon Q
  clPctVoice: 0.5, // % de minutos de voz con Contact Lens
  botTurns: 4, // turnos por conversación de bot
  tokInBot: 1200, // tokens de entrada por turno
  tokOutBot: 350, // tokens de salida por turno
  // ── Plataforma: supuestos de infra (espejo del script) ──
  lambdaGBsInv: 0.075, // GB-s por invocación Lambda (≈256MB·300ms)
  ddbWriteFrac: 0.3, // proporción de operaciones DynamoDB que son escrituras
  secretsTenant: 3, // secretos por tenant (WhatsApp, Salesforce, OAuth…)
  // ── Derivación por-tenant desde la actividad (SOLO el estimador vivo: el script
  //    usa volúmenes manuales; aquí los inferimos del uso real del período). Un
  //    "evento" = mensaje/llamada/turno de bot que dispara la cadena de la plataforma.
  lambdaInvPerEvent: 6, // invocaciones Lambda por evento (webhook→propagate→bot→reply→…)
  lambdaBaselineMonthly: 15000, // invocaciones fijas/mes (crons: journeys 5min, reaper, warmers)
  ddbOpsPerEvent: 20, // operaciones DynamoDB por evento (lead, conversación, historial, dedup, supresión…)
  logsGbPerMillionInv: 0.5, // GB de logs por 1M de invocaciones
  dtGbPerThousandEvents: 0.02, // GB de egreso por 1000 eventos
} as const;

export type PriceKey = keyof typeof PRICES;

/** Una línea de costo del reporte. `estimated` = volumen × precio; `real` = lo que
 *  Meta/AWS efectivamente cobran (null si aún no hay fuente real conectada). */
export interface CostLine {
  component: string; // clave estable (ej. "whatsapp_hsm", "voice_outbound")
  label: string; // legible para la UI
  group: "connect" | "meta" | "platform";
  volume: number; // unidades consumidas en el período
  unit: CostUnit;
  unitCost: number; // USD por unidad
  estimated: number; // USD estimado (volume × unitCost, +derivados)
  real: number | null; // USD real (Graph / Cost Explorer) o null
  note?: string; // explicación / disclaimer para la UI
  free?: boolean; // gratis por diseño (ej. IAM) → la UI muestra "$0.00 · gratis", no "—"
}

/** Redondeo a centavos para no arrastrar ruido de punto flotante. */
export function usd(n: number): number {
  return Math.round(n * 100) / 100;
}
