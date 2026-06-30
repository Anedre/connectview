import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useProgram } from "@/context/ProgramContext";

/**
 * AttributionReport (Pilar 2) — "golpes → conversión": tasa de conversión,
 * golpes/días promedio al cierre, conversión por # de golpes y golpes por canal.
 * Respeta el programa activo del switcher global (Pilar 1).
 */

interface Attribution {
  totalLeads: number;
  converted: number;
  conversionRate: number;
  avgGolpes: number;
  avgGolpesToClose: number;
  avgDaysToClose: number;
  totalGolpes: number;
  byBucket: Array<{ label: string; leads: number; converted: number; rate: number }>;
  byChannel: Record<string, number>;
}

const CH_COLORS: Record<string, string> = {
  Llamada: "var(--accent-cyan)",
  WhatsApp: "var(--accent-green)",
  Correo: "var(--accent-amber)",
  Chat: "var(--accent-pink)",
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function AttributionReport() {
  const { activeProgramId, activeProgram } = useProgram();
  const [data, setData] = useState<Attribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scoped = !!activeProgramId && activeProgramId !== "all" && activeProgramId !== "none";

  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const url = `${ep.manageLeads}?report=attribution${scoped ? `&programId=${encodeURIComponent(activeProgramId)}` : ""}`;
    authedFetch(url)
      .then((r) => r.json())
      .then((d) => setData(d.attribution || null))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [activeProgramId, scoped]);

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-2)", borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Atribución · golpes → conversión</h3>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {scoped ? `Programa: ${activeProgram?.name || "—"}` : "Todos los programas"}
        </span>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-3)", padding: 24, textAlign: "center" }}>Cargando atribución…</div>
      ) : error ? (
        <div className="chip chip--red" style={{ display: "block", padding: "8px 12px" }}>Error: {error}</div>
      ) : !data || data.totalLeads === 0 ? (
        <div style={{ color: "var(--text-3)", padding: 24, textAlign: "center" }}>Sin leads para analizar en este alcance.</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label="Conversión" value={pct(data.conversionRate)} hint={`${data.converted}/${data.totalLeads} leads`} />
            <Kpi label="Golpes al cierre" value={data.avgGolpesToClose ? fmt1(data.avgGolpesToClose) : "—"} hint="promedio para convertir" />
            <Kpi label="Días al cierre" value={data.avgDaysToClose ? String(Math.round(data.avgDaysToClose)) : "—"} hint="del 1er toque al cierre" />
            <Kpi label="Golpes totales" value={String(data.totalGolpes)} hint={`${fmt1(data.avgGolpes)} por lead`} />
          </div>

          {/* Conversión por # de golpes */}
          <div style={{ marginTop: 18 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-2)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Conversión por # de golpes
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.byBucket.map((b) => (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 40, fontSize: 12, color: "var(--text-2)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.label}</span>
                  <div style={{ flex: 1, height: 18, background: "var(--bg-3)", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <div style={{ width: `${Math.round(b.rate * 100)}%`, height: "100%", background: "var(--accent-green)", minWidth: b.converted > 0 ? 2 : 0, transition: "width .2s" }} />
                  </div>
                  <span style={{ width: 96, fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                    {pct(b.rate)} · {b.converted}/{b.leads}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Golpes por canal */}
          <div style={{ marginTop: 18 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-2)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Golpes por canal
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(data.byChannel)
                .sort((a, b) => b[1] - a[1])
                .map(([ch, n]) => {
                  const max = Math.max(1, ...Object.values(data.byChannel));
                  return (
                    <div key={ch} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 80, fontSize: 12, color: "var(--text-2)" }}>{ch}</span>
                      <div style={{ flex: 1, height: 18, background: "var(--bg-3)", borderRadius: 5, overflow: "hidden" }}>
                        <div style={{ width: `${Math.round((n / max) * 100)}%`, height: "100%", background: CH_COLORS[ch] || "var(--text-3)" }} />
                      </div>
                      <span style={{ width: 44, fontSize: 11, color: "var(--text-3)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
