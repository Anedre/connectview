import { useMemo } from "react";
import { lighten, saturate, useMounted } from "./execUtils";
import type { ExecCampaign, ExecLiveQueue, ExecSlice } from "./execMock";

/**
 * Paneles SVG/CSS del dashboard ejecutivo (recreación del diseño v2,
 * `views/exec-charts.jsx` + `views/executive.jsx`). Sin ECharts: barras/SVG con
 * gradientes "infografía" animados por CSS (exec.css, respetan reduced-motion).
 */

/* ---------- Ranking de agentes ---------- */
const RANK_COLORS = ["#2BC6E6","#25B873","#A3D63B","#F5C518","#F5A524","#F2722E","#9B8CF0","#ED84C2","#ED5257","#6E8BFF"];
const initialsOf = (n: string) =>
  n.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

export function ExecRank({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="exec-rank">
      {data.map((d, i) => {
        const c = RANK_COLORS[i % RANK_COLORS.length];
        return (
          <div key={d.name} className="exec-rank__row">
            <span className="exec-rank__pos">{i + 1}</span>
            <span className="exec-rank__av" style={{ background: c }}>
              {initialsOf(d.name)}
            </span>
            <div className="exec-rank__body">
              <div className="exec-rank__name">
                <span>{d.name}</span>
                <span className="v">{d.value}</span>
              </div>
              <div className="exec-rank__track">
                <div
                  className="exec-rank__fill"
                  style={{
                    background: `linear-gradient(180deg, ${lighten(c, 0.4)}, ${c} 60%, ${saturate(c, 1)})`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 3px rgba(0,0,0,0.3)",
                    width: `${(d.value / max) * 100}%`,
                    animationDelay: `${i * 0.07}s`,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Embudo de leads (barras horizontales, color por etapa + conversión) ---------- */
// Paleta diversa: un color único por etapa (cicla si hay más etapas).
const FUNNEL_PALETTE = [
  "#2BC6E6", "#25B873", "#A3D63B", "#F5C518", "#F5A524",
  "#F2722E", "#9B8CF0", "#ED84C2", "#ED5257", "#6E8BFF",
];

export function ExecFunnel({
  data,
}: {
  data: Array<{ label: string; value: number; color: string }>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 2 }}>
      {data.map((s, i) => {
        const c = FUNNEL_PALETTE[i % FUNNEL_PALETTE.length];
        const pct = Math.round((s.value / max) * 100);
        // % de conversión respecto de la etapa anterior del embudo.
        const conv =
          i > 0 && data[i - 1].value > 0
            ? Math.round((s.value / data[i - 1].value) * 100)
            : null;
        return (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              title={s.label}
              style={{
                width: 96,
                flexShrink: 0,
                fontSize: 11.5,
                color: "var(--e-t2)",
                textAlign: "right",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.label}
            </span>
            <div
              style={{
                flex: 1,
                height: 20,
                background: "var(--e-card)",
                borderRadius: 6,
                overflow: "hidden",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  borderRadius: 6,
                  transformOrigin: "left",
                  animation: "exec-grow-x 0.7s cubic-bezier(0.2,0.7,0.2,1) both",
                  animationDelay: `${i * 0.05}s`,
                  background: `linear-gradient(90deg, ${lighten(c, 0.18)}, ${c} 70%, ${saturate(c, 1)})`,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)",
                }}
              />
            </div>
            <span
              style={{
                width: 70,
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 700,
                color: "var(--e-t1)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.value}
              {conv != null && (
                <span style={{ color: "var(--e-t3)", fontWeight: 400, fontSize: 10, marginLeft: 4 }}>
                  {conv}%
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Pill bars con ring-badge (contactos por cola) ---------- */
export function ExecPillBars({ data }: { data: ExecSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="exec-pills">
      {data.map((d, i) => {
        const pct = total ? Math.round((d.value / total) * 100) : 0;
        return (
          <div className="exec-pill-row" key={d.name}>
            <span
              className="exec-pill-badge"
              style={{ "--pc": d.color } as React.CSSProperties}
            >
              {d.value}
            </span>
            <div className="exec-pill-main">
              <div className="exec-pill-top">
                <span className="exec-pill-name">{d.name}</span>
                <span className="exec-pill-val">
                  {d.value} · {pct}%
                </span>
              </div>
              <div className="exec-pill-track">
                <div
                  className="exec-pill-fill"
                  style={{
                    background: `linear-gradient(180deg, ${lighten(d.color, 0.34)}, ${d.color} 58%, ${saturate(d.color, 1)})`,
                    width: `${(d.value / max) * 100}%`,
                    animationDelay: `${i * 0.07}s`,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Heatmap (hora × día de semana) ---------- */
const HEAT_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HEAT_HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 08–20

export function ExecHeatmap({
  data,
}: {
  /** Grid 7×13 REAL (conteos absolutos) + max. Sin data → patrón demo. */
  data?: { grid: number[][]; max: number };
}) {
  const mounted = useMounted([data ? "real" : "demo"]);
  // Demo determinístico (solo cuando no hay datos reales — /inicio-demo).
  const demoGrid = useMemo(
    () =>
      HEAT_DAYS.map((_, di) =>
        HEAT_HOURS.map((h) => {
          const dayFactor = di < 5 ? 1 : di === 5 ? 0.45 : 0.18;
          const peak =
            Math.exp(-Math.pow(h - 11, 2) / 14) +
            0.7 * Math.exp(-Math.pow(h - 17, 2) / 10);
          const v = peak * dayFactor;
          return Math.max(0, Math.min(1, v + ((((di * 7 + h) % 5) - 2) * 0.03)));
        })
      ),
    []
  );
  // Normaliza: con data real, v = conteo/max; el title muestra el conteo real.
  const cellOf = (di: number, hi: number): { v: number; count: number | null } => {
    if (data) {
      const count = data.grid[di]?.[hi] ?? 0;
      return { v: data.max > 0 ? count / data.max : 0, count };
    }
    const v = demoGrid[di][hi];
    return { v, count: null };
  };
  const colorFor = (v: number) =>
    `color-mix(in srgb, #F2722E ${Math.round(v * 100)}%, #123A4A)`;
  return (
    <div>
      <div className="exec-heat">
        <div />
        {HEAT_HOURS.map((h) => (
          <div key={h} className="exec-heat__collabel">
            {h}
          </div>
        ))}
        {HEAT_DAYS.map((day, di) => (
          <div key={day} style={{ display: "contents" }}>
            <div className="exec-heat__rowlabel">{day}</div>
            {HEAT_HOURS.map((h, hi) => {
              const { v, count } = cellOf(di, hi);
              return (
                <div
                  key={h}
                  className="exec-heat__cell"
                  title={`${day} ${h}:00 · ${count ?? Math.round(v * 42)} contactos`}
                  style={{
                    background: colorFor(v),
                    opacity: mounted ? 0.12 + v * 0.88 : 0,
                    transition: `opacity 0.5s ${(di * 13 + hi) * 0.006}s`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 14,
          justifyContent: "flex-end",
        }}
      >
        <span style={{ fontSize: 10.5, color: "var(--e-t3)" }}>Menos</span>
        {[0.1, 0.3, 0.55, 0.8, 1].map((v) => (
          <span
            key={v}
            style={{
              width: 16,
              height: 12,
              borderRadius: 3,
              background: colorFor(v),
              opacity: 0.12 + v * 0.88,
            }}
          />
        ))}
        <span style={{ fontSize: 10.5, color: "var(--e-t3)" }}>Más</span>
      </div>
    </div>
  );
}

/* ---------- Campañas activas ---------- */
export function ExecCampaigns({ data }: { data: ExecCampaign[] }) {
  return (
    <div className="exec-camp">
      {data.map((c) => {
        const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
        const running = c.status === "RUNNING";
        return (
          <div key={c.name} className="exec-camp__row">
            <div className="exec-camp__top">
              <span className="exec-camp__name">{c.name}</span>
              <span
                className={`exec-camp__pill exec-camp__pill--${c.status.toLowerCase()}`}
              >
                {running ? "En curso" : "Pausada"}
              </span>
            </div>
            <div className="exec-camp__track">
              <div
                className="exec-camp__fill"
                style={{
                  width: `${pct}%`,
                  background: running
                    ? "linear-gradient(180deg, #5AD6B0, #25B873 60%, #1B8F5A)"
                    : "linear-gradient(180deg, #FAC661, #F5A524 60%, #D8851A)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 3px rgba(0,0,0,0.3)",
                }}
              />
            </div>
            <div className="exec-camp__meta">
              <span>
                {c.done} / {c.total} contactados
              </span>
              <span>{pct}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Colas en tiempo real ---------- */
export function ExecLiveQueues({ data }: { data: ExecLiveQueue[] }) {
  return (
    <div className="exec-lq">
      {data.map((q) => {
        const ok = q.status === "ok";
        return (
          <div key={q.name} className="exec-lq__row">
            <div className="exec-lq__name">
              <span
                className="exec-lq__status"
                style={{ background: ok ? "var(--e-green)" : "var(--e-amber)" }}
              />
              {q.name}
            </div>
            <div className="exec-lq__metric">
              <div className="n" style={{ color: q.enCola > 5 ? "var(--e-amber)" : "var(--e-t1)" }}>
                {q.enCola}
              </div>
              <div className="l">En cola</div>
            </div>
            <div className="exec-lq__metric">
              <div className="n">{q.libres}</div>
              <div className="l">Libres</div>
            </div>
            <div className="exec-lq__metric">
              <div className="n" style={{ fontVariantNumeric: "tabular-nums" }}>
                {q.espera}
              </div>
              <div className="l">Espera</div>
            </div>
            <div className="exec-lq__metric">
              <div className="n" style={{ color: ok ? "var(--e-green)" : "var(--e-amber)" }}>
                {ok ? "✓" : "!"}
              </div>
              <div className="l">{ok ? "OK" : "Alerta"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
