import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { useQueues, type QueueSummary } from "@/hooks/useQueues";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";

/**
 * QueuesPanel — "Configuración → Colas". Gestor de colas del Amazon Connect del
 * tenant: lista, detalle (estado/máx contactos/horario), edición, AGENTES que la
 * atienden (agregar/quitar vía perfil de enrutamiento) y crear cola. Todo contra
 * SU instancia vía el endpoint list-queues (rol cross-account).
 *
 * Una campaña puede usar varias colas (distribuye por atributo); por eso esto es
 * gestión de colas, no un "default" único.
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

const inputStyle: CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  background: "var(--bg-2)",
  color: "var(--text-1)",
};
const labelSpan: CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontWeight: 600,
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

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,21,37,0.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg-1)", borderRadius: 14, width: 460, maxWidth: "100%", maxHeight: "88vh", overflow: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.18)", padding: 20 }}
      >
        {children}
      </div>
    </div>
  );
}

export function QueuesPanel() {
  const { queues, loading, error, refetch } = useQueues();
  const ep = getApiEndpoints()?.listQueues || "";
  const [hours, setHours] = useState<Hours[]>([]);
  const [selected, setSelected] = useState<QueueSummary | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!ep) return;
    queuesPost(ep, { action: "hoursOfOperations" })
      .then((j) => setHours(j.hoursOfOperations || []))
      .catch(() => {});
  }, [ep]);

  return (
    <div style={{ padding: 18, borderRadius: 12, background: "var(--bg-1)", border: "1px solid var(--border-1)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Colas de Amazon Connect</div>
          {queues.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-cyan)", background: "var(--accent-cyan-soft)", borderRadius: 999, padding: "2px 10px" }}>{queues.length}</span>
          )}
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)} disabled={!ep}>
          <Icon.Plus size={13} /> Crear cola
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
        Click en una cola para ver su detalle, editarla y gestionar qué agentes la
        atienden. Una campaña puede rutear a varias colas (así distribuye a los agentes).
      </div>

      {loading && <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>Cargando colas…</div>}
      {error && (
        <div style={{ fontSize: 12.5, padding: "10px 12px", borderRadius: 8, background: "var(--accent-red-soft)", color: "var(--accent-red)" }}>
          No se pudieron leer las colas: {error}
        </div>
      )}
      {!loading && !error && queues.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          No encontramos colas. Verificá que Amazon Connect esté conectado (Integraciones) y que tenga al menos una cola.
        </div>
      )}

      {queues.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {queues.map((q) => (
            <button
              key={q.id}
              onClick={() => setSelected(q)}
              className="row"
              style={{ gap: 10, padding: "9px 12px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border-1)", alignItems: "center", cursor: "pointer", textAlign: "left", width: "100%" }}
            >
              <span style={{ flex: "0 0 auto", display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 7, background: "var(--accent-cyan-soft)", color: "var(--accent-cyan)" }}>
                <Icon.Queue size={14} />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13 }}>{q.name}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 999, padding: "2px 8px" }}>
                {q.type === "STANDARD" ? "Estándar" : q.type}
              </span>
              <Icon.ChevRight size={14} style={{ color: "var(--text-3)" }} />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <QueueDetailModal queue={selected} ep={ep} hours={hours} onClose={() => setSelected(null)} onChanged={refetch} />
      )}
      {creating && (
        <QueueCreateModal ep={ep} hours={hours} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refetch(); }} />
      )}
    </div>
  );
}

function QueueDetailModal({ queue, ep, hours, onClose, onChanged }: { queue: QueueSummary; ep: string; hours: Hours[]; onClose: () => void; onChanged: () => void }) {
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
  useEffect(() => { load(); }, [load]);

  const toggleStatus = async () => {
    if (!d) return;
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
    <Overlay onClose={onClose}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{queue.name}</div>
          {d?.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{d.description}</div>}
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onClose}><Icon.Close size={15} /></button>
      </div>

      {loading || !d ? (
        <div className="muted" style={{ fontSize: 12.5, padding: "16px 0" }}>Cargando detalle + agentes…</div>
      ) : (
        <>
          {/* Estado + edición */}
          <div className="row" style={{ gap: 10, alignItems: "center", margin: "12px 0 16px" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: enabled ? "var(--accent-green)" : "var(--text-3)", background: enabled ? "var(--accent-green-soft)" : "var(--bg-2)", borderRadius: 999, padding: "3px 10px" }}>
              {enabled ? "Habilitada" : "Deshabilitada"}
            </span>
            <button className="btn btn--sm" onClick={toggleStatus} disabled={saving}>
              {enabled ? "Deshabilitar" : "Habilitar"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label style={{ display: "block" }}>
              <span style={labelSpan}>Máx. contactos en cola</span>
              <input type="number" min={0} value={maxContacts} onChange={(e) => setMaxContacts(e.target.value)} placeholder="Sin límite" style={inputStyle} />
            </label>
            <label style={{ display: "block" }}>
              <span style={labelSpan}>Horario de atención</span>
              <select value={hoursId} onChange={(e) => setHoursId(e.target.value)} style={inputStyle}>
                {hours.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
          </div>
          <button className="btn btn--primary btn--sm" onClick={saveEdits} disabled={saving} style={{ marginBottom: 18 }}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>

          {/* Agentes */}
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Agentes que la atienden · {serving.length}</div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
            En Connect los agentes atienden colas vía su perfil de enrutamiento — agregar/quitar afecta ese perfil.
          </div>
          {serving.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: "4px 0 10px" }}>Ningún agente atiende esta cola todavía.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              {serving.map((a) => (
                <div key={a.userId} className="row" style={{ gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, background: "var(--bg-2)" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{a.name}</span>
                  <button className="btn btn--ghost btn--sm" onClick={() => removeAgent(a.userId)} disabled={saving} title="Quitar del perfil de enrutamiento">Quitar</button>
                </div>
              ))}
            </div>
          )}

          {available.length > 0 && (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} style={{ ...inputStyle, marginTop: 0, flex: 1 }}>
                <option value="">Agregar un agente…</option>
                {available.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
              </select>
              <button className="btn btn--sm" onClick={addAgent} disabled={saving || !addUserId}>Agregar</button>
            </div>
          )}
        </>
      )}
    </Overlay>
  );
}

function QueueCreateModal({ ep, hours, onClose, onCreated }: { ep: string; hours: Hours[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [hoursId, setHoursId] = useState(hours[0]?.id || "");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim() || !hoursId) {
      toast.error("Nombre y horario de atención son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      await queuesPost(ep, { action: "create", name: name.trim(), hoursOfOperationId: hoursId, description: description.trim() || undefined });
      toast.success(`Cola "${name.trim()}" creada`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la cola");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Crear cola</div>
        <button className="btn btn--ghost btn--sm" onClick={onClose}><Icon.Close size={15} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "block" }}>
          <span style={labelSpan}>Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. UDEP-Diplomados" style={inputStyle} />
        </label>
        <label style={{ display: "block" }}>
          <span style={labelSpan}>Horario de atención</span>
          <select value={hoursId} onChange={(e) => setHoursId(e.target.value)} style={inputStyle}>
            {hours.length === 0 && <option value="">(sin horarios)</option>}
            {hours.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
        <label style={{ display: "block" }}>
          <span style={labelSpan}>Descripción (opcional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué es esta cola" style={inputStyle} />
        </label>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn--primary" onClick={create} disabled={saving || !name.trim() || !hoursId}>
          {saving ? "Creando…" : "Crear cola"}
        </button>
      </div>
    </Overlay>
  );
}
