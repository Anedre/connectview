import { useEffect, useRef, useState, useMemo } from "react";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

interface Counts {
  pending: number;
  dialing: number;
  connected: number;
  done: number;
  no_answer: number;
  failed: number;
}

interface Snapshot {
  ts: number;
  completed: number;
  live: number;
}

interface Props {
  counts: Counts;
  total: number;
  startedAt?: string | null;
}

/**
 * Visualisations for a single campaign:
 *
 *  1. Sparkline of "contactos completados" over the last 5 minutes,
 *     sampled from the rolling polling output.
 *  2. Donut chart of outcome distribution (done / no-answer / failed).
 *  3. Pace gauge — calls/min over the last minute, computed from the
 *     sparkline buffer (delta of completed count).
 *
 * Everything is pure-SVG / inline CSS so we don't pull in chart libs.
 */
export function CampaignCharts({ counts, total, startedAt }: Props) {
  // Rolling buffer of snapshots. ~60 samples × 3s poll ≈ 3 minutes.
  const [buffer, setBuffer] = useState<Snapshot[]>([]);
  const lastCompletedRef = useRef(-1);

  const completed = counts.done + counts.no_answer + counts.failed;
  const live = counts.dialing + counts.connected;

  // Push a new snapshot every time `completed` changes. Otherwise
  // dedup so we don't grow the buffer on every render.
  useEffect(() => {
    if (lastCompletedRef.current === completed && buffer.length > 0) return;
    lastCompletedRef.current = completed;
    setBuffer((prev) => {
      const next = [...prev, { ts: Date.now(), completed, live }];
      // Keep last 60 snapshots
      if (next.length > 60) next.shift();
      return next;
    });
  }, [completed, live, buffer.length]);

  // Pace = calls/min over the last minute window
  const pace = useMemo(() => {
    if (buffer.length < 2) return 0;
    const cutoff = Date.now() - 60_000;
    const recent = buffer.filter((s) => s.ts >= cutoff);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const deltaCompleted = last.completed - first.completed;
    const deltaMs = last.ts - first.ts;
    if (deltaMs <= 0) return 0;
    // Normalize to per-minute
    return Math.round((deltaCompleted * 60_000) / deltaMs);
  }, [buffer]);

  // Sparkline data — last 30 samples of completed count
  const sparkData = useMemo(() => {
    const tail = buffer.slice(-30);
    if (tail.length < 2) return [0, 0];
    return tail.map((s) => s.completed);
  }, [buffer]);

  // Donut segments
  const segments = useMemo(() => {
    const totalOutcomes = counts.done + counts.no_answer + counts.failed;
    if (totalOutcomes === 0) {
      return [];
    }
    return [
      { value: counts.done,      color: "var(--accent-green)", label: "Completados" },
      { value: counts.no_answer, color: "var(--accent-amber)", label: "Sin contestar" },
      { value: counts.failed,    color: "var(--accent-red)",   label: "Fallidos" },
    ].filter((s) => s.value > 0);
  }, [counts.done, counts.no_answer, counts.failed]);

  // Estimated time to completion based on current pace
  const etaMinutes = useMemo(() => {
    if (pace <= 0 || counts.pending <= 0) return null;
    return Math.ceil(counts.pending / pace);
  }, [pace, counts.pending]);

  // Elapsed time since campaign started. Show hours/days when the
  // campaign has been running a while — "1273m en curso" is correct
  // but unreadable; "21h en curso" is what humans want.
  const elapsedLabel = useMemo(() => {
    if (!startedAt) return "0m";
    const ms = Date.now() - new Date(startedAt).getTime();
    if (ms <= 0) return "0m";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
      const remM = minutes - hours * 60;
      return remM > 0 ? `${hours}h ${remM}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remH = hours - days * 24;
    return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
  }, [startedAt]);

  return (
    <Card>
      <div className="card__head">
        <div className="card__title">
          <Icon.Chart size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Métricas en vivo
        </div>
        <span className="card__sub">
          {buffer.length} muestras · {elapsedLabel} en curso
        </span>
      </div>
      <CardBody>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 1fr) 1fr 1fr",
            gap: 16,
            alignItems: "center",
          }}
        >
          {/* ── Donut: outcomes ─────────────────────────────────── */}
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Donut size={108} segments={segments} total={completed} />
            <div className="col" style={{ gap: 4, fontSize: 11 }}>
              {segments.length === 0 ? (
                <div className="muted">Sin resultados todavía</div>
              ) : (
                segments.map((s) => (
                  <div key={s.label} className="row" style={{ gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: s.color,
                      }}
                    />
                    <span className="muted">{s.label}</span>
                    <span
                      className="mono"
                      style={{
                        marginLeft: "auto",
                        color: "var(--text-1)",
                        fontWeight: 600,
                      }}
                    >
                      {s.value}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Sparkline: progress over time ───────────────────── */}
          <div style={{ minWidth: 0 }}>
            <div
              className="muted"
              style={{
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
              }}
            >
              Progreso · últimos {Math.min(buffer.length, 30)} samples
            </div>
            <div
              style={{
                background: "var(--bg-2)",
                borderRadius: 8,
                padding: "12px 14px",
                position: "relative",
              }}
            >
              <ResponsiveSpark
                data={sparkData}
                total={total}
                color="var(--accent-cyan)"
                fill="var(--accent-cyan-soft)"
                height={56}
              />
              <div
                className="row"
                style={{
                  position: "absolute",
                  top: 12,
                  right: 14,
                  gap: 6,
                  alignItems: "baseline",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--text-1)",
                    lineHeight: 1,
                  }}
                >
                  {completed}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  / {total}
                </span>
              </div>
              <div
                className="muted"
                style={{
                  fontSize: 10,
                  marginTop: 4,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>inicio</span>
                <span>ahora</span>
              </div>
            </div>
          </div>

          {/* ── Pace gauge ──────────────────────────────────────── */}
          <Gauge value={pace} eta={etaMinutes} pending={counts.pending} />
        </div>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut                                                                       */
/* -------------------------------------------------------------------------- */

function Donut({
  size,
  segments,
  total,
}: {
  size: number;
  segments: Array<{ value: number; color: string; label: string }>;
  total: number;
}) {
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;

  const sum = segments.reduce((acc, s) => acc + s.value, 0) || 1;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--bg-3)"
        strokeWidth={10}
      />
      {segments.map((s, i) => {
        const frac = s.value / sum;
        const dash = c * frac;
        const offset = -acc * c;
        acc += frac;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={10}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        );
      })}
      {/* Center label */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          fontWeight: 700,
          fill: "var(--text-1)",
        }}
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        style={{
          fontSize: 9,
          fill: "var(--text-3)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        cerrados
      </text>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Gauge                                                                       */
/* -------------------------------------------------------------------------- */

function Gauge({
  value,
  eta,
  pending,
}: {
  value: number;
  eta: number | null;
  pending: number;
}) {
  // Half-circle gauge. Max 60 calls/min covers any realistic outbound
  // campaign pace; auto-scale up beyond that.
  const max = Math.max(60, value * 1.5);
  const pct = Math.min(1, value / max);

  // Geometry — the arc is a half circle opening UP. Centered at
  // (cx, cy); the arc tops out at (cx, cy - r). ViewBox height MUST
  // fit cy + strokeW/2 so the bottom of the stroke isn't clipped.
  const w = 168;
  const r = 60;
  const stroke = 12;
  const cx = w / 2;
  const cy = r + stroke / 2 + 4;       // arc center (with top padding)
  const h = cy + stroke / 2 + 4;        // svg height — arc fits perfectly

  // Angles: counter-clockwise from 0 (right) to π (left) covers the
  // top half. We rotate so that pct=0 → left end, pct=1 → right end.
  const valueAngle = Math.PI - pct * Math.PI;

  const polar = (a: number) => ({
    x: cx + r * Math.cos(a),
    y: cy - r * Math.sin(a), // SVG y grows down, so flip sin
  });
  const startPt = polar(Math.PI); // left  (cx - r, cy)
  const endPt   = polar(0);       // right (cx + r, cy)
  const valPt   = polar(valueAngle);

  // Arc going from start to end through the TOP of the circle — that's
  // clockwise in SVG (left → up → right), so sweep-flag = 1.
  const bgArc  = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 0 1 ${endPt.x} ${endPt.y}`;
  const valArc = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 0 1 ${valPt.x} ${valPt.y}`;

  // Color by intensity.
  const color =
    value < 5
      ? "var(--accent-amber)"
      : value < 30
      ? "var(--accent-cyan)"
      : "var(--accent-green)";

  // Where to place the numeric label — inside the arc, near the bottom.
  const numY = cy - 12;
  // "0"-state collapses the value-arc, so don't render it (avoids a
  // tiny rounded dot at the left edge from the strokeLinecap).
  const showValueArc = pct > 0.001;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        className="muted"
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
          alignSelf: "flex-start",
        }}
      >
        Pace · llamadas/min
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <path
          d={bgArc}
          stroke="var(--bg-3)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
        />
        {showValueArc && (
          <path
            d={valArc}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            style={{ transition: "d 0.5s ease" }}
          />
        )}
        <text
          x={cx}
          y={numY}
          textAnchor="middle"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 30,
            fontWeight: 700,
            fill: "var(--text-1)",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </text>
      </svg>
      <div
        className="muted"
        style={{ fontSize: 10.5, marginTop: 4, textAlign: "center" }}
      >
        {eta !== null
          ? `ETA ${eta} min · ${pending} pendientes`
          : pending > 0
          ? `${pending} pendientes`
          : "campaña al día"}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ResponsiveSpark                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Width-fills-parent sparkline. The shared `<Spark>` primitive uses a
 * fixed pixel width, which made the campaign progress line only cover
 * ~40% of the available column — even when the campaign was 100%
 * complete. This version uses a fixed viewBox + `preserveAspectRatio
 * none` so the SVG stretches to whatever width the container provides.
 *
 * Also: we always plot against the campaign `total` as the Y maximum
 * (instead of `Math.max(...data)`), so a campaign that's 80% done
 * actually shows the line at 80% height — not at 100% just because
 * every sampled point happened to be the same value.
 */
function ResponsiveSpark({
  data,
  total,
  color,
  fill,
  height,
}: {
  data: number[];
  total: number;
  color: string;
  fill?: string;
  height: number;
}) {
  // Virtual coordinate space — preserveAspectRatio="none" stretches
  // x to whatever the container width is, while y stays at `height`.
  const VB_W = 1000;
  const VB_H = height;

  const points = useMemo(() => {
    if (!data?.length) return [] as Array<{ x: number; y: number }>;
    const yMax = Math.max(1, total);
    const n = Math.max(2, data.length);
    return data.map((v, i) => {
      const x = (i / (n - 1)) * VB_W;
      // Clamp to [0, yMax] so out-of-range data doesn't shoot off the chart.
      const ratio = Math.min(1, Math.max(0, v / yMax));
      const y = VB_H - ratio * (VB_H - 2) - 1;
      return { x, y };
    });
  }, [data, total, VB_H]);

  const linePath = useMemo(() => {
    if (points.length === 0) return "";
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
  }, [points]);

  const areaPath = useMemo(() => {
    if (!fill || points.length === 0) return "";
    return (
      `M 0 ${VB_H} ` +
      points
        .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(" ") +
      ` L ${VB_W} ${VB_H} Z`
    );
  }, [points, fill, VB_H]);

  return (
    <svg
      width="100%"
      height={VB_H}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      {fill && <path d={areaPath} fill={fill} stroke="none" />}
      <path
        d={linePath}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        // `vector-effect` keeps the stroke at 2px regardless of the
        // horizontal scaling caused by preserveAspectRatio="none".
        // Without it, when the SVG is stretched wide, the line would
        // be visibly thicker on the horizontal segments than on the
        // vertical ones.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
