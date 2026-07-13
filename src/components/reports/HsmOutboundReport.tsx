import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { HsmDeliverySummary } from "./HsmDeliverySummary";
import { Kpi, KpiRow } from "@/components/reports/kit";

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
interface PhoneAgg {
  phone: string;
  sends: number;
  delivered: number;
  read: number;
  failed: number;
  lastTemplate: string;
  lastSentAt: string;
  lastStatus: string;
  responded: boolean;
  firstResponseSec: number | null;
}
interface ResponseStats {
  sentPhones: number;
  respondedPhones: number;
  responseRate: number;
  avgFirstResponseSec: number | null;
  inboundTracked: boolean;
}
// R18 — rendimiento por agente (de las conversaciones de WhatsApp del inbox).
interface AgentAgg {
  agent: string;
  conversations: number;
  replies: number;
  respondedCount: number;
  avgResponseSec: number | null;
}
interface Report {
  totals: Record<string, number>;
  templates: TemplateAgg[];
  rates: { readRate: number; failRate: number };
  byPhone?: PhoneAgg[];
  response?: ResponseStats;
  byAgent?: AgentAgg[];
  agentsTracked?: boolean;
}

/** Segundos → "2m 13s" / "1h 4m" / "—". */
function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function HsmOutboundReport() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ep = getApiEndpoints();
      if (!ep?.getHsmReport) {
        if (!cancelled) {
          setError("Endpoint no configurado");
          setLoading(false);
        }
        return;
      }
      // authedFetch → tenant del JWT: lee los hsm-sends + el inbound (conversations)
      // del tenant. Con fetch anónimo resolvía datos inconsistentes (legacy/blocked).
      try {
        const r = await authedFetch(ep.getHsmReport);
        const d = await r.json();
        if (!cancelled) {
          if (d?.error) setError(d.error);
          else setData(d);
        }
      } catch {
        if (!cancelled) setError("No se pudo cargar el reporte");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
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
        Aún no hay envíos de plantillas registrados. Las campañas de WhatsApp aparecerán aquí.
      </div>
    );
  }

  const t = data.totals;
  const totalSends = t.total;
  const mostRecent = data.templates.reduce(
    (acc, tpl) => (tpl.lastSentAt > acc ? tpl.lastSentAt : acc),
    "",
  );

  return (
    <div>
      {/* Resumen visual de entrega (donas) — la "estrella" del reporte HSM. */}
      <HsmDeliverySummary totals={data.totals} response={data.response} rates={data.rates} />

      {/* KPI strip — ciclo de entrega (delivered/read/failed los llena el
          status-webhook desde números Meta no anclados a Connect, Pilar 4). */}
      <div style={{ marginTop: 14, marginBottom: 8 }}>
        <KpiRow min={118}>
          <Kpi label="Enviados" value={totalSends} color="var(--accent)" />
          {/* Entregado del embudo = delivered + read (leído implica entregado). */}
          <Kpi label="Entregados" value={(t.delivered || 0) + (t.read || 0)} color="var(--cyan)" />
          <Kpi label="Leídos" value={t.read || 0} color="var(--iris)" />
          <Kpi
            label="Fallidos"
            value={t.failed || 0}
            color={(t.failed || 0) > 0 ? "var(--red)" : "var(--text-3)"}
          />
          <Kpi label="Plantillas" value={data.templates.length} color="var(--accent)" />
          {/* Pilar 9 Fase C (R16/R17) — respuesta + 1ª respuesta (del inbound). */}
          {data.response && data.response.inboundTracked && (
            <>
              <Kpi
                label="Respuestas"
                value={`${Math.round(data.response.responseRate * 100)}%`}
                color="var(--green)"
              />
              <Kpi
                label="1ª respuesta"
                value={fmtDur(data.response.avgFirstResponseSec)}
                color="var(--cyan)"
              />
            </>
          )}
        </KpiRow>
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
              {["Plantilla", "Enviados", "Entregados", "Leídos", "Fallidos", "Último envío"].map(
                (h, i) => (
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
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.templates.map((tpl) => {
              const sends =
                tpl.sent + tpl.delivered + tpl.read + tpl.failed + tpl.expired + tpl.pending;
              const cell = (v: number, color?: string) => (
                <td
                  style={{
                    padding: "7px 10px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: v > 0 ? color : "var(--text-3)",
                  }}
                >
                  {v || "—"}
                </td>
              );
              return (
                <tr key={tpl.template} style={{ borderBottom: "1px solid var(--border-1)" }}>
                  <td
                    style={{
                      padding: "7px 10px",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                    }}
                  >
                    {tpl.template}
                  </td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                    }}
                  >
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

      {/* Pilar 9 Fase C — detalle POR NÚMERO (R16) + respuesta (R17). */}
      {data.byPhone && data.byPhone.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 8,
            }}
          >
            Por número {data.response && `· ${data.response.sentPhones} clientes`}
            {data.response && data.response.inboundTracked && (
              <span
                className="muted"
                style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}
              >
                · {data.response.respondedPhones}/{data.response.sentPhones} respondieron (
                {Math.round(data.response.responseRate * 100)}%)
              </span>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
                  {[
                    "Número",
                    "Envíos",
                    "Entregados",
                    "Leídos",
                    "Fallidos",
                    "Responde",
                    "1ª respuesta",
                    "Último envío",
                  ].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        textAlign: i === 0 || i === 7 ? "left" : "right",
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
                {data.byPhone.map((p) => {
                  const cell = (v: number, color?: string) => (
                    <td
                      style={{
                        padding: "7px 10px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: v > 0 ? color : "var(--text-3)",
                      }}
                    >
                      {v || "—"}
                    </td>
                  );
                  return (
                    <tr key={p.phone} style={{ borderBottom: "1px solid var(--border-1)" }}>
                      <td
                        style={{
                          padding: "7px 10px",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: 12,
                        }}
                      >
                        {p.phone}
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 600,
                        }}
                      >
                        {p.sends}
                      </td>
                      {cell(p.delivered + p.read, "var(--accent-cyan)")}
                      {cell(p.read, "var(--accent-violet)")}
                      {cell(p.failed, "var(--accent-red)")}
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>
                        {p.responded ? (
                          <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>Sí</span>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>—</span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: p.firstResponseSec != null ? "var(--text-1)" : "var(--text-3)",
                        }}
                      >
                        {fmtDur(p.firstResponseSec)}
                      </td>
                      <td style={{ padding: "7px 10px", color: "var(--text-3)", fontSize: 11 }}>
                        {p.lastSentAt ? new Date(p.lastSentAt).toLocaleString("es-PE") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.response && !data.response.inboundTracked && (
            <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
              La <b>tasa de respuesta</b> y el <b>tiempo de 1ª respuesta</b> se miden con el inbound
              de WhatsApp del inbox (Pilar 6). Para números <b>anclados a Connect</b> el inbound
              vive en Connect, así que la respuesta no se mide aquí.
            </div>
          )}
        </div>
      )}

      {/* R18 — rendimiento POR AGENTE (de las conversaciones del inbox omnicanal,
          no por facultad). Solo aparece si hay conversaciones de WhatsApp atendidas
          por un agente humano (los mensajes del bot no cuentan). */}
      {data.byAgent && data.byAgent.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 8,
            }}
          >
            Por agente · {data.byAgent.length}{" "}
            {data.byAgent.length === 1 ? "ejecutivo" : "ejecutivos"}
            <span
              className="muted"
              style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}
            >
              · respuestas de WhatsApp del inbox (R18)
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-1)" }}>
                  {["Agente", "Conversaciones", "Respuestas", "T. respuesta prom."].map((h, i) => (
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
                {data.byAgent.map((a) => (
                  <tr key={a.agent} style={{ borderBottom: "1px solid var(--border-1)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{a.agent}</td>
                    <td
                      style={{
                        padding: "7px 10px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                      }}
                    >
                      {a.conversations}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {a.replies}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: a.avgResponseSec != null ? "var(--accent-cyan)" : "var(--text-3)",
                      }}
                    >
                      {fmtDur(a.avgResponseSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        automáticamente desde un número de WhatsApp{" "}
        <strong>de Meta no anclado a Amazon Connect</strong> (ARIA recibe los recibos de entrega).
        Para un número <strong>anclado a Connect</strong> (chat de agentes), los eventos van a
        Connect y el agregado vive en{" "}
        <a
          href="https://business.facebook.com/wa/manage/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-cyan)" }}
        >
          Meta WhatsApp Manager → Analytics
        </a>
        . Configura el modo de cada número en Configuración → Canales.
      </div>
    </div>
  );
}
