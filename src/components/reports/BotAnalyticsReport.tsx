import { useEffect, useState } from "react";
import { Bot, CheckCircle2, UserRound, Gauge } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Kpi, KpiRow, BarList } from "@/components/reports/kit";

/**
 * BotAnalyticsReport (Pilar 9 · Fase B) — Reporte del Agente IA: agrega los conv#
 * que el bot-runtime persiste (Pilar 8). Muestra cuántas conversaciones resuelve
 * solo vs deriva a un humano, por qué deriva, su confianza, las fuentes que más
 * cita y las herramientas que más usa. Diferenciador vs Chattigo (sin bots).
 */
interface BotReport {
  windowDays: number;
  total: number;
  resolved: number;
  handoff: number;
  resolveRate: number;
  byReason: Array<{ reason: string; label: string; count: number }>;
  avgConfidence: number | null;
  avgTurns: number;
  totalToolCalls: number;
  toolUsage: Array<{ tool: string; label: string; count: number }>;
  topCitations: Array<{ label: string; count: number }>;
  recent: Array<{
    agentName: string;
    outcome: string;
    handoffReason: string | null;
    handoffLabel: string | null;
    turns: number;
    confidenceAvg: number | null;
    citations: string[];
    lastUserText: string;
    createdAt: string | null;
  }>;
}

const REASON_COLOR: Record<string, string> = {
  low_confidence: "var(--accent-amber)",
  tool_budget: "var(--accent-red)",
  max_turns: "var(--accent-violet)",
  ai_error: "var(--accent-red)",
  agent: "var(--accent-cyan)",
};

export function BotAnalyticsReport() {
  const [data, setData] = useState<BotReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ep = getApiEndpoints();
      if (!ep?.getBotReport) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      try {
        const r = await authedFetch(`${ep.getBotReport}?days=30`);
        const d = await r.json();
        if (!cancelled) setData(d.report || null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-2)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "color-mix(in srgb, var(--iris) 16%, transparent)",
            color: "var(--iris)",
            flex: "0 0 auto",
          }}
        >
          <Bot size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>Agente IA · conversaciones</h3>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1 }}>
            Resolución, derivación y confianza · últimos 30 días
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-3)", padding: 24, textAlign: "center" }}>
          Cargando el reporte del agente…
        </div>
      ) : error ? (
        <div className="chip chip--red" style={{ display: "block", padding: "8px 12px" }}>
          Error: {error}
        </div>
      ) : !data || data.total === 0 ? (
        <div style={{ color: "var(--text-3)", padding: 24, textAlign: "center" }}>
          Todavía no hay conversaciones del agente IA. Pruébalo en /agente → «Probar» y vuelve.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <KpiRow>
            <Kpi
              icon={<Bot size={13} />}
              color="var(--iris)"
              label="Conversaciones"
              value={data.total}
              sub={`${data.avgTurns} turnos · ${data.totalToolCalls} acciones`}
            />
            <Kpi
              icon={<CheckCircle2 size={13} />}
              color="var(--green)"
              label="Resueltas solo"
              value={pct(data.resolveRate)}
              sub={`${data.resolved}/${data.total} sin humano`}
            />
            <Kpi
              icon={<UserRound size={13} />}
              color="var(--gold)"
              label="Derivadas"
              value={data.handoff}
              sub="pasaron a un agente"
            />
            <Kpi
              icon={<Gauge size={13} />}
              color="var(--cyan)"
              label="Confianza prom."
              value={data.avgConfidence != null ? `${data.avgConfidence}%` : "—"}
              sub="autoreportada"
            />
          </KpiRow>

          {/* Motivos de derivación + Herramientas (2 col) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
              marginTop: 20,
            }}
          >
            <div>
              <h4
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--text-2)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Motivos de derivación
              </h4>
              {data.byReason.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  El agente no derivó ninguna conversación. 🎉
                </div>
              ) : (
                <BarList
                  color="var(--gold)"
                  rows={data.byReason.map((r) => ({
                    label: r.label,
                    value: r.count,
                    color: REASON_COLOR[r.reason],
                  }))}
                />
              )}
            </div>
            <div>
              <h4
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--text-2)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Herramientas usadas
              </h4>
              {data.toolUsage.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  Sin herramientas ejecutadas.
                </div>
              ) : (
                <BarList
                  color="var(--iris)"
                  rows={data.toolUsage.map((t) => ({ label: t.label, value: t.count }))}
                />
              )}
            </div>
          </div>

          {/* Fuentes más citadas */}
          {data.topCitations.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h4
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--text-2)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Fuentes más citadas
              </h4>
              <BarList
                color="var(--green)"
                rows={data.topCitations.map((c) => ({ label: c.label, value: c.count }))}
              />
            </div>
          )}

          {/* Conversaciones recientes */}
          <div style={{ marginTop: 20 }}>
            <h4
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                color: "var(--text-2)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Recientes
            </h4>
            <div
              style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--border-1)" }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "var(--bg-2)" }}>
                    {["Resultado", "Turnos", "Confianza", "Fuentes", "Última pregunta"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          color: "var(--text-3)",
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          borderBottom: "1px solid var(--border-1)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((c, i) => (
                    <tr key={i} style={{ background: i % 2 ? "var(--bg-2)" : "transparent" }}>
                      <td
                        style={{ padding: "7px 10px", borderBottom: "1px solid var(--border-1)" }}
                      >
                        {c.outcome === "handoff" ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              color: "var(--accent-amber)",
                              fontWeight: 600,
                            }}
                          >
                            <UserRound size={12} /> {c.handoffLabel || "Derivada"}
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              color: "var(--accent-green)",
                              fontWeight: 600,
                            }}
                          >
                            <CheckCircle2 size={12} /> Resuelta
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          borderBottom: "1px solid var(--border-1)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {c.turns}
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          borderBottom: "1px solid var(--border-1)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {c.confidenceAvg != null ? `${c.confidenceAvg}%` : "—"}
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          borderBottom: "1px solid var(--border-1)",
                          color: "var(--text-3)",
                        }}
                      >
                        {c.citations.length ? c.citations.join(", ") : "—"}
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          borderBottom: "1px solid var(--border-1)",
                          color: "var(--text-2)",
                          maxWidth: 280,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={c.lastUserText}
                      >
                        {c.lastUserText || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
