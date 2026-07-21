import { useEffect, useRef, useState, useMemo } from "react";
import type { CampaignContactRow } from "@/hooks/useCampaignContacts";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

type LiveContact = {
  rowId: string;
  phone: string;
  customerName?: string;
  status: string;
  agentUsername?: string;
  /** Contacto de Connect de la llamada viva — habilita el "Colgar" admin. */
  connectContactId?: string;
};

interface Props {
  liveContacts: LiveContact[];
  contacts: CampaignContactRow[];
  resolveAgentLabel: (raw: string | undefined | null) => string;
  /** WhatsApp: feed de envíos (sin agentes ni "conectado/sin contestar"). */
  isWhatsApp?: boolean;
  /** Colgar una llamada viva (control admin). Si viene, cada fila de
   *  "En vivo ahora" con connectContactId muestra el botón Colgar. */
  onHangup?: (lc: LiveContact) => void | Promise<void>;
}

interface FeedEvent {
  ts: number;
  rowId: string;
  type: "dialing" | "connected" | "done" | "no_answer" | "failed";
  phone: string;
  customerName?: string;
  agentUsername?: string;
}

const TYPE_META: Record<
  FeedEvent["type"],
  { Icn: typeof Icon.Phone; color: string; label: string }
> = {
  dialing: { Icn: Icon.Phone, color: "var(--accent-cyan)", label: "Marcando" },
  connected: { Icn: Icon.PhoneIn, color: "var(--accent-green)", label: "Conectado" },
  done: { Icn: Icon.Check, color: "var(--accent-green)", label: "Completado" },
  no_answer: { Icn: Icon.Phone, color: "var(--accent-amber)", label: "Sin contestar" },
  failed: { Icn: Icon.Close, color: "var(--accent-red)", label: "Fallido" },
};

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/**
 * Two-column campaign activity panel:
 *   1. Live feed — chronological stream of contact state transitions,
 *      derived from polling deltas. Each time a row changes status
 *      we push an event; oldest events trim out so the list stays
 *      bounded.
 *   2. Per-agent leaderboard — handled / connected / done counts
 *      grouped by `agentUsername`, so the manager can spot uneven
 *      load or stuck agents.
 */
