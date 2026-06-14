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
      {/* KPI strip — Vox tracks send + volume (entregado/leído viven en Meta BM) */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {kpi("Enviados", totalSends)}
        {kpi("Plantillas", data.templates.length)}
        {kpi(
          "Última actividad",
          mostRecent ? new Date(mostRecent).toLocaleDateString("es-PE") : "—"
        )}
      </div>

      {/* Per-template table — send volume per template */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
              {["Plantilla", "Enviados", "% del volumen", "Último envío"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 || i === 3 ? "left" : "right",
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
              const pct = totalSends > 0 ? Math.round((sends / totalSends) * 100) : 0;
              return (
                <tr key={tpl.template} style={{ borderBottom: "1px solid var(--border-1)" }}>
                  <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                    {tpl.template}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {sends}
                  </td>
                  <td style={{ padding: "7px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <div
                        style={{
                          flex: "0 0 80px", height: 6, borderRadius: 4, overflow: "hidden",
                          background: "var(--border-1)",
                        }}
                      >
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent-cyan)" }} />
                      </div>
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-2)", minWidth: 30, textAlign: "right" }}>
                        {pct}%
                      </span>
                    </div>
                  </td>
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
        <strong style={{ color: "var(--text-1)" }}>Entregado · leído · fallido</strong> por
        plantilla viven en{" "}
        <a
          href="https://business.facebook.com/wa/manage/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-cyan)" }}
        >
          Meta Business Manager → WhatsApp Manager → Analytics
        </a>
        . ARIA registra el <strong>envío y el volumen</strong>; el estado posterior al envío no se
        captura porque tu WhatsApp enruta los eventos a Amazon Connect (chat de agentes) y duplicar
        ese destino rompería el inbound.
      </div>
    </div>
  );
}
