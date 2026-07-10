import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { useQueues, type QueueSummary } from "@/hooks/useQueues";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { initials } from "@/lib/initials";
import * as Icon from "@/components/vox/primitives";

/**
 * QueuesPanel — "Configuración → Colas". Gestor de colas del Amazon Connect del
 * tenant, a PANTALLA COMPLETA (master-detail, sin modales apretados):
 *   - Lista de colas (click → detalle).
 *   - Detalle a ancho completo: estado (toggle), máx contactos, horario, y los
 *     AGENTES que la atienden (agregar/quitar vía perfil de enrutamiento).
 *   - Crear cola (vista propia).
 * Una campaña puede rutear a varias colas, así distribuye a los agentes.
 */

interface Hours {
  id: string;
  name: string;
}
interface Agent {
  userId: string;
  username: string;
  name: string;
  routingProfileId: string;
}
interface QueueDetail {
  id: string;
  name: string;
  description: string;
  status: string;
  maxContacts: number | null;
  hoursOfOperationId: string;
  outboundCallerName: string;
}

/* ── helpers ───────────────────────────────────────────────────────────── */
const inputStyle: CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  fontSize: 13.5,
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  background: "var(--bg-2)",
  color: "var(--text-1)",
};
const labelSpan: CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 700,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queuesPost(ep: string, body: any) {
  const r = await authedFetch(ep, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function Switch({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: "none",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        background: on ? "var(--accent-green)" : "var(--border-2)",
        position: "relative",
        transition: "background .2s",
        opacity: disabled ? 0.6 : 1,
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border-1)",
          fontWeight: 700,
          fontSize: 13,
          background: "var(--bg-2)",
        }}
      >
        {title}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

function BackLink({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="row"
      style={{
        gap: 6,
        alignItems: "center",
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "var(--text-3)",
        fontSize: 13,
        fontWeight: 600,
        padding: 0,
        marginBottom: 16,
      }}
    >
      <Icon.ChevRight size={14} style={{ transform: "rotate(180deg)" }} /> {label}
    </button>
  );
}

/* ── Panel principal (router de vistas) ────────────────────────────────── */
export function QueuesPanel() {
  const { queues, loading, error, refetch } = useQueues();
  const ep = getApiEndpoints()?.listQueues || "";
  const [hours, setHours] = useState<Hours[]>([]);
  const [detail, setDetail] = useState<QueueSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    if (!ep) return;
    queuesPost(ep, { action: "hoursOfOperations" })
      .then((j) => setHours(j.hoursOfOperations || []))
      .catch(() => {});
  }, [ep]);

  // Toggle de estado DESDE la lista (sin entrar al detalle) — lo intuitivo.
  const toggleStatus = async (q: QueueSummary) => {
    if (toggling) return;
    const next = q.status === "ENABLED" ? "DISABLED" : "ENABLED";
    setToggling(q.id);
    try {
      await queuesPost(ep, { action: "update", queueId: q.id, status: next });
      toast.success(next === "ENABLED" ? "Cola habilitada" : "Cola deshabilitada");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el estado");
    } finally {
      setToggling(null);
    }
  };

  if (detail) {
    return (
      <QueueDetailView
        queue={detail}
        ep={ep}
        hours={hours}
        onBack={() => setDetail(null)}
        onChanged={refetch}
      />
    );
  }
  if (creating) {
    return (
      <QueueCreateView
        ep={ep}
        hours={hours}
        onBack={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          refetch();
        }}
      />
    );
  }

  const filtered = queues.filter(
    (q) => !query.trim() || q.name.toLowerCase().includes(query.toLowerCase()),
  );
  const enabledCount = queues.filter((q) => q.status === "ENABLED").length;
  const disabledCount = queues.filter((q) => q.status === "DISABLED").length;

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Colas</div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 600, lineHeight: 1.5 }}
          >
            Las colas de tu contact center: habilítalas, configura horario y máximo, y asigna los
            agentes que las atienden. Una campaña puede rutear a varias para distribuir el trabajo.
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setCreating(true)} disabled={!ep}>
          <Icon.Plus size={14} /> Crear cola
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
        <Icon.Kpi label="Colas" value={queues.length} color="var(--accent-cyan)" />
        <Icon.Kpi
          label="Habilitadas"
          value={<span style={{ color: "var(--accent-green)" }}>{enabledCount}</span>}
          color="var(--accent-green)"
        />
        <Icon.Kpi
          label="Deshabilitadas"
          value={
            <span style={{ color: disabledCount ? "var(--accent-red)" : "var(--text-3)" }}>
              {disabledCount}
            </span>
          }
          color="var(--accent-red)"
        />
      </div>

      {/* Buscar (solo si vale la pena) */}
      {queues.length > 4 && (
        <div
          className="row"
          style={{
            gap: 7,
            alignItems: "center",
            padding: "8px 12px",
            borderRadius: 9,
            border: "1px solid var(--border-1)",
            background: "var(--bg-1)",
            maxWidth: 320,
          }}
        >
          <Icon.Search size={14} style={{ color: "var(--text-3)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cola…"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 13,
              color: "var(--text-1)",
            }}
          />
        </div>
      )}

      {loading && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Cargando colas…
        </div>
      )}
      {error && (
        <div
          style={{
            fontSize: 12.5,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
          }}
        >
          No se pudieron leer las colas: {error}
        </div>
      )}
      {!loading && !error && queues.length === 0 && (
        <Icon.Card>
          <Icon.CardBody>
            <div style={{ textAlign: "center", padding: "34px 24px" }}>
              <div
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 50,
                  height: 50,
                  borderRadius: 15,
                  background: "var(--accent-cyan-soft)",
                  color: "var(--accent-cyan)",
                  marginBottom: 12,
                }}
              >
                <Icon.Queue size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>No encontramos colas</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4, marginBottom: 16 }}>
                Conecta Amazon Connect en Integraciones, o crea tu primera cola.
              </div>
              <button
                className="btn btn--primary"
                onClick={() => setCreating(true)}
                disabled={!ep}
                style={{ margin: "0 auto" }}
              >
                <Icon.Plus size={13} /> Crear cola
              </button>
            </div>
          </Icon.CardBody>
        </Icon.Card>
      )}

      {filtered.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
          {filtered.map((q) => {
            const on = q.status === "ENABLED";
            const known = q.status === "ENABLED" || q.status === "DISABLED";
            return (
              <div
                key={q.id}
                onClick={() => setDetail(q)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 16px 14px 18px",
                  borderRadius: 12,
                  background: "var(--bg-1)",
                  border: "1px solid var(--border-1)",
                  cursor: "pointer",
                  overflow: "hidden",
                  boxShadow: "0 1px 2px rgba(16,21,37,.04)",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: on ? "var(--accent-green)" : "var(--border-1)",
                  }}
                />
                <span
                  style={{
                    flex: "0 0 auto",
                    display: "grid",
                    placeItems: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "var(--accent-cyan-soft)",
                    color: "var(--accent-cyan)",
                  }}
                >
                  <Icon.Queue size={18} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 700,
                      fontSize: 13.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {q.name}
                  </span>
                  <span className="row" style={{ gap: 7, alignItems: "center", marginTop: 3 }}>
                    {known && (
                      <span
                        className={`chip ${on ? "chip--green" : ""}`}
                        style={on ? undefined : { color: "var(--text-3)" }}
                      >
                        <span
                          className="dot"
                          style={on ? undefined : { background: "var(--text-3)" }}
                        />{" "}
                        {on ? "Habilitada" : "Deshabilitada"}
                      </span>
                    )}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {q.type === "STANDARD" ? "Estándar" : q.type}
                    </span>
                  </span>
                </span>
                {known && (
                  <span
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: "0 0 auto" }}
                    title={on ? "Deshabilitar cola" : "Habilitar cola"}
                  >
                    <Switch on={on} onClick={() => toggleStatus(q)} disabled={toggling === q.id} />
                  </span>
                )}
                <Icon.ChevRight size={16} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
              </div>
            );
          })}
        </div>
      )}
      {!loading && queues.length > 0 && filtered.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Ninguna cola coincide con "{query}".
        </div>
      )}
    </div>
  );
}

