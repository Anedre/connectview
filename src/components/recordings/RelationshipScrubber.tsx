import { useMemo, useState } from "react";
import { useCallHistory, type CallHistoryRow } from "@/hooks/useCallHistory";

/**
 * RelationshipScrubber — la relación entera como una línea de vida navegable
 * (la "línea de vida" de 24h del Centro de escucha, pero para TODO el historial).
 * Cada interacción es un punto ubicado en el tiempo real, coloreado por canal y
 * con anillo por sentimiento; el hover la describe y el clic la abre. Es la vista
 * macro que complementa la lista vertical del canvas: dónde se concentró la
 * relación, cuándo hubo tensión, de un vistazo.
 */

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function channelColor(channel: string): { color: string; label: string } {
  const c = (channel || "").toUpperCase();
  if (c === "VOICE" || c === "TELEPHONY") return { color: "var(--cyan)", label: "Llamada" };
  if (c === "CHAT") return { color: "var(--green)", label: "WhatsApp" };
  if (c === "EMAIL") return { color: "var(--gold)", label: "Email" };
  return { color: "var(--text-3)", label: channel || "Contacto" };
}

const SENT_RING: Record<string, string> = {
  POSITIVE: "var(--green)",
  NEGATIVE: "var(--red)",
  MIXED: "var(--gold)",
};

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`;
}

export function RelationshipScrubber({
  phone,
  onOpen,
}: {
  phone: string | null;
  /** Abre la interacción: voz → reproductor; chat/email → su pestaña. */
  onOpen: (contactId: string, channel: string) => void;
}) {
  const { rows, loading } = useCallHistory(phone);
  const [hover, setHover] = useState<CallHistoryRow | null>(null);

  const { items, min, max, monthTicks } = useMemo(() => {
    const valid = rows.filter(
      (r) => r.initiationTimestamp && !Number.isNaN(Date.parse(r.initiationTimestamp)),
    );
    if (valid.length === 0)
      return { items: [], min: 0, max: 0, monthTicks: [] as { pct: number; label: string }[] };
    const times = valid.map((r) => Date.parse(r.initiationTimestamp));
    let lo = Math.min(...times);
    let hi = Math.max(...times);
    if (lo === hi) {
      lo -= 86_400_000;
      hi += 86_400_000;
    }
    const span = hi - lo;
    const items = valid
      .map((r) => ({ row: r, pct: ((Date.parse(r.initiationTimestamp) - lo) / span) * 100 }))
      .sort((a, b) => a.pct - b.pct);

    // Marcas de mes (hasta ~6) repartidas por el eje.
    const ticks: { pct: number; label: string }[] = [];
    const start = new Date(lo);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const cur = new Date(start);
    const monthsSpan = (hi - lo) / (30 * 86_400_000);
    const stepMonths = Math.max(1, Math.ceil(monthsSpan / 6));
    let guard = 0;
    while (cur.getTime() <= hi && guard < 60) {
      const t = cur.getTime();
      if (t >= lo) ticks.push({ pct: ((t - lo) / span) * 100, label: MES[cur.getMonth()] });
      cur.setMonth(cur.getMonth() + stepMonths);
      guard++;
    }
    return { items, min: lo, max: hi, monthTicks: ticks };
  }, [rows]);

  // Con 0-1 interacciones no hay una línea que recorrer.
  if (loading || items.length < 2) return null;

  return (
    <div className="card" style={{ padding: "14px 16px 14px" }}>
      <div className="row between" style={{ alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>
          Recorrido de la relación
        </span>
        <span className="dim" style={{ fontSize: 11 }}>
          {items.length} interacciones · {fmtDate(min)} — {fmtDate(max)}
        </span>
      </div>

      <div style={{ position: "relative", height: 44, marginBottom: 4 }}>
        {/* Eje */}
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: 22,
            height: 2,
            background: "var(--border-1)",
            borderRadius: 2,
          }}
        />
        {/* Marcas de mes */}
        {monthTicks.map((t, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(12px + (100% - 24px) * ${(t.pct / 100).toFixed(4)})`,
              top: 30,
              transform: "translateX(-50%)",
              fontSize: 9,
              color: "var(--text-3)",
            }}
          >
            {t.label}
          </div>
        ))}
        {/* Puntos por interacción */}
        {items.map(({ row, pct }, i) => {
          const ch = channelColor(row.channel);
          const ring = SENT_RING[(row.sentiment || "").toUpperCase()];
          const isHover = hover === row;
          return (
            <button
              key={`${row.contactId}-${i}`}
              type="button"
              onClick={() => onOpen(row.contactId, row.channel)}
              onMouseEnter={() => setHover(row)}
              onMouseLeave={() => setHover((h) => (h === row ? null : h))}
              title={`${ch.label} · ${fmtDate(Date.parse(row.initiationTimestamp))}`}
              style={{
                position: "absolute",
                left: `calc(12px + (100% - 24px) * ${(pct / 100).toFixed(4)})`,
                top: 22,
                transform: "translate(-50%, -50%)",
                width: isHover ? 15 : 12,
                height: isHover ? 15 : 12,
                borderRadius: "50%",
                background: ch.color,
                border: ring ? `2px solid ${ring}` : "2px solid var(--bg-1)",
                boxShadow: isHover ? `0 0 0 4px ${ch.color}33` : "0 0 0 1px var(--bg-1)",
                cursor: "pointer",
                padding: 0,
                transition: "width .12s, height .12s, box-shadow .12s",
                zIndex: isHover ? 3 : 1,
              }}
            />
          );
        })}
      </div>

      {/* Leyenda / detalle del hover */}
      <div className="row between" style={{ fontSize: 10.5, marginTop: 4 }}>
        <span className="row gap12" style={{ color: "var(--text-3)", flexWrap: "wrap" }}>
          <Legend color="var(--cyan)" label="Llamada" />
          <Legend color="var(--green)" label="WhatsApp" />
          <Legend color="var(--gold)" label="Email" />
        </span>
        <span style={{ color: "var(--text-2)", fontWeight: 600, minHeight: 14 }}>
          {hover
            ? `${channelColor(hover.channel).label} · ${fmtDate(Date.parse(hover.initiationTimestamp))}`
            : "El anillo marca el sentimiento"}
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="row gap4" style={{ alignItems: "center" }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} /> {label}
    </span>
  );
}
