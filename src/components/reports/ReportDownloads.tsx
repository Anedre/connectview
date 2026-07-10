import { useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { downloadCsv, downloadXlsx, type Column } from "@/lib/reportExport";
import { Icon, type IconName } from "@/components/aria";
import type { ContactRecord } from "@/types/monitoring";
import type { DateRange } from "./DateRangePicker";

/**
 * ReportDownloads — catálogo de descargas de reportes (estilo Chattigo): eliges
 * un reporte y lo descargas como CSV o Excel al toque. Reusa lo que ARIA ya tiene:
 * los contactos ya cargados (Chat detail / agentes / llamadas / canal — respetan
 * el período), el feed de datos (HSM / leads / conversaciones) y get-cost-report.
 */

type Row = Record<string, unknown>;
type Built = { sheet: string; columns: Column[]; rows: Row[] };

/** Deriva columnas legibles de las claves del primer row (para datasets del feed). */
function colsFromKeys(rows: Row[]): Column[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map((k) => ({
    key: k,
    label: k
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim(),
  }));
}

const isVoice = (c: ContactRecord) =>
  ["VOICE", "TELEPHONY"].includes((c.channel || "").toUpperCase());

export function ReportDownloads({
  contacts,
  range,
}: {
  contacts: ContactRecord[];
  range: DateRange;
}) {
  const feedEp = getApiEndpoints()?.getAnalyticsFeed;
  const costEp = getApiEndpoints()?.getCostReport;
  const [busy, setBusy] = useState<string | null>(null);

  const fetchDataset = async (dataset: string): Promise<Row[]> => {
    if (!feedEp) throw new Error("Feed de datos no disponible");
    const r = await authedFetch(`${feedEp}?dataset=${dataset}`);
    const j = await r.json();
    if (j?.error) throw new Error(j.error);
    return (j.rows as Row[]) || [];
  };

  const chatCols: Column[] = [
    { key: "contactId", label: "Contact ID" },
    { key: "initiationTimestamp", label: "Inicio" },
    { key: "disconnectTimestamp", label: "Fin" },
    { key: "agentUsername", label: "Agente" },
    { key: "queueName", label: "Cola" },
    { key: "channel", label: "Canal" },
    { key: "duration", label: "Duración (s)" },
    { key: "sentiment", label: "Sentiment" },
    { key: "categories", label: "Categorías" },
    { key: "status", label: "Estado" },
    { key: "disconnectReason", label: "Motivo cierre" },
  ];

  const agentsBuild = (): Built => {
    const map = new Map<
      string,
      { agente: string; contactos: number; dur: number; pos: number; neg: number }
    >();
    for (const c of contacts) {
      const a = c.agentUsername || "—";
      const m = map.get(a) || { agente: a, contactos: 0, dur: 0, pos: 0, neg: 0 };
      m.contactos++;
      if (typeof c.duration === "number") m.dur += c.duration;
      if (c.sentiment === "POSITIVE") m.pos++;
      if (c.sentiment === "NEGATIVE") m.neg++;
      map.set(a, m);
    }
    const rows = [...map.values()].map((m) => ({
      agente: m.agente,
      contactos: m.contactos,
      duracionProm: m.contactos ? Math.round(m.dur / m.contactos) : 0,
      positivos: m.pos,
      negativos: m.neg,
    }));
    return {
      sheet: "Agentes",
      columns: [
        { key: "agente", label: "Agente" },
        { key: "contactos", label: "Contactos" },
        { key: "duracionProm", label: "Dur. prom (s)" },
        { key: "positivos", label: "Positivos" },
        { key: "negativos", label: "Negativos" },
      ],
      rows,
    };
  };

  const channelsBuild = (): Built => {
    const map = new Map<string, { canal: string; contactos: number; dur: number }>();
    for (const c of contacts) {
      const ch = c.channel || "—";
      const m = map.get(ch) || { canal: ch, contactos: 0, dur: 0 };
      m.contactos++;
      if (typeof c.duration === "number") m.dur += c.duration;
      map.set(ch, m);
    }
    const rows = [...map.values()].map((m) => ({
      canal: m.canal,
      contactos: m.contactos,
      duracionProm: m.contactos ? Math.round(m.dur / m.contactos) : 0,
    }));
    return {
      sheet: "Canales",
      columns: [
        { key: "canal", label: "Canal" },
        { key: "contactos", label: "Contactos" },
        { key: "duracionProm", label: "Dur. prom (s)" },
      ],
      rows,
    };
  };

  const REPORTS: {
    id: string;
    label: string;
    icon: IconName;
    hint: string;
    build: () => Promise<Built> | Built;
  }[] = [
    {
      id: "chat-detail",
      label: "Chat detail",
      icon: "fileText",
      hint: "Fila por contacto: agente, cola, canal, duración, sentiment, estado.",
      build: () => ({
        sheet: "Chat detail",
        columns: chatCols,
        rows: contacts as unknown as Row[],
      }),
    },
    {
      id: "agentes",
      label: "Rendimiento por agente",
      icon: "users",
      hint: "Contactos, duración promedio y sentiment por agente.",
      build: agentsBuild,
    },
    {
      id: "llamadas",
      label: "Llamadas",
      icon: "phone",
      hint: "Solo los contactos de voz del período.",
      build: () => ({
        sheet: "Llamadas",
        columns: chatCols,
        rows: contacts.filter(isVoice) as unknown as Row[],
      }),
    },
    {
      id: "canales",
      label: "Resumen por canal",
      icon: "layers",
      hint: "Volumen y duración promedio por canal.",
      build: channelsBuild,
    },
    {
      id: "hsm",
      label: "Plantillas WhatsApp (HSM)",
      icon: "wa",
      hint: "Envíos de plantillas con estado de entrega.",
      build: async () => {
        const rows = await fetchDataset("hsm");
        return { sheet: "HSM", columns: colsFromKeys(rows), rows };
      },
    },
    {
      id: "leads",
      label: "Leads",
      icon: "userplus",
      hint: "Cada lead con estado, etapa, programa y sus golpes (WhatsApp/llamadas/emails, primer y último toque).",
      build: async () => {
        const rows = await fetchDataset("leads");
        return { sheet: "Leads", columns: colsFromKeys(rows), rows };
      },
    },
    {
      id: "leads-history",
      label: "Historial de leads (golpes)",
      icon: "history",
      hint: "El timeline completo: una fila por golpe (gestión, WhatsApp, email, llamada) con fecha, canal y agente.",
      build: async () => {
        const rows = await fetchDataset("leads-history");
        return { sheet: "Historial", columns: colsFromKeys(rows), rows };
      },
    },
    {
      id: "leads-stages",
      label: "Leads por etapa (embudo)",
      icon: "funnel",
      hint: "Conteo de leads y golpes por etapa del pipeline, con convertidos y golpes promedio.",
      build: async () => {
        const rows = await fetchDataset("leads-stages");
        return { sheet: "Embudo", columns: colsFromKeys(rows), rows };
      },
    },
    {
      id: "conversaciones",
      label: "Conversaciones (CRM)",
      icon: "chats",
      hint: "Conversaciones del inbox omnicanal por canal y agente.",
      build: async () => {
        const rows = await fetchDataset("conversations");
        return { sheet: "Conversaciones", columns: colsFromKeys(rows), rows };
      },
    },
    {
      id: "consumo",
      label: "Consumo (costos)",
      icon: "gauge",
      hint: "Desglose de costos: Connect, Meta e infraestructura de ARIA.",
      build: async () => {
        if (!costEp) throw new Error("Reporte de consumo no disponible");
        const r = await authedFetch(`${costEp}?days=30`);
        const j = await r.json();
        if (j?.error) throw new Error(j.error);
        const rows = ((j.lines as Row[]) || []).map((l) => ({
          grupo: l.group,
          concepto: l.label,
          volumen: l.volume,
          unidad: l.unit,
          costoUnitario: l.unitCost,
          estimado: l.estimated,
          real: l.real,
        }));
        return { sheet: "Consumo", columns: colsFromKeys(rows), rows };
      },
    },
  ];

  const stamp = `${range.end.getFullYear()}-${String(range.end.getMonth() + 1).padStart(2, "0")}-${String(range.end.getDate()).padStart(2, "0")}`;

  const run = async (rep: (typeof REPORTS)[number], format: "csv" | "xlsx") => {
    setBusy(`${rep.id}:${format}`);
    try {
      const { sheet, columns, rows } = await rep.build();
      if (!rows.length) {
        toast.info("Ese reporte no tiene datos todavía");
        return;
      }
      const cols = columns.length ? columns : colsFromKeys(rows);
      const fname = `${rep.id}-${stamp}`;
      if (format === "csv") downloadCsv(fname, cols, rows);
      else await downloadXlsx(fname, sheet, cols, rows);
      toast.success(`${rep.label} · ${rows.length} filas`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar el reporte");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 12,
      }}
    >
      {REPORTS.map((rep) => (
        <div
          key={rep.id}
          style={{
            border: "1px solid var(--border-1)",
            borderRadius: 12,
            background: "var(--bg-1)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: "grid",
                placeItems: "center",
                background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                color: "var(--accent)",
                flex: "0 0 auto",
              }}
            >
              <Icon name={rep.icon} size={17} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{rep.label}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.45, flex: 1 }}>
            {rep.hint}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn--sm"
              style={{ flex: 1 }}
              disabled={!!busy}
              onClick={() => run(rep, "csv")}
            >
              {busy === `${rep.id}:csv` ? "…" : "CSV"}
            </button>
            <button
              className="btn btn--sm btn--primary"
              style={{ flex: 1 }}
              disabled={!!busy}
              onClick={() => run(rep, "xlsx")}
            >
              <Icon name="download" size={12} /> {busy === `${rep.id}:xlsx` ? "…" : "Excel"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
