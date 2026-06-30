import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueues } from "@/hooks/useQueues";
import { useContactFlows } from "@/hooks/useContactFlows";
import { getApiEndpoints } from "@/lib/api";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import * as Icon from "@/components/vox/primitives";

interface CreateTaskFormProps {
  onCreated?: () => void;
}

/**
 * Inline form for creating an outbound Amazon Connect task. Posts to
 * the `startOutboundContact` Lambda with `{ type: "task", ... }`.
 *
 * Task flows are filtered from the full contact-flows list to those
 * whose name starts with "Task" or "TaskFlow" — the convention used
 * by the Novasys instance and matches what `aws connect list-contact-flows`
 * returns for type CONTACT_FLOW (Connect doesn't expose a separate
 * "task flow" type via list-contact-flows; the agent's task contact
 * flows are regular contact flows tagged by naming convention).
 */
export function CreateTaskForm({ onCreated }: CreateTaskFormProps) {
  const { user } = useConnectAuth();
  const { queues, loading: queuesLoading } = useQueues();
  const { flows, loading: flowsLoading } = useContactFlows();

  const taskFlows = useMemo(
    () =>
      flows.filter(
        (f) =>
          f.name.toLowerCase().startsWith("task") ||
          f.name.toLowerCase().includes("taskflow")
      ),
    [flows]
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [queueId, setQueueId] = useState("");
  const [flowId, setFlowId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-select first task flow + queue once data loads
  useMemo(() => {
    if (!flowId && taskFlows.length > 0) setFlowId(taskFlows[0].id);
  }, [taskFlows, flowId]);
  useMemo(() => {
    if (!queueId && queues.length > 0) setQueueId(queues[0].id);
  }, [queues, queueId]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Pon un nombre a la tarea");
      return;
    }
    if (!flowId) {
      toast.error("No hay task flow configurado");
      return;
    }
    if (!queueId) {
      toast.error("Selecciona una cola");
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.startOutboundContact) {
      toast.error("Endpoint startOutboundContact no configurado");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(endpoints.startOutboundContact, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "task",
          name: name.trim(),
          description: description.trim() || undefined,
          queueId,
          contactFlowId: flowId,
          actor: user?.username || "unknown",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);
      toast.success(`Tarea creada · ${data.contactId?.slice(0, 8)}…`);
      setName("");
      setDescription("");
      onCreated?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se pudo crear la tarea"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Nombre de la tarea
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Seguimiento UDEP — Juan Pérez"
          className="vox-field"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Descripción (opcional)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notas o instrucciones…"
          rows={3}
          className="vox-field"
          style={{ minHeight: 60 }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Cola destino
        </span>
        <select
          value={queueId}
          onChange={(e) => setQueueId(e.target.value)}
          disabled={queuesLoading}
          className="vox-field"
        >
          {queues.length === 0 && (
            <option value="">{queuesLoading ? "Cargando…" : "Sin colas"}</option>
          )}
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>
          Task flow
        </span>
        <select
          value={flowId}
          onChange={(e) => setFlowId(e.target.value)}
          disabled={flowsLoading}
          className="vox-field"
        >
          {taskFlows.length === 0 && (
            <option value="">
              {flowsLoading ? "Cargando…" : "Sin task flows · crea uno en Connect"}
            </option>
          )}
          {taskFlows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn btn--success"
        onClick={submit}
        disabled={submitting || !name.trim() || !queueId || !flowId}
        style={{ marginTop: 4, height: 34, justifyContent: "center" }}
      >
        <Icon.Note size={13} />
        {submitting ? "Creando…" : "Crear tarea"}
      </button>
    </div>
  );
}
