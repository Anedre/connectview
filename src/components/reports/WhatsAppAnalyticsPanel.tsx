import { useWhatsAppAnalytics } from "@/hooks/useWhatsAppAnalytics";
import { Kpi, KpiRow } from "@/components/reports/kit";

/**
 * WhatsAppAnalyticsPanel — entrega agregada de WhatsApp directo de Meta (Pilar 4
 * · Fase C). Para números en modo Meta Cloud API: delivered%/read% por plantilla
 * sin depender del webhook por-mensaje. Es la "HSM Shipment Summary" de Chattigo.
 */
export function WhatsAppAnalyticsPanel() {
  const { data, loading } = useWhatsAppAnalytics(30);

  if (loading)
    return (
      <div style={{ padding: 16, color: "var(--text-3)", fontSize: 12.5 }}>
        Cargando analytics de Meta…
      </div>
    );
  if (!data || !data.configured) {
    return (
      <div style={{ padding: 16, color: "var(--text-3)", fontSize: 12.5 }}>
        {data?.error || "No hay un número de WhatsApp en modo Meta configurado para analytics."}
      </div>
    );
  }

  const act = data.wabaActivity || { sent: 0, delivered: 0 };
  const actDeliveredRate = act.sent > 0 ? Math.round((act.delivered / act.sent) * 100) : 0;

  return (
    <div>
      {/* Actividad del número (WABA-level, mensajes) + embudo de plantillas */}
      <div style={{ marginBottom: 12 }}>
        <KpiRow min={130}>
          <Kpi
            label="Enviados (número)"
            value={act.sent}
            sub="mensajes · últimos 30 días"
            color="var(--green)"
          />
          <Kpi
            label="Entregados"
            value={act.delivered}
            sub={`${actDeliveredRate}% del enviado`}
            color="var(--cyan)"
          />
          <Kpi
            label="Plantillas (envíos)"
            value={data.totals.sent}
            sub={`${data.templates.length} con tráfico`}
            color="var(--iris)"
          />
          <Kpi
            label="Tasa de lectura"
            value={`${data.rates.readRate}%`}
            sub="leídos/entregados (plantillas)"
            color="var(--green)"
          />
        </KpiRow>
      </div>

      {data.templates.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
                {["Plantilla", "Enviados", "Entregados", "Leídos"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? "left" : "right",
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
              {data.templates.map((t) => (
                <tr key={t.templateId} style={{ borderBottom: "1px solid var(--border-1)" }}>
                  <td
                    style={{
                      padding: "7px 10px",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                    }}
                  >
                    {t.name}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                    }}
                  >
                    {t.sent}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--accent-cyan)",
                    }}
                  >
                    {t.delivered}{" "}
                    <span className="muted" style={{ fontSize: 11 }}>
                      · {t.deliveredRate}%
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--accent-violet)",
                    }}
                  >
                    {t.read}{" "}
                    <span className="muted" style={{ fontSize: 11 }}>
                      · {t.readRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, padding: "10px 2px" }}>
          Sin envíos de <b>plantilla</b> en la ventana (la actividad del número aparece arriba).
          Cuando se envíen plantillas por este número, el delivered%/read% por plantilla aparece
          aquí.
        </div>
      )}

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
        <strong style={{ color: "var(--text-1)" }}>Directo de Meta</strong> (Graph API ·
        template_analytics). Es el agregado oficial de entrega para tu número de{" "}
        <strong>WhatsApp Cloud API</strong> — no depende del webhook por-mensaje ni del event
        destination. Complementa el reporte por-mensaje (HSM Outbound) de arriba.
      </div>
    </div>
  );
}
