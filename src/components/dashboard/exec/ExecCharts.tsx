import { useMemo } from "react";
import { lighten, saturate, useMounted } from "./execUtils";
import type { ExecCampaign, ExecLiveQueue, ExecSlice } from "./execMock";

/**
 * Paneles SVG/CSS del dashboard ejecutivo (recreación del diseño v2,
 * `views/exec-charts.jsx` + `views/executive.jsx`). Sin ECharts: barras/SVG con
 * gradientes "infografía" animados por CSS (exec.css, respetan reduced-motion).
 */

/* ---------- Ranking de agentes ---------- */
const RANK_COLORS = ["#2E9D8E", "#92C73E", "#F2972E", "#15485A", "#1C97A6"];
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

/* ---------- Embudo de leads ---------- */
export function ExecFunnel({
  data,
}: {
  data: Array<{ label: string; value: number; color: string }>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="exec-funnel">
      {data.map((s, i) => (
        <div key={s.label} className="exec-funnel__stage">
          <span className="exec-funnel__label">{s.label}</span>
          <div className="exec-funnel__barwrap">
            <div
              className="exec-funnel__bar"
              style={{
                background: `linear-gradient(180deg, ${lighten(s.color, 0.38)}, ${s.color} 58%, ${saturate(s.color, 1)})`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 4px rgba(0,0,0,0.3)",
                width: `${(s.value / max) * 100}%`,
                animationDelay: `${i * 0.08}s`,
              }}
            >
              {s.value}
            </div>
          </div>
        </div>
      ))}
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

export function ExecHeatmap() {
  const mounted = useMounted([]);
  const grid = useMemo(
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
  const colorFor = (v: number) =>
    `color-mix(in srgb, #F2972E ${Math.round(v * 100)}%, #15485A)`;
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
              const v = grid[di][hi];
              return (
                <div
                  key={h}
                  className="exec-heat__cell"
                  title={`${day} ${h}:00 · ${Math.round(v * 42)} contactos`}
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
                    ? "linear-gradient(180deg, #45C9B3, #2E9D8E 60%, #247F73)"
                    : "linear-gradient(180deg, #F8B560, #F2972E 60%, #D87A14)",
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
