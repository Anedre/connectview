/**
 * Tipos de presentación del dashboard ejecutivo + datos mock (UDEP).
 *
 * `ExecData` es el contrato que consume `ExecutiveView` (presentación pura).
 * El contenedor real (`InsightsPanel`) arma un `ExecData` desde los hooks/Lambdas;
 * la ruta demo `/inicio-demo` usa `scaleExec(EXEC_MOCK, period)` para verificar
 * visualmente sin login. Tomado del handoff v2 (`views/executive.jsx`).
 */

export type ExecPeriod = "hoy" | "ayer" | "semana" | "mes";

export interface ExecSlice {
  name: string;
  value: number;
  color: string;
}

export interface ExecKpis {
  contactos: { value: number; delta: number; spark: number[] };
  sentimentPos: { value: number };
  aht: { seconds: number };
  leads: { value: number; delta: number; spark: number[] };
  citas: { value: number; total: number };
  plantillasWA: { value: number };
  agentes: { available: number; online: number };
}

export interface ExecChannelDay {
  label: string;
  voz: number;
  wa: number;
  chat: number;
  email: number;
  sms: number;
}

export interface ExecTrendDay {
  label: string;
  actual: number;
  anterior: number;
}

export interface ExecCampaign {
  name: string;
  done: number;
  total: number;
  status: "RUNNING" | "PAUSED" | string;
}

export interface ExecLiveQueue {
  name: string;
  enCola: number;
  libres: number;
  espera: string;
  status: "ok" | "warn" | string;
}

export interface ExecInsight {
  tone: "ok" | "info" | "warn" | "crit";
  kicker: string;
  title: string;
  sub: string;
  action: string;
}

export interface ExecData {
  kpis: ExecKpis;
  volumeByChannel: ExecChannelDay[];
  volumeTrend: ExecTrendDay[];
  sentiment: ExecSlice[];
  agentRank: Array<{ name: string; value: number }>;
  byQueue: ExecSlice[];
  leadSources: ExecSlice[];
  funnel: Array<{ label: string; value: number; color: string }>;
  campaigns: ExecCampaign[];
  liveQueues: ExecLiveQueue[];
  csat: {
    value: number;
    meta: number;
    encuestas: number;
    promotores: number;
    detractores: number;
  };
  /** Meta del header. */
  agentsOnline: number;
  org: string;
  /** Insights opcionales; si se omiten, ExecutiveView los deriva de los datos. */
  insights?: ExecInsight[];
}

/** Paleta de datos "infografía" del diseño v2 (tokenizada también como --data-* en index.css). */
export const EXEC_DATA_PALETTE = {
  teal: "#15485A",
  emerald: "#2E9D8E",
  lime: "#92C73E",
  orange: "#F2972E",
  cyan: "#1C97A6",
  amber: "#F5A524",
} as const;

/** Paleta diversa aprobada (un color vívido y único por serie/etapa; cicla si hay más). */
export const DATA_COLORS = ["#2BC6E6","#25B873","#A3D63B","#F5C518","#F5A524","#F2722E","#9B8CF0","#ED84C2","#ED5257","#6E8BFF"];

