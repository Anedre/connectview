import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

interface ScheduleCallbackModalProps {
  open: boolean;
  onClose: () => void;
  /** Phone we'll call back. Usually the active contact's customerPhone. */
  phone: string | null;
  customerName?: string | null;
  /** Connect user-id of the agent who promises the callback. */
  assignedAgentUserId: string;
  onScheduled?: () => void;
}

const presetMinutes = [15, 30, 60, 120, 240, 1440];

function presetLabel(min: number) {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${min / 60} h`;
  return `${min / 1440} día${min === 1440 ? "" : "s"}`;
}

/**
 * "📅 Agendar callback" modal — the agent picks when to call the
 * customer back and writes optional notes. Submits to the
 * schedule-callback Lambda which inserts a row in the callbacks
 * table; the EventBridge-scheduled dispatcher Lambda picks it up at
 * the agreed time and places the outbound call.
 */
export function ScheduleCallbackModal({
  open,
  onClose,
  phone,
  customerName,
  assignedAgentUserId,
  onScheduled,
}: ScheduleCallbackModalProps) {
  // Default to "+1 hour from now" so the picker is rarely empty.
  const defaultIso = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    // Trim seconds + tz — datetime-local input wants "YYYY-MM-DDTHH:mm"
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [scheduledLocal, setScheduledLocal] = useState(defaultIso());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setScheduledLocal(defaultIso());
      setNotes("");
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  const setFromPreset = (minutes: number) => {
    const d = new Date(Date.now() + minutes * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    setScheduledLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  const submit = async () => {
    if (!phone) {
      toast.error("No hay teléfono para programar el callback");
      return;
    }
    if (!assignedAgentUserId) {
      toast.error("No se detectó el ID del agente");
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.scheduleCallback) {
      toast.error("Endpoint scheduleCallback no configurado");
      return;
    }
    // Convert the local-time picker value to a full ISO with timezone.
    // The Date() ctor reads the picker string as local time, then
    // toISOString gives UTC ISO. That's what the Lambda expects.
    const ts = new Date(scheduledLocal).getTime();
    if (Number.isNaN(ts)) {
      toast.error("Fecha/hora inválida");
      return;
    }
    if (ts < Date.now() - 30_000) {
      toast.error("La hora del callback debe estar en el futuro");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch(endpoints.scheduleCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          customerName: customerName || "",
          scheduledAt: new Date(ts).toISOString(),
          assignedAgentUserId,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      toast.success(
        `📅 Callback agendado · ${new Date(ts).toLocaleString("es-PE", {
          dateStyle: "short",
          timeStyle: "short",
        })}`
      );
      onScheduled?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agendar");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agendar callback"
      onClick={() => !submitting && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 10, 16, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 250,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          padding: 16,
          fontFamily: "var(--font-ui)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 18 }}>📅</span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Agendar callback
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        {phone && (
          <div
            className="mono"
            style={{
              fontSize: 12,
              padding: "8px 10px",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            <span style={{ color: "var(--text-3)" }}>Para</span>{" "}
            <span style={{ color: "var(--text-1)", fontWeight: 500 }}>
              {customerName || "Cliente"}
            </span>{" "}
            · {phone}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 10.5 }}>
            Cuándo llamarlo
          </span>
          {/* Preset chips for quick selection */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {presetMinutes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFromPreset(m)}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--border-1)",
                  background: "var(--bg-2)",
                  color: "var(--text-1)",
                  cursor: "pointer",
                }}
              >
                +{presetLabel(m)}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={scheduledLocal}
            onChange={(e) => setScheduledLocal(e.target.value)}
            style={{
              width: "100%",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 6,
              padding: "8px 10px",
              color: "var(--text-1)",
              outline: "none",
              fontSize: 12.5,
              fontFamily: "var(--font-ui)",
              colorScheme: "dark",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 10.5 }}>
            Notas (opcional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej. Quiere hablar después de su clase 📚"
            rows={3}
            style={{
              width: "100%",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 6,
              padding: "8px 10px",
              color: "var(--text-1)",
              outline: "none",
              fontSize: 12.5,
              resize: "vertical",
              minHeight: 60,
              fontFamily: "var(--font-ui)",
            }}
          />
        </div>

        <div
          className="muted"
          style={{ fontSize: 10.5, marginBottom: 10, lineHeight: 1.5 }}
        >
          🤝 Te lo asignamos a ti automáticamente — el sistema te llamará al
          cliente y a ti a la hora pactada.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--success"
            onClick={submit}
            disabled={submitting || !phone || !assignedAgentUserId}
          >
            {submitting ? "Agendando…" : "📅 Agendar"}
          </button>
        </div>
      </div>
    </div>
  );
}
