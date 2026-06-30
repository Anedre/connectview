import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

/**
 * HsmOutboundReport — WhatsApp template (HSM) Outbound report (roadmap #6),
 * Chattigo's flagship metric. Pulls aggregates from get-hsm-report.
 * Vox tracks SEND + VOLUME per template. delivered/read/failed are NOT
 * tracked here by design (#14 decision): the WABA's single event destination
 * is the Amazon Connect instance (powers inbound agent chat) and
 * SendChatIntegrationEvent is service-restricted, so a status relay can't run
 * without breaking inbound. Those rates live in Meta Business Manager →
 * WhatsApp Manager → Analytics.
 */
interface TemplateAgg {
  template: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  expired: number;
  pending: number;
  lastSentAt: string;
}
interface Report {
  totals: Record<string, number>;
  templates: TemplateAgg[];
  rates: { readRate: number; failRate: number };
}

export function HsmOutboundReport() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.getHsmReport) {
      setError("Endpoint no configurado");
      setLoading(false);
      return;
    }
    fetch(ep.getHsmReport)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("No se pudo cargar el reporte"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 24, color: "var(--text-3)", fontSize: 12.5 }}>Cargando…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: "var(--text-3)", fontSize: 12.5 }}>{error}</div>;
  }
  if (!data || data.totals.total === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
        Aún no hay envíos de plantillas registrados. Las campañas de WhatsApp
        aparecerán aquí.
      </div>
    );
  }

  const t = data.totals;
  const kpi = (label: string, value: number | string, color?: string) => (
    <div
      style={{
        flex: 1,
        minWidth: 92,
        padding: "10px 12px",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        background: "var(--bg-2)",
      }}
    >
      <div className="muted" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "var(--text-1)", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );

  const totalSends = t.total;
  const mostRecent = data.templates.reduce(
    (acc, tpl) => (tpl.lastSentAt > acc ? tpl.lastSentAt : acc),
    ""
  );

  return (
    <div>
      {/* KPI strip — ciclo de entrega (delivered/read/failed los llena el
          status-webhook desde números Meta no anclados a Connect, Pilar 4). */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {kpi("Enviados", totalSends)}
        {/* Entregado del embudo = delivered + read (leído implica entregado). */}
        {kpi("Entregados", (t.delivered || 0) + (t.read || 0), "var(--accent-cyan)")}
        {kpi("Leídos", t.read || 0, "var(--accent-violet)")}
        {kpi("Fallidos", t.failed || 0, (t.failed || 0) > 0 ? "var(--accent-red)" : undefined)}
        {kpi("Plantillas", data.templates.length)}
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 14 }}>
        Tasa de lectura <b>{data.rates.readRate}%</b> (leídos/entregados) · Tasa de fallo{" "}
        <b>{data.rates.failRate}%</b> · Última actividad{" "}
        {mostRecent ? new Date(mostRecent).toLocaleDateString("es-PE") : "—"}
      </div>

      {/* Per-template table — volumen + ciclo de entrega por plantilla */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
              {["Plantilla", "Enviados", "Entregados", "Leídos", "Fallidos", "Último envío"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 || i === 5 ? "left" : "right",
                    padding: "6px 10px",
                    color: "var(--text-2)",
                    fontWeight: 600,
                    fontSize: 11,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.templates.map((tpl) => {
              const sends =
                tpl.sent + tpl.delivered + tpl.read + tpl.failed + tpl.expired + tpl.pending;
              const cell = (v: number, color?: string) => (
                <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: v > 0 ? color : "var(--text-3)" }}>
                  {v || "—"}
                </td>
              );
              return (
                <tr key={tpl.template} style={{ borderBottom: "1px solid var(--border-1)" }}>
                  <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                    {tpl.template}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {sends}
                  </td>
                  {cell(tpl.delivered + tpl.read, "var(--accent-cyan)")}
                  {cell(tpl.read, "var(--accent-violet)")}
                  {cell(tpl.failed, "var(--accent-red)")}
                  <td style={{ padding: "7px 10px", color: "var(--text-3)", fontSize: 11 }}>
                    {tpl.lastSentAt ? new Date(tpl.lastSentAt).toLocaleString("es-PE") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Honest note: delivered/read/failed are not tracked in Vox by design (#14) */}
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          background: "var(--bg-2)",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "var(--text-2)",
        }}
      >
        <strong style={{ color: "var(--text-1)" }}>Entregado · leído · fallido</strong> se llenan
        automáticamente desde un número de WhatsApp <strong>de Meta no anclado a Amazon Connect</strong>{" "}
        (ARIA recibe los recibos de entrega). Para un número <strong>anclado a Connect</strong> (chat de
        agentes), los eventos van a Connect y el agregado vive en{" "}
        <a
          href="https://business.facebook.com/wa/manage/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-cyan)" }}
        >
          Meta WhatsApp Manager → Analytics
        </a>
        . Configurá el modo de cada número en Configuración → Canales.
      </div>
    </div>
  );
}