export const EXEC_MOCK: ExecData = {
  kpis: {
    contactos: { value: 184, delta: +23, spark: [12, 18, 9, 22, 17, 28, 31] },
    sentimentPos: { value: 62 },
    aht: { seconds: 176 },
    leads: { value: 47, delta: +12, spark: [3, 5, 4, 8, 6, 11, 10] },
    citas: { value: 9, total: 14 },
    plantillasWA: { value: 320 },
    agentes: { available: 6, online: 8 },
  },
  volumeByChannel: [
    { label: "24/5", voz: 14, wa: 22, chat: 6, email: 3, sms: 1 },
    { label: "25/5", voz: 18, wa: 25, chat: 9, email: 2, sms: 0 },
    { label: "26/5", voz: 12, wa: 30, chat: 7, email: 4, sms: 2 },
    { label: "27/5", voz: 20, wa: 28, chat: 11, email: 3, sms: 1 },
    { label: "28/5", voz: 9, wa: 33, chat: 5, email: 6, sms: 2 },
    { label: "29/5", voz: 16, wa: 27, chat: 8, email: 1, sms: 0 },
    { label: "30/5", voz: 11, wa: 24, chat: 10, email: 5, sms: 1 },
  ],
  volumeTrend: [
    { label: "20/5", actual: 128, anterior: 102 },
    { label: "21/5", actual: 184, anterior: 110 },
    { label: "22/5", actual: 64, anterior: 78 },
    { label: "23/5", actual: 96, anterior: 44 },
    { label: "24/5", actual: 150, anterior: 70 },
    { label: "25/5", actual: 88, anterior: 62 },
    { label: "26/5", actual: 58, anterior: 84 },
    { label: "27/5", actual: 92, anterior: 120 },
    { label: "28/5", actual: 112, anterior: 146 },
    { label: "29/5", actual: 142, anterior: 158 },
    { label: "30/5", actual: 96, anterior: 40 },
  ],
  sentiment: [
    { name: "Positivo", value: 114, color: "#25B873" },
    { name: "Neutral", value: 48, color: "#6E8BFF" },
    { name: "Mixto", value: 14, color: "#F5C518" },
    { name: "Negativo", value: 8, color: "#ED5257" },
  ],
  agentRank: [
    { name: "María Gonzales", value: 42 },
    { name: "Carlos Ruiz", value: 38 },
    { name: "Andre Alata", value: 31 },
    { name: "Lucía Vega", value: 27 },
    { name: "Diego Soto", value: 19 },
  ],
  byQueue: [
    { name: "UDEP-Pregrado", value: 78, color: "#2BC6E6" },
    { name: "UDEP-Posgrado", value: 41, color: "#25B873" },
    { name: "UDEP-Alumnos", value: 33, color: "#A3D63B" },
    { name: "UDEP-Diplomados", value: 20, color: "#F5C518" },
    { name: "Gerencia", value: 12, color: "#F5A524" },
  ],
  leadSources: [
    { name: "Web", value: 18, color: "#2BC6E6" },
    { name: "Campaña", value: 14, color: "#25B873" },
    { name: "WhatsApp", value: 9, color: "#A3D63B" },
    { name: "Salesforce", value: 4, color: "#F5C518" },
    { name: "Manual", value: 2, color: "#F5A524" },
  ],
  funnel: [
    { label: "Contactado", value: 47, color: "#15485A" },
    { label: "Interesado", value: 31, color: "#1C97A6" },
    { label: "Negociando", value: 18, color: "#2E9D8E" },
    { label: "Cerrando", value: 9, color: "#92C73E" },
    { label: "Inscrito", value: 5, color: "#F2972E" },
    { label: "No interesado", value: 6, color: "#C2622A" },
  ],
  campaigns: [
    { name: "Admisión Pregrado 2026-I", done: 340, total: 500, status: "RUNNING" },
    { name: "Reactivación Posgrado", done: 120, total: 300, status: "PAUSED" },
  ],
  liveQueues: [
    { name: "UDEP-Pregrado", enCola: 3, libres: 4, espera: "0:42", status: "ok" },
    { name: "UDEP-Posgrado", enCola: 8, libres: 1, espera: "2:15", status: "warn" },
    { name: "UDEP-Alumnos", enCola: 0, libres: 5, espera: "0:00", status: "ok" },
  ],
  csat: { value: 88, meta: 85, encuestas: 142, promotores: 71, detractores: 6 },
  agentsOnline: 8,
  org: "UDEP",
};

const PERIOD_FACTOR: Record<ExecPeriod, number> = {
  hoy: 1,
  ayer: 0.86,
  semana: 5.6,
  mes: 23,
};

/** Escala el mock por período para que el filtro re-anime con magnitudes distintas. */
export function scaleExec(base: ExecData, period: ExecPeriod): ExecData {
  if (period === "hoy") return base;
  const f = PERIOD_FACTOR[period];
  const scaleSlices = (arr: ExecSlice[]) =>
    arr.map((d) => ({ ...d, value: Math.round(d.value * f) }));
  const citaF = period === "mes" ? 8 : period === "semana" ? 3 : 1;
  const trendF = period === "mes" ? 4.2 : period === "semana" ? 1.4 : 0.9;
  return {
    ...base,
    kpis: {
      contactos: {
        value: Math.round(base.kpis.contactos.value * f),
        delta: period === "ayer" ? -8 : +23,
        spark: base.kpis.contactos.spark,
      },
      sentimentPos: { value: period === "ayer" ? 58 : period === "semana" ? 64 : 61 },
      aht: { seconds: period === "ayer" ? 192 : period === "semana" ? 168 : 174 },
      leads: {
        value: Math.round(base.kpis.leads.value * f),
        delta: period === "ayer" ? -3 : +12,
        spark: base.kpis.leads.spark,
      },
      citas: {
        value: Math.round(base.kpis.citas.value * citaF),
        total: Math.round(base.kpis.citas.total * citaF),
      },
      plantillasWA: { value: Math.round(base.kpis.plantillasWA.value * f) },
      agentes: base.kpis.agentes,
    },
    sentiment: scaleSlices(base.sentiment),
    agentRank: base.agentRank.map((d) => ({ ...d, value: Math.round(d.value * f) })),
    byQueue: scaleSlices(base.byQueue),
    leadSources: scaleSlices(base.leadSources),
    funnel: base.funnel.map((d) => ({ ...d, value: Math.round(d.value * f) })),
    volumeTrend: base.volumeTrend.map((d) => ({
      ...d,
      actual: Math.round(d.actual * trendF),
      anterior: Math.round(d.anterior * trendF),
    })),
  };
}