export function CampaignActivity({
  liveContacts,
  contacts,
  resolveAgentLabel,
  isWhatsApp,
  onHangup,
}: Props) {
  // Etiquetas/íconos del feed según canal (WhatsApp: envío, no marcado).
  const metaFor = (t: FeedEvent["type"]) => {
    const base = TYPE_META[t];
    if (!isWhatsApp) return base;
    if (t === "dialing") return { Icn: Icon.WhatsApp, color: base.color, label: "Enviando" };
    if (t === "done") return { Icn: base.Icn, color: base.color, label: "Enviado" };
    return base;
  };
  const [events, setEvents] = useState<FeedEvent[]>([]);
  // Track previous status of each row so we can detect transitions.
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  // On each `contacts` update, diff against previous snapshot and
  // emit one feed event per real status change.
  useEffect(() => {
    if (contacts.length === 0) return;
    const prev = prevStatusRef.current;
    const newEvents: FeedEvent[] = [];
    for (const row of contacts) {
      const last = prev.get(row.rowId);
      if (last !== row.status) {
        // Only surface transitions into "interesting" states. We
        // skip pending (the initial state) to keep noise down.
        if (
          row.status === "dialing" ||
          row.status === "connected" ||
          row.status === "done" ||
          row.status === "no_answer" ||
          row.status === "failed"
        ) {
          // The very first observation of an existing row should
          // NOT generate an event — that's just initial sync, not a
          // real transition. We detect this by checking whether the
          // row was previously in our map at all.
          if (last !== undefined) {
            newEvents.push({
              ts: Date.now(),
              rowId: row.rowId,
              type: row.status,
              phone: row.phone,
              customerName: row.customerName,
              agentUsername: row.agentUsername ? resolveAgentLabel(row.agentUsername) : undefined,
            });
          }
        }
        prev.set(row.rowId, row.status);
      }
    }
    if (newEvents.length > 0) {
      setEvents((curr) => {
        const next = [...newEvents, ...curr];
        // Keep last 50 events
        return next.slice(0, 50);
      });
    }

    // ── Paridad: re-atribución tardía ────────────────────────────────────
    // process-contact-event re-escribe agentUsername con el agente REAL en
    // CONNECTED_TO_AGENT — a veces un poll DESPUÉS de que ya imprimimos el
    // evento "Conectado" con el dueño del bucket. Sin esto, el feed queda
    // diciendo un agente y el Monitoreo otro (feed congelado vs fila viva).
    // Re-etiquetamos el evento cuyo tipo coincide con el estado ACTUAL de la
    // fila cuando el username cambió.
    const byRowId = new Map(contacts.map((r) => [r.rowId, r]));
    setEvents((curr) => {
      let changed = false;
      const next = curr.map((ev) => {
        const row = byRowId.get(ev.rowId);
        if (!row || ev.type !== row.status || !row.agentUsername) return ev;
        const label = resolveAgentLabel(row.agentUsername);
        if (!label || label === "—" || ev.agentUsername === label) return ev;
        changed = true;
        return { ...ev, agentUsername: label };
      });
      return changed ? next : curr;
    });
  }, [contacts, resolveAgentLabel]);

  // Per-agent counts. We aggregate over the full contacts list (not
  // just feed events) so refreshing the page doesn't lose context.
  const agentStats = useMemo(() => {
    type Stats = {
      username: string;
      handled: number;
      connected: number;
      done: number;
      noAnswer: number;
      failed: number;
    };
    const map = new Map<string, Stats>();
    for (const row of contacts) {
      const username = row.agentUsername ? resolveAgentLabel(row.agentUsername) : "";
      if (!username || username === "—") continue;
      let entry = map.get(username);
      if (!entry) {
        entry = {
          username,
          handled: 0,
          connected: 0,
          done: 0,
          noAnswer: 0,
          failed: 0,
        };
        map.set(username, entry);
      }
      entry.handled += 1;
      if (row.status === "connected") entry.connected += 1;
      if (row.status === "done") entry.done += 1;
      if (row.status === "no_answer") entry.noAnswer += 1;
      if (row.status === "failed") entry.failed += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.done - a.done);
  }, [contacts, resolveAgentLabel]);

  // Force a re-render every 10s so relative timestamps stay fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isWhatsApp ? "1fr" : "1fr 1fr",
        gap: 14,
        // align-items:start → cada card toma su altura natural (antes se estiraban
        // a la más alta → la de Actividad vacía quedaba como una caja enorme).
        alignItems: "start",
      }}
    >
      {/* ── Live feed ──────────────────────────────────────────── */}
      <Card>
        <div className="card__head">
          <div className="card__title">
            <Icon.Activity size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Actividad en vivo
          </div>
          <span className="card__sub">
            {liveContacts.length > 0
              ? `${liveContacts.length} ${isWhatsApp ? "enviando" : "en vivo"} · `
              : ""}
            {events.length} eventos
          </span>
        </div>
        <CardBody flush>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {events.length === 0 && liveContacts.length === 0 ? (
              <div
                style={{
                  padding: "22px 24px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "center",
                  color: "var(--text-3)",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "var(--bg-3)",
                    color: "var(--text-3)",
                  }}
                >
                  <Icon.Activity size={16} />
                </span>
                <div style={{ fontSize: 12, maxWidth: 260, lineHeight: 1.4 }}>
                  Aún no hay actividad. {isWhatsApp ? "Los envíos" : "Las llamadas"} y resultados
                  aparecerán aquí en tiempo real.
                </div>
              </div>
            ) : (
              <>
                {/* Currently-live (active) rows pinned to the top */}
                {liveContacts.length > 0 && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "var(--accent-green-soft)",
                      borderBottom: "1px solid var(--border-1)",
                    }}
                  >
                    <div
                      className="muted mono"
                      style={{
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        marginBottom: 6,
                      }}
                    >
                      {isWhatsApp ? "Enviando ahora" : "En vivo ahora"}
                    </div>
                    <div className="col" style={{ gap: 4 }}>
                      {liveContacts.map((lc) => (
                        <div
                          key={`live-${lc.rowId}`}
                          className="row"
                          style={{
                            gap: 8,
                            fontSize: 11.5,
                          }}
                        >
                          <span
                            className="pulse"
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: "var(--accent-green)",
                              color: "var(--accent-green)",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontWeight: 500, color: "var(--text-1)" }}>
                            {lc.customerName || lc.phone}
                          </span>
                          <span className="mono muted" style={{ fontSize: 10.5 }}>
                            {lc.phone}
                          </span>
                          {lc.agentUsername && (
                            <span
                              className="chip"
                              style={{
                                fontSize: 9.5,
                                marginLeft: "auto",
                              }}
                            >
                              <Icon.User size={9} />{" "}
                              {/* Resolve Connect UUIDs → username when
                                  the agent is reachable via the campaign-
                                  agents list. Falls back to whatever the
                                  feed sent (could already be a username
                                  for legacy rows). */}
                              {resolveAgentLabel(lc.agentUsername)}
                            </span>
                          )}
                          {onHangup && lc.connectContactId && (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              style={{
                                height: 22,
                                padding: "0 8px",
                                fontSize: 10,
                                marginLeft: lc.agentUsername ? 0 : "auto",
                                flexShrink: 0,
                              }}
                              title="Colgar esta llamada (admin)"
                              onClick={() => onHangup(lc)}
                            >
                              <Icon.Hangup size={10} /> Colgar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Historical feed */}
                {events.map((ev, i) => {
                  const meta = metaFor(ev.type);
                  const Icn = meta.Icn;
                  return (
                    <div
                      key={`${ev.rowId}-${ev.ts}-${i}`}
                      className="row"
                      style={{
                        padding: "8px 12px",
                        gap: 10,
                        borderBottom: "1px solid var(--border-1)",
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: `${meta.color}22`,
                          color: meta.color,
                          flexShrink: 0,
                        }}
                      >
                        <Icn size={11} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontWeight: 500,
                              color: "var(--text-1)",
                            }}
                          >
                            {ev.customerName || ev.phone}
                          </span>
                          <span style={{ color: meta.color, fontSize: 11 }}>{meta.label}</span>
                          {ev.agentUsername && (
                            <span className="muted mono" style={{ fontSize: 10.5 }}>
                              · {ev.agentUsername}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="muted mono" style={{ fontSize: 10.5, flexShrink: 0 }}>
                        {relativeTime(ev.ts)}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Agent leaderboard (solo voz: WhatsApp no usa agentes) ── */}
      {!isWhatsApp && (
        <Card>
          <div className="card__head">
            <div className="card__title">
              <Icon.Users size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Agentes en esta campaña
            </div>
            <span className="card__sub">{agentStats.length} con actividad</span>
          </div>
          <CardBody flush>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {agentStats.length === 0 ? (
                <div
                  style={{
                    padding: "22px 24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    textAlign: "center",
                    color: "var(--text-3)",
                  }}
                >
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      background: "var(--bg-3)",
                      color: "var(--text-3)",
                    }}
                  >
                    <Icon.Users size={16} />
                  </span>
                  <div style={{ fontSize: 12, maxWidth: 260, lineHeight: 1.4 }}>
                    Cuando los agentes empiecen a tomar llamadas verás aquí su rendimiento
                    individual.
                  </div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      background: "var(--bg-2)",
                    }}
                  >
                    <tr>
                      {/* Inconsistencia: mezclaba español ("Agente", "Atend.")
                        con inglés ("Done", "NoAns", "Failed"). Unificamos
                        en español corto para alinear con el resto. */}
                      {["Agente", "Atend.", "Cerrados", "Sin resp.", "Fallidos"].map((h, i) => (
                        <th
                          key={i}
                          style={{
                            padding: "8px 10px",
                            textAlign: i === 0 ? "left" : "right",
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--text-3)",
                            borderBottom: "1px solid var(--border-1)",
                            fontWeight: 500,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agentStats.map((s, idx) => {
                      const rate = s.handled ? Math.round((s.done / s.handled) * 100) : 0;
                      return (
                        <tr
                          key={s.username}
                          style={{
                            borderTop: idx === 0 ? undefined : "1px solid var(--border-1)",
                          }}
                        >
                          <td style={{ padding: "8px 10px" }}>
                            <div className="row" style={{ gap: 8 }}>
                              <div
                                style={{
                                  display: "grid",
                                  placeItems: "center",
                                  width: 22,
                                  height: 22,
                                  borderRadius: 999,
                                  background: "var(--bg-3)",
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "var(--text-2)",
                                }}
                              >
                                {idx + 1}
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: "var(--text-1)",
                                  }}
                                >
                                  {s.username}
                                </div>
                                <div
                                  className="muted mono"
                                  style={{ fontSize: 10 }}
                                  title="Done / Atendidas — Bug #31: 'conversión' implicaba ventas, ahora es la tasa real de cierres exitosos."
                                >
                                  {rate}% éxito
                                </div>
                              </div>
                            </div>
                          </td>
                          <td
                            className="mono"
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text-1)",
                            }}
                          >
                            {s.handled}
                          </td>
                          <td
                            className="mono"
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontSize: 12.5,
                              color: "var(--accent-green)",
                            }}
                          >
                            {s.done}
                          </td>
                          <td
                            className="mono"
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontSize: 12.5,
                              color: "var(--accent-amber)",
                            }}
                          >
                            {s.noAnswer}
                          </td>
                          <td
                            className="mono"
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontSize: 12.5,
                              color: "var(--accent-red)",
                            }}
                          >
                            {s.failed}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
