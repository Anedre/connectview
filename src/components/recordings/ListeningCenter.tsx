import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Phone, MessageCircle, Mail, Sparkles, ArrowRight, Clock } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { initials } from "@/lib/initials";
import type { RecentLead } from "@/types/recordings";

/**
 * ListeningCenter — el "Centro de escucha": el estado inicial de Grabaciones cuando
 * aún no elegiste un contacto. Reemplaza el card vacío por un dashboard con gancho:
 * búsqueda protagonista + pulso del día + una "línea de vida" de las últimas 24 h
 * (cada interacción como un punto en el tiempo, por canal) + rejilla de recientes
 * ricos. Todo sale de manage-leads?recent (ya con authedFetch).
 */

type ChanKey = "call" | "chat" | "email" | "other";
function channelOf(l: RecentLead): ChanKey {
  const c = (l.lastActivity?.channel || l.source || "").toLowerCase();
  if (/(llam|call|voz|voice|telef|phone)/.test(c)) return "call";
  if (/(whatsapp|\bwa\b|chat|instagram|messenger|facebook|meta)/.test(c)) return "chat";
  if (/(correo|email|mail)/.test(c)) return "email";
  return "other";
}
const CHAN_META: Record<ChanKey, { label: string; color: string; Icon: typeof Phone }> = {
  call: { label: "Llamada", color: "var(--cyan)", Icon: Phone },
  chat: { label: "Chat", color: "var(--green)", Icon: MessageCircle },
  email: { label: "Correo", color: "var(--gold)", Icon: Mail },
  other: { label: "Actividad", color: "var(--text-3)", Icon: Clock },
};
function tsOf(l: RecentLead): number {
  const t = new Date(l.updatedAt || l.createdAt || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function relTime(ms: number): string {
  if (!ms) return "—";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(ms).toLocaleDateString();
}
function activityText(l: RecentLead): string {
  const a = l.lastActivity;
  if (!a) return "Sin actividad reciente";
  if (a.type === "gestion") return `Gestión${a.stageLabel ? ` · ${a.stageLabel}` : ""}`;
  if (a.type === "stage_change") return `Etapa → ${a.stageLabel || "?"}`;
  if (a.type === "interaccion")
    return `${a.channel || "Interacción"}${a.untyped ? " · sin tipificar" : ""}`;
  return a.channel || a.type || "Actividad";
}

export function ListeningCenter({
  onPick,
  onSearch,
}: {
  onPick: (l: RecentLead) => void;
  onSearch: () => void;
}) {
  const [rows, setRows] = useState<RecentLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [chanFilter, setChanFilter] = useState<ChanKey | "all">("all");
  const [hover, setHover] = useState<RecentLead | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) {
      setLoading(false);
      return;
    }
    authedFetch(`${ep.manageLeads}?recent=50`)
      .then((r) => r.json())
      .then((j) => {
        if (mounted.current) setRows(Array.isArray(j.recent) ? (j.recent as RecentLead[]) : []);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Pulso del día (derivado de los recientes).
  const pulse = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600_000;
    let today = 0;
    const byChan: Record<ChanKey, number> = { call: 0, chat: 0, email: 0, other: 0 };
    for (const l of rows) {
      if (tsOf(l) >= dayAgo) today++;
      byChan[channelOf(l)]++;
    }
    const dominant = (Object.entries(byChan) as [ChanKey, number][]).sort((a, b) => b[1] - a[1])[0];
    return { total: rows.length, today, byChan, dominant: dominant?.[1] ? dominant[0] : null };
  }, [rows]);

  // Línea de vida: interacciones de las últimas 24 h posicionadas en el tiempo.
  const lifeline = useMemo(() => {
    const now = Date.now();
    const span = 24 * 3600_000;
    return rows
      .map((l) => ({ l, t: tsOf(l) }))
      .filter((x) => x.t >= now - span)
      .map((x) => ({
        l: x.l,
        pct: Math.max(0, Math.min(100, ((x.t - (now - span)) / span) * 100)),
      }));
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((l) => chanFilter === "all" || channelOf(l) === chanFilter),
    [rows, chanFilter],
  );

  return (
    <div className="lc" style={{ maxWidth: 1080, margin: "0 auto", padding: "8px 4px 40px" }}>
      {/* Hero + búsqueda protagonista */}
      <div className="lc__hero" style={{ textAlign: "center", padding: "18px 0 22px" }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            background: "var(--cyan-soft)",
            color: "var(--cyan)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 12px",
          }}
        >
          <Sparkles size={24} />
        </div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>
          Centro de escucha
        </h2>
        <p className="dim" style={{ fontSize: 13.5, marginTop: 5, marginBottom: 16 }}>
          Toda la historia de cada contacto — llamadas, WhatsApp, emails y archivos, en un solo
          lugar.
        </p>
        <button
          type="button"
          onClick={onSearch}
          className="lc__search"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "min(560px, 92%)",
            margin: "0 auto",
            padding: "12px 16px",
            borderRadius: 14,
            border: "1px solid var(--border-2)",
            background: "var(--bg-1)",
            color: "var(--text-3)",
            fontSize: 14,
            cursor: "text",
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          }}
        >
          <Search size={18} />
          <span style={{ flex: 1, textAlign: "left" }}>
            Buscar contacto por nombre, teléfono o empresa…
          </span>
          <span className="pill" style={{ height: 22, fontSize: 11 }}>
            ⌘K
          </span>
        </button>
      </div>

      {loading ? (
        <div className="dim" style={{ textAlign: "center", padding: 40 }}>
          Cargando el pulso del centro…
        </div>
      ) : rows.length === 0 ? (
        <div
          className="card card__pad"
          style={{ textAlign: "center", padding: 32, maxWidth: 440, margin: "0 auto" }}
        >
          <div className="dim" style={{ fontSize: 13.5 }}>
            Aún no hay contactos recientes. Cuando entren llamadas, chats o correos, aparecerán aquí
            — o búscalos con ⌘K.
          </div>
        </div>
      ) : (
        <>
          {/* Pulso */}
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}
          >
            <PulseStat
              label="Contactos recientes"
              value={pulse.total}
              sub="con actividad"
              color="var(--cyan)"
            />
            <PulseStat
              label="Últimas 24 h"
              value={pulse.today}
              sub="interacciones"
              color="var(--green)"
            />
            <PulseStat
              label="Canal dominante"
              value={pulse.dominant ? CHAN_META[pulse.dominant].label : "—"}
              sub={pulse.dominant ? `${pulse.byChan[pulse.dominant]} contactos` : "sin datos"}
              color={pulse.dominant ? CHAN_META[pulse.dominant].color : "var(--text-3)"}
              text
            />
          </div>

          {/* Línea de vida — las últimas 24 h de un vistazo (elemento innovador) */}
          <div className="card" style={{ padding: "14px 16px 18px", marginBottom: 16 }}>
            <div className="row between" style={{ alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>
                Línea de vida · últimas 24 h
              </span>
              <span className="dim" style={{ fontSize: 11 }}>
                {lifeline.length} interacción{lifeline.length === 1 ? "" : "es"}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 48,
                borderRadius: 10,
                background: "var(--bg-2)",
                overflow: "visible",
              }}
            >
              {/* Eje horizontal */}
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  top: 24,
                  height: 2,
                  background: "var(--border-1)",
                  borderRadius: 2,
                }}
              />
              {lifeline.length === 0 ? (
                <div
                  className="dim"
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                  }}
                >
                  Sin interacciones en las últimas 24 h
                </div>
              ) : (
                lifeline.map(({ l, pct }, i) => {
                  const m = CHAN_META[channelOf(l)];
                  return (
                    <button
                      key={`${l.leadId}-${i}`}
                      type="button"
                      onClick={() => onPick(l)}
                      onMouseEnter={() => setHover(l)}
                      onMouseLeave={() => setHover((h) => (h === l ? null : h))}
                      title={`${l.name || l.phone} · ${m.label} · ${relTime(tsOf(l))}`}
                      style={{
                        position: "absolute",
                        left: `calc(12px + (100% - 24px) * ${(pct / 100).toFixed(4)})`,
                        top: 24,
                        transform: "translate(-50%, -50%)",
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        background: m.color,
                        border: "2px solid var(--bg-1)",
                        cursor: "pointer",
                        padding: 0,
                        boxShadow: hover === l ? `0 0 0 4px ${m.color}33` : "none",
                        transition: "box-shadow .12s, transform .12s",
                        zIndex: hover === l ? 2 : 1,
                      }}
                    />
                  );
                })
              )}
            </div>
            {/* Etiquetas de tiempo + tooltip */}
            <div
              className="row between dim"
              style={{ fontSize: 10.5, marginTop: 6, padding: "0 4px" }}
            >
              <span>hace 24 h</span>
              <span>
                {hover ? `${hover.name || hover.phone} · ${relTime(tsOf(hover))}` : "ahora"}
              </span>
            </div>
          </div>

          {/* Filtros rápidos */}
          <div
            className="row between"
            style={{ alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>
              Contactos recientes
            </span>
            <div className="row gap6" style={{ flexWrap: "wrap" }}>
              {(
                [
                  ["all", "Todos"],
                  ["call", "Llamadas"],
                  ["chat", "Chat"],
                  ["email", "Correo"],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={`btn btn--sm ${chanFilter === k ? "btn--soft" : "btn--ghost"}`}
                  style={{ fontSize: 12 }}
                  onClick={() => setChanFilter(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Rejilla de recientes ricos */}
          {filtered.length === 0 ? (
            <div className="dim" style={{ textAlign: "center", padding: 24, fontSize: 13 }}>
              Ningún contacto con ese filtro.
            </div>
          ) : (
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: 10 }}
            >
              {filtered.slice(0, 24).map((l) => {
                const m = CHAN_META[channelOf(l)];
                return (
                  <button
                    key={l.leadId}
                    type="button"
                    onClick={() => onPick(l)}
                    className="lc__card"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "11px 13px",
                      borderRadius: 12,
                      border: "1px solid var(--border-1)",
                      background: "var(--bg-1)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "border-color .12s, transform .12s, box-shadow .12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = m.color;
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,.06)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-1)";
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        background: "var(--bg-3, var(--bg-2))",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "var(--text-2)",
                        position: "relative",
                      }}
                    >
                      {initials(l.name || l.phone)}
                      <span
                        style={{
                          position: "absolute",
                          right: -2,
                          bottom: -2,
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: m.color,
                          border: "2px solid var(--bg-1)",
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        <m.Icon size={9} color="#fff" strokeWidth={2.5} />
                      </span>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="trunc" style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {l.name || l.phone}
                      </div>
                      <div className="dim trunc" style={{ fontSize: 11.5, marginTop: 1 }}>
                        {activityText(l)}
                      </div>
                    </div>
                    <div className="col" style={{ alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                      <span className="dim" style={{ fontSize: 10.5 }}>
                        {relTime(tsOf(l))}
                      </span>
                      <ArrowRight size={13} style={{ color: "var(--text-3)" }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PulseStat({
  label,
  value,
  sub,
  color,
  text,
}: {
  label: string;
  value: number | string;
  sub: string;
  color: string;
  text?: boolean;
}) {
  return (
    <div className="card" style={{ padding: "12px 14px", borderLeft: `3px solid ${color}` }}>
      <div
        className="dim"
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: text ? 18 : 26,
          fontWeight: 800,
          color: "var(--text-1)",
          marginTop: 3,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 1 }}>
        {sub}
      </div>
    </div>
  );
}
