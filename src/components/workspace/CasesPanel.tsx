import { useState, type CSSProperties } from "react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import * as Icon from "@/components/vox/primitives";
import {
  useCases,
  caseSlaChip,
  CASE_STATUS_META,
  CASE_PRIORITY_META,
  CASE_NEXT_STATES,
  type CaseRecord,
  type CaseEvent,
  type CasePriority,
  type CaseStatus,
} from "@/hooks/useCases";

interface CasesPanelProps {
  contactId: string | null;
  customerPhone: string | null;
}

const PRIORITY_ORDER: CasePriority[] = ["urgent", "high", "normal", "low"];

/** Etiqueta legible de un evento del historial del caso. */
function eventLabel(ev: CaseEvent): string {
  switch (ev.type) {
    case "created":
      return "Caso creado";
    case "status_change": {
      const to = ev.to ? CASE_STATUS_META[ev.to as CaseStatus]?.label || ev.to : "";
      const from = ev.from ? CASE_STATUS_META[ev.from as CaseStatus]?.label || ev.from : "";
      return from ? `${from} → ${to}` : `Estado: ${to}`;
    }
    case "assign":
      return ev.to ? `Asignado a ${ev.to}` : "Asignación";
    case "note":
      return ev.note || "Nota";
    case "sla_breach":
      return "SLA vencido";
    case "csat":
      return "Encuesta de satisfacción";
    default:
      return ev.type;
  }
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("es-PE", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Estilo del chip de SLA según el nivel (ok / ámbar / rojo). */
function slaStyle(level: "ok" | "warn" | "breach"): CSSProperties {
  const c = level === "breach" ? "var(--red)" : level === "warn" ? "var(--gold)" : "var(--text-3)";
  return {
    fontSize: 10.5,
    fontWeight: 700,
    padding: "1px 7px",
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: c,
    background: `color-mix(in srgb, ${c} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${c} 30%, transparent)`,
  };
}

export function CasesPanel({ contactId, customerPhone }: CasesPanelProps) {
  const { instanceUrl } = useConnectAuth();
  const { cases, loading, error, configured, create, transition, reload } = useCases(customerPhone);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<CasePriority>("normal");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const openCasesInConnect = () => window.open(`${instanceUrl}/connect/cases/case`, "_blank");

  // Sin contacto activo: nada que mostrar.
  if (!customerPhone) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 220,
          color: "var(--text-3)",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <Icon.Ticket size={28} style={{ opacity: 0.45 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Los casos estarán disponibles cuando haya un contacto activo.
          </div>
        </div>
      </div>
    );
  }

  // Build-ahead: sin la Lambda manage-cases desplegada, caemos al deep-link de Connect.
  if (!configured) {
    return (
      <div className="col" style={{ gap: 14 }}>
        <div className="spread">
          <span className="section-title" style={{ margin: 0 }}>
            Casos del cliente
          </span>
          {contactId && (
            <span className="chip chip--green">
              <span className="dot" /> Contacto activo
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={openCasesInConnect}>
            <Icon.Send size={12} /> Abrir en Connect
          </button>
        </div>
        <div
          className="muted"
          style={{
            fontSize: 11.5,
            padding: 12,
            background: "var(--accent-violet-soft)",
            borderRadius: 8,
            color: "var(--accent-violet)",
            lineHeight: 1.5,
          }}
        >
          <strong>Casos nativos de ARIA</strong> — se activan al desplegar el módulo de casos. Por
          ahora la gestión sigue en Amazon Connect Cases.
        </div>
      </div>
    );
  }

  const submitCreate = async () => {
    const s = subject.trim();
    if (!s) {
      setFormErr("Escribe un asunto");
      return;
    }
    setBusy(true);
    setFormErr(null);
    try {
      await create({ subject: s, priority, contactId: contactId || undefined });
      setSubject("");
      setPriority("normal");
      setShowForm(false);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "No se pudo crear el caso");
    } finally {
      setBusy(false);
    }
  };

  const doTransition = async (caseId: string, status: CaseStatus) => {
    setBusy(true);
    try {
      await transition(caseId, status);
    } catch {
      /* el error se refleja al recargar; no rompemos el panel */
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...cases].sort((a, b) => {
    const open = (c: CaseRecord) => (c.status === "solved" || c.status === "closed" ? 1 : 0);
    if (open(a) !== open(b)) return open(a) - open(b); // abiertos primero
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="spread">
        <span className="section-title" style={{ margin: 0 }}>
          Casos del cliente {cases.length > 0 && <span className="muted">({cases.length})</span>}
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => reload()}
            title="Actualizar"
            disabled={busy}
          >
            <Icon.Refresh size={12} />
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => setShowForm((v) => !v)}
            disabled={busy}
          >
            <Icon.Plus size={12} /> Nuevo caso
          </button>
        </div>
      </div>

      <div
        className="row"
        style={{
          padding: "8px 12px",
          background: "var(--bg-2)",
          borderRadius: 8,
          border: "1px solid var(--border-1)",
          gap: 8,
        }}
      >
        <Icon.Phone size={13} style={{ color: "var(--text-3)" }} />
        <span className="mono" style={{ fontSize: 12 }}>
          {customerPhone}
        </span>
      </div>

      {showForm && (
        <div
          className="col"
          style={{
            gap: 8,
            padding: 12,
            background: "var(--bg-2)",
            borderRadius: 8,
            border: "1px solid var(--border-1)",
          }}
        >
          <input
            className="input"
            placeholder="Asunto del caso"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
          />
          <div className="row" style={{ gap: 8 }}>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as CasePriority)}
              style={{ flex: 1 }}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {CASE_PRIORITY_META[p].label}
                </option>
              ))}
            </select>
            <button className="btn btn--primary btn--sm" onClick={submitCreate} disabled={busy}>
              <Icon.Check size={12} /> Crear
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setShowForm(false);
                setFormErr(null);
              }}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
          {formErr && <div style={{ fontSize: 11.5, color: "var(--red)" }}>{formErr}</div>}
        </div>
      )}

      {loading && (
        <div className="muted" style={{ fontSize: 12, padding: 8 }}>
          Cargando casos…
        </div>
      )}
      {error && !loading && (
        <div style={{ fontSize: 11.5, color: "var(--red)", padding: 8 }}>{error}</div>
      )}
      {!loading && !error && sorted.length === 0 && (
        <div className="muted" style={{ fontSize: 12, padding: "14px 8px", textAlign: "center" }}>
          Sin casos para este cliente.
        </div>
      )}

      <div className="col" style={{ gap: 8 }}>
        {sorted.map((c) => {
          const sla = caseSlaChip(c);
          const st = CASE_STATUS_META[c.status];
          const pr = CASE_PRIORITY_META[c.priority];
          const expanded = expandedId === c.caseId;
          return (
            <div
              key={c.caseId}
              style={{
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                background: "var(--bg-1)",
                overflow: "hidden",
              }}
            >
              <button
                className="col"
                onClick={() => setExpandedId(expanded ? null : c.caseId)}
                style={{
                  gap: 6,
                  padding: "10px 12px",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <div className="spread" style={{ gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                    <span className="mono" style={{ color: "var(--text-3)", marginRight: 6 }}>
                      #{c.number}
                    </span>
                    {c.subject}
                  </span>
                  <Icon.ChevRight
                    size={13}
                    style={{
                      color: "var(--text-3)",
                      transform: expanded ? "rotate(90deg)" : "none",
                      transition: "transform .15s",
                      flexShrink: 0,
                    }}
                  />
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <span className={`chip ${st.chip}`}>
                    <span className="dot" /> {st.label}
                  </span>
                  <span className={`chip ${pr.chip}`}>{pr.label}</span>
                  {sla && (
                    <span style={slaStyle(sla.level)}>
                      <Icon.Clock size={10} /> {sla.label}
                    </span>
                  )}
                </div>
              </button>

              {expanded && (
                <div
                  className="col"
                  style={{
                    gap: 10,
                    padding: "0 12px 12px",
                    borderTop: "1px solid var(--border-1)",
                  }}
                >
                  {c.description && (
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 10 }}>
                      {c.description}
                    </div>
                  )}
                  {c.assigneeAgentName && (
                    <div
                      className="row"
                      style={{ gap: 6, fontSize: 11.5, color: "var(--text-3)", marginTop: 10 }}
                    >
                      <Icon.User size={12} /> {c.assigneeAgentName}
                    </div>
                  )}

                  {/* Transiciones */}
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    {(CASE_NEXT_STATES[c.status] || []).map((next) => (
                      <button
                        key={next}
                        className="btn btn--ghost btn--sm"
                        onClick={() => doTransition(c.caseId, next)}
                        disabled={busy}
                      >
                        {next === "closed"
                          ? "Cerrar"
                          : next === "solved"
                            ? "Resolver"
                            : next === "open" && (c.status === "solved" || c.status === "closed")
                              ? "Reabrir"
                              : CASE_STATUS_META[next].label}
                      </button>
                    ))}
                  </div>

                  {/* Timeline */}
                  {Array.isArray(c.history) && c.history.length > 0 && (
                    <div className="col" style={{ gap: 6, marginTop: 2 }}>
                      {[...c.history]
                        .slice(-8)
                        .reverse()
                        .map((ev, i) => (
                          <div
                            key={i}
                            className="row"
                            style={{ gap: 8, fontSize: 11, color: "var(--text-3)" }}
                          >
                            <span
                              className="dot"
                              style={{ background: "var(--text-3)", opacity: 0.5, flexShrink: 0 }}
                            />
                            <span style={{ color: "var(--text-2)" }}>{eventLabel(ev)}</span>
                            <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                              {fmtTs(ev.ts)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        className="btn btn--ghost btn--sm"
        onClick={openCasesInConnect}
        style={{ alignSelf: "flex-start" }}
      >
        <Icon.Send size={12} /> Abrir en Connect
      </button>
    </div>
  );
}