/* ── Vista de detalle (ancho completo) ─────────────────────────────────── */
function QueueDetailView({
  queue,
  ep,
  hours,
  onBack,
  onChanged,
}: {
  queue: QueueSummary;
  ep: string;
  hours: Hours[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<QueueDetail | null>(null);
  const [serving, setServing] = useState<Agent[]>([]);
  const [available, setAvailable] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [maxContacts, setMaxContacts] = useState("");
  const [hoursId, setHoursId] = useState("");
  const [addUserId, setAddUserId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch(`${ep}?detail=${encodeURIComponent(queue.id)}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setD(j.queue);
      setServing(j.agentsServing || []);
      setAvailable(j.agentsAvailable || []);
      setMaxContacts(j.queue?.maxContacts != null ? String(j.queue.maxContacts) : "");
      setHoursId(j.queue?.hoursOfOperationId || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el detalle");
    } finally {
      setLoading(false);
    }
  }, [ep, queue.id]);
  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async () => {
    if (!d || saving) return;
    const next = d.status === "ENABLED" ? "DISABLED" : "ENABLED";
    setSaving(true);
    try {
      await queuesPost(ep, { action: "update", queueId: queue.id, status: next });
      setD({ ...d, status: next });
      toast.success(next === "ENABLED" ? "Cola habilitada" : "Cola deshabilitada");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = { action: "update", queueId: queue.id };
      if (maxContacts.trim()) body.maxContacts = Number(maxContacts) || 0;
      if (hoursId && hoursId !== d?.hoursOfOperationId) body.hoursOfOperationId = hoursId;
      if (!("maxContacts" in body) && !("hoursOfOperationId" in body)) {
        toast.message("No hay cambios para guardar.");
        setSaving(false);
        return;
      }
      await queuesPost(ep, body);
      toast.success("Cola actualizada");
      onChanged();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setSaving(false);
    }
  };

  const addAgent = async () => {
    if (!addUserId) return;
    setSaving(true);
    try {
      await queuesPost(ep, { action: "addAgent", userId: addUserId, queueId: queue.id });
      toast.success("Agente agregado a la cola");
      setAddUserId("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agregar el agente");
    } finally {
      setSaving(false);
    }
  };

  const removeAgent = async (userId: string) => {
    setSaving(true);
    try {
      await queuesPost(ep, { action: "removeAgent", userId, queueId: queue.id });
      toast.success("Agente quitado de la cola");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar el agente");
    } finally {
      setSaving(false);
    }
  };

  const enabled = d?.status === "ENABLED";

  return (
    <div style={{ maxWidth: 880 }}>
      <BackLink onBack={onBack} label="Colas" />

      {/* Hero */}
      <div className="row" style={{ gap: 14, alignItems: "center", marginBottom: 20 }}>
        <span
          style={{
            flex: "0 0 auto",
            display: "grid",
            placeItems: "center",
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "var(--accent-cyan-soft)",
            color: "var(--accent-cyan)",
          }}
        >
          <Icon.Queue size={24} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 22 }}>{queue.name}</div>
          {d?.description && (
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {d.description}
            </div>
          )}
        </div>
        {d && (
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: enabled ? "var(--accent-green)" : "var(--text-3)",
              }}
            >
              {enabled ? "Habilitada" : "Deshabilitada"}
            </span>
            <Switch on={!!enabled} onClick={toggleStatus} disabled={saving} />
          </div>
        )}
      </div>

      {loading || !d ? (
        <div className="muted" style={{ fontSize: 13, padding: "24px 0" }}>
          Cargando detalle + agentes…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section title="Configuración">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <label style={{ display: "block" }}>
                <span style={labelSpan}>Máx. contactos en cola</span>
                <input
                  type="number"
                  min={0}
                  value={maxContacts}
                  onChange={(e) => setMaxContacts(e.target.value)}
                  placeholder="Sin límite"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "block" }}>
                <span style={labelSpan}>Horario de atención</span>
                <select
                  value={hoursId}
                  onChange={(e) => setHoursId(e.target.value)}
                  style={inputStyle}
                >
                  {hours.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn btn--primary" onClick={saveEdits} disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </Section>

          <Section title={`Agentes que la atienden · ${serving.length}`}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.5 }}>
              En Amazon Connect los agentes atienden colas a través de su perfil de enrutamiento —
              agregar o quitar afecta ese perfil.
            </div>
            {serving.length === 0 ? (
              <div className="muted" style={{ fontSize: 13, padding: "6px 0 14px" }}>
                Ningún agente atiende esta cola todavía.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {serving.map((a) => (
                  <div
                    key={a.userId}
                    className="row"
                    style={{
                      gap: 10,
                      alignItems: "center",
                      padding: "9px 12px",
                      borderRadius: 10,
                      background: "var(--bg-2)",
                      border: "1px solid var(--border-1)",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        display: "grid",
                        placeItems: "center",
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: "var(--accent-violet-soft)",
                        color: "var(--accent-violet)",
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      {initials(a.name)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.name}
                    </span>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => removeAgent(a.userId)}
                      disabled={saving}
                      title="Quitar del perfil de enrutamiento"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {available.length > 0 && (
              <div
                className="row"
                style={{
                  gap: 10,
                  alignItems: "center",
                  paddingTop: 12,
                  borderTop: "1px solid var(--border-1)",
                }}
              >
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  style={{ ...inputStyle, marginTop: 0, flex: 1, maxWidth: 320 }}
                >
                  <option value="">Agregar un agente…</option>
                  {available.map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={addAgent}
                  disabled={saving || !addUserId}
                >
                  <Icon.Plus size={13} /> Agregar
                </button>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/* ── Vista de creación (ancho completo) ────────────────────────────────── */
function QueueCreateView({
  ep,
  hours,
  onBack,
  onCreated,
}: {
  ep: string;
  hours: Hours[];
  onBack: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [hoursId, setHoursId] = useState(hours[0]?.id || "");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hoursId && hours[0]?.id) setHoursId(hours[0].id);
  }, [hours, hoursId]);

  const create = async () => {
    if (!name.trim() || !hoursId) {
      toast.error("Nombre y horario de atención son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      await queuesPost(ep, {
        action: "create",
        name: name.trim(),
        hoursOfOperationId: hoursId,
        description: description.trim() || undefined,
      });
      toast.success(`Cola "${name.trim()}" creada`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la cola");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <BackLink onBack={onBack} label="Colas" />
      <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 18 }}>Crear cola</div>

      <Section title="Nueva cola">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label style={{ display: "block" }}>
            <span style={labelSpan}>Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. UDEP-Maestrías"
              style={inputStyle}
              autoFocus
            />
          </label>
          <label style={{ display: "block" }}>
            <span style={labelSpan}>Horario de atención</span>
            <select value={hoursId} onChange={(e) => setHoursId(e.target.value)} style={inputStyle}>
              {hours.length === 0 && <option value="">(sin horarios)</option>}
              {hours.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={labelSpan}>Descripción (opcional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Para qué es esta cola"
              style={inputStyle}
            />
          </label>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onBack} disabled={saving}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={create}
            disabled={saving || !name.trim() || !hoursId}
          >
            {saving ? "Creando…" : "Crear cola"}
          </button>
        </div>
      </Section>
    </div>
  );
}
