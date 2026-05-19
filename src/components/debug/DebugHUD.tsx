/**
 * DebugHUD — floating diagnostic overlay for the flicker hunt.
 *
 * Activate with `?debug=1` in the URL. Renders nothing otherwise.
 *
 * Shows:
 *   - Live stream of recent debug events (changes / renders / info)
 *   - Per-component render counter
 *   - Per-label change frequency stats
 *   - Filter by kind, pin/unpin, pause stream
 *
 * Subscribes to `subscribeDebug()` from `lib/debugTrace.ts`. Lightweight,
 * no external deps. When `?debug=1` is OFF, the entire component is a
 * no-op (returns null immediately).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEBUG_ON,
  type DebugEvent,
  type DebugEventKind,
  getDebugEvents,
  subscribeDebug,
} from "@/lib/debugTrace";

const KIND_STYLE: Record<DebugEventKind, { fg: string; bg: string; label: string }> = {
  change: { fg: "#fbbf24", bg: "rgba(251,191,36,0.12)", label: "Δ" },
  render: { fg: "#34d399", bg: "rgba(52,211,153,0.12)", label: "R" },
  info:   { fg: "#60a5fa", bg: "rgba(96,165,250,0.12)", label: "i" },
};

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function fmtDetail(detail: unknown): string {
  if (detail == null) return "";
  try {
    if (typeof detail === "string") return detail;
    const s = JSON.stringify(detail);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return String(detail);
  }
}

interface AggregatedStat {
  label: string;
  count: number;
  kinds: Record<DebugEventKind, number>;
  lastTs: number;
}

function aggregateStats(events: readonly DebugEvent[]): AggregatedStat[] {
  const map = new Map<string, AggregatedStat>();
  for (const ev of events) {
    const cur = map.get(ev.label) ?? {
      label: ev.label,
      count: 0,
      kinds: { change: 0, render: 0, info: 0 },
      lastTs: 0,
    };
    cur.count += 1;
    cur.kinds[ev.kind] += 1;
    cur.lastTs = Math.max(cur.lastTs, ev.ts);
    map.set(ev.label, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export function DebugHUD() {
  // Guard at the top — when not in debug mode, do nothing at all. No
  // subscriptions, no state, no event handlers.
  if (!DEBUG_ON) return null;
  return <DebugHUDInner />;
}

function DebugHUDInner() {
  const [events, setEvents] = useState<readonly DebugEvent[]>(() => [...getDebugEvents()]);
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<"stream" | "stats">("stream");
  const [kindFilter, setKindFilter] = useState<Record<DebugEventKind, boolean>>({
    change: true,
    render: true,
    info: true,
  });
  const [labelFilter, setLabelFilter] = useState("");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    // Pull-based snapshot every 250ms so render stats update even when
    // an event class is muted. Plus push-based subscribe for low latency.
    const interval = setInterval(() => {
      if (pausedRef.current) return;
      setEvents([...getDebugEvents()]);
    }, 250);
    const unsub = subscribeDebug(() => {
      if (pausedRef.current) return;
      setEvents([...getDebugEvents()]);
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, []);

  const filtered = useMemo(() => {
    const lf = labelFilter.trim().toLowerCase();
    return events.filter(
      (ev) =>
        kindFilter[ev.kind] &&
        (!lf || ev.label.toLowerCase().includes(lf))
    );
  }, [events, kindFilter, labelFilter]);

  const stats = useMemo(() => aggregateStats(events), [events]);

  // For the stream view — newest at top, capped at ~60 rows so the
  // panel never grows unbounded.
  const streamRows = useMemo(() => filtered.slice(-80).reverse(), [filtered]);

  // Per-second event rate (last 10s)
  const eventRate = useMemo(() => {
    const since = Date.now() - 10_000;
    const recent = events.filter((e) => e.ts >= since).length;
    return (recent / 10).toFixed(1);
  }, [events]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 99999,
          background: "rgba(15,15,18,0.92)",
          color: "#fbbf24",
          border: "1px solid rgba(251,191,36,0.5)",
          borderRadius: 8,
          padding: "6px 12px",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
        title="Abrir Debug HUD"
      >
        🛠 debug · {events.length}
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        width: 460,
        maxHeight: "70vh",
        zIndex: 99999,
        background: "rgba(15,15,18,0.96)",
        color: "#e5e7eb",
        border: "1px solid rgba(251,191,36,0.45)",
        borderRadius: 10,
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 11,
        boxShadow: "0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backdropFilter: "blur(6px)",
      }}
    >
      {/* Head */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(251,191,36,0.06)",
        }}
      >
        <span style={{ color: "#fbbf24", fontWeight: 700 }}>🛠 vox-debug HUD</span>
        <span style={{ marginLeft: "auto", color: "#9ca3af" }}>
          {events.length} ev · {eventRate}/s
        </span>
        <button
          onClick={() => setPaused((p) => !p)}
          style={hudBtnStyle(paused ? "#fbbf24" : "#e5e7eb")}
          title={paused ? "Reanudar" : "Pausar"}
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          onClick={() => {
            setEvents([]);
            // also clear underlying buffer
            (getDebugEvents() as DebugEvent[]).length = 0;
          }}
          style={hudBtnStyle()}
          title="Limpiar buffer"
        >
          ⌫
        </button>
        <button
          onClick={() => setCollapsed(true)}
          style={hudBtnStyle()}
          title="Minimizar"
        >
          —
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {(["stream", "stats"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "6px 10px",
              background: tab === t ? "rgba(251,191,36,0.1)" : "transparent",
              color: tab === t ? "#fbbf24" : "#9ca3af",
              border: "none",
              borderBottom: tab === t ? "2px solid #fbbf24" : "2px solid transparent",
              fontFamily: "inherit",
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              cursor: "pointer",
            }}
          >
            {t === "stream" ? "Stream" : "Stats"}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "6px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {(Object.keys(kindFilter) as DebugEventKind[]).map((k) => {
          const meta = KIND_STYLE[k];
          const on = kindFilter[k];
          return (
            <button
              key={k}
              onClick={() => setKindFilter((f) => ({ ...f, [k]: !f[k] }))}
              style={{
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${on ? meta.fg : "rgba(255,255,255,0.1)"}`,
                background: on ? meta.bg : "transparent",
                color: on ? meta.fg : "#6b7280",
                fontFamily: "inherit",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              {meta.label} {k}
            </button>
          );
        })}
        <input
          type="text"
          placeholder="filter label…"
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 80,
            background: "rgba(255,255,255,0.04)",
            color: "#e5e7eb",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 4,
            padding: "2px 6px",
            fontFamily: "inherit",
            fontSize: 10,
            outline: "none",
          }}
        />
      </div>

      {/* Body */}
      <div
        style={{
          overflowY: "auto",
          flex: 1,
          minHeight: 120,
        }}
      >
        {tab === "stream" ? (
          <StreamView rows={streamRows} />
        ) : (
          <StatsView stats={stats.filter((s) =>
            !labelFilter.trim() ||
            s.label.toLowerCase().includes(labelFilter.trim().toLowerCase())
          )} />
        )}
      </div>
    </div>
  );
}

function StreamView({ rows }: { rows: DebugEvent[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>
        Esperando eventos… (instrumenta tus componentes con `traceChange` /
        `useDebugRender`).
      </div>
    );
  }
  return (
    <div>
      {rows.map((ev, i) => {
        const meta = KIND_STYLE[ev.kind];
        return (
          <div
            key={`${ev.ts}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "20px 88px 1fr",
              gap: 6,
              padding: "3px 8px",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                color: meta.fg,
                background: meta.bg,
                borderRadius: 3,
                textAlign: "center",
                fontSize: 9.5,
                lineHeight: "14px",
                fontWeight: 700,
              }}
            >
              {meta.label}
            </span>
            <span style={{ color: "#6b7280", fontSize: 9.5 }}>{fmtTime(ev.ts)}</span>
            <div style={{ minWidth: 0 }}>
              <span style={{ color: "#e5e7eb", fontWeight: 600 }}>{ev.label}</span>
              {ev.detail != null && (
                <div
                  style={{
                    color: "#9ca3af",
                    fontSize: 10,
                    marginTop: 1,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {fmtDetail(ev.detail)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatsView({ stats }: { stats: AggregatedStat[] }) {
  if (stats.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>
        Sin estadísticas todavía.
      </div>
    );
  }
  const max = stats[0]?.count || 1;
  return (
    <div>
      {stats.map((s) => {
        const pct = (s.count / max) * 100;
        const ageMs = Date.now() - s.lastTs;
        return (
          <div
            key={s.label}
            style={{
              padding: "5px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  color: "#e5e7eb",
                  fontSize: 10.5,
                  fontWeight: 600,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.label}
              </span>
              <span style={{ color: "#9ca3af", fontSize: 9.5 }}>
                {ageMs < 1000 ? `${ageMs}ms` : `${(ageMs / 1000).toFixed(1)}s`} ago
              </span>
              <span
                style={{
                  color: "#fbbf24",
                  fontFamily: "inherit",
                  fontSize: 10,
                  fontWeight: 700,
                  minWidth: 28,
                  textAlign: "right",
                }}
              >
                {s.count}
              </span>
            </div>
            <div
              style={{
                height: 3,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 2,
                overflow: "hidden",
                display: "flex",
              }}
            >
              <div
                style={{
                  width: `${(s.kinds.change / s.count) * pct}%`,
                  background: KIND_STYLE.change.fg,
                }}
              />
              <div
                style={{
                  width: `${(s.kinds.render / s.count) * pct}%`,
                  background: KIND_STYLE.render.fg,
                }}
              />
              <div
                style={{
                  width: `${(s.kinds.info / s.count) * pct}%`,
                  background: KIND_STYLE.info.fg,
                }}
              />
            </div>
            <div
              style={{
                marginTop: 2,
                color: "#6b7280",
                fontSize: 9.5,
                display: "flex",
                gap: 8,
              }}
            >
              {s.kinds.change > 0 && (
                <span style={{ color: KIND_STYLE.change.fg }}>Δ {s.kinds.change}</span>
              )}
              {s.kinds.render > 0 && (
                <span style={{ color: KIND_STYLE.render.fg }}>R {s.kinds.render}</span>
              )}
              {s.kinds.info > 0 && (
                <span style={{ color: KIND_STYLE.info.fg }}>i {s.kinds.info}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function hudBtnStyle(color = "#9ca3af"): React.CSSProperties {
  return {
    background: "transparent",
    color,
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4,
    width: 22,
    height: 22,
    fontFamily: "inherit",
    fontSize: 11,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  };
}
