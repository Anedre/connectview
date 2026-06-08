import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import { useQueues } from "@/hooks/useQueues";
import * as Icon from "@/components/vox/primitives";

interface TransferQueueModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
  channelLabel?: string;
}

/**
 * Transfer-to-queue modal. Lists every queue exposed by the
 * `listQueues` endpoint, lets the agent filter by name, and on click
 * triggers a transfer in one of two modes:
 *
 * - **Blind (default):** addConnection to the queue endpoint then drop
 *   the agent leg immediately — fastest UX for "I know exactly where
 *   this goes".
 * - **Warm ("Consultar primero"):** addConnection without dropping
 *   the agent — the agent ends up briefing the receiving queue's
 *   agent in a 3-way bridge, then completes the handoff via the
 *   floating "Completar transferencia" button.
 */
export function TransferQueueModal({
  open,
  onClose,
  contactId,
  channelLabel = "contacto",
}: TransferQueueModalProps) {
  const { transferToQueue, addParticipantByQueue, dropAgentLeg } = useCCP();
  const { queues, loading, error } = useQueues();
  const [filter, setFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [warmMode, setWarmMode] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Reset state on open/close + focus the filter on open
  useEffect(() => {
    if (!open) {
      setFilter("");
      setSubmitting(false);
      setWarmMode(false);
      return;
    }
    setTimeout(() => filterInputRef.current?.focus(), 50);
  }, [open]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return queues;
    return queues.filter(
      (qu) =>
        qu.name.toLowerCase().includes(q) ||
        qu.id.toLowerCase().includes(q) ||
        qu.type.toLowerCase().includes(q)
    );
  }, [queues, filter]);

  const handleTransfer = async (queueArn: string, queueName: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (warmMode) {
        await addParticipantByQueue(queueArn, contactId || undefined);
        toast.success(`Conectando con ${queueName}…`, {
          description:
            "Tu llamada queda activa. Cuelga manualmente cuando termines la consulta para completar la transferencia.",
          duration: 7000,
          action: {
            label: "Completar ahora",
            onClick: () => dropAgentLeg(contactId || undefined),
          },
        });
      } else {
        await transferToQueue(queueArn, contactId || undefined);
        toast.success(`Transferido a ${queueName}`);
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo transferir"
      );
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Transferir a cola"
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
          width: 420,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon.Transfer size={16} style={{ color: "var(--accent-cyan)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Transferir {channelLabel}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {warmMode
                ? "Warm transfer — consultas primero y luego cuelgas"
                : "Blind transfer — la cola recibe el contacto al instante"}
            </div>
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

        <div style={{ padding: 12, borderBottom: "1px solid var(--border-1)", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Mode toggle: blind (default) vs warm transfer */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: warmMode ? "var(--accent-violet-soft)" : "var(--bg-2)",
              border: "1px solid",
              borderColor: warmMode ? "transparent" : "var(--border-1)",
              cursor: "pointer",
              transition: "background .15s, border-color .15s",
            }}
          >
            <input
              type="checkbox"
              checked={warmMode}
              onChange={(e) => setWarmMode(e.target.checked)}
              style={{ accentColor: "var(--accent-violet)" }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: warmMode ? "var(--accent-violet)" : "var(--text-1)" }}>
                Consultar primero (warm transfer)
              </span>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginTop: 2, lineHeight: 1.4 }}>
                Conversas con el agente destino antes de soltar la llamada.
              </span>
            </span>
          </label>

          <div
            style={{
              display: "flex",
              gap: 6,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 6,
              padding: "6px 8px",
              alignItems: "center",
            }}
          >
            <Icon.Search size={14} style={{ color: "var(--text-3)" }} />
            <input
              ref={filterInputRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar cola por nombre…"
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: 0,
                outline: "none",
                fontSize: 13,
                color: "var(--text-1)",
              }}
            />
            {filter && (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                onClick={() => setFilter("")}
                title="Limpiar"
              >
                <Icon.Close size={12} />
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "6px 4px",
          }}
        >
          {loading && (
            <div
              className="muted"
              style={{ padding: 24, textAlign: "center", fontSize: 12 }}
            >
              Cargando colas…
            </div>
          )}
          {error && !loading && (
            <div
              style={{
                margin: 10,
                padding: 12,
                background: "var(--accent-red-soft)",
                color: "var(--accent-red)",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div
              className="muted"
              style={{ padding: 24, textAlign: "center", fontSize: 12 }}
            >
              {filter ? "Sin coincidencias" : "No hay colas disponibles"}
            </div>
          )}
          {!loading &&
            filtered.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => handleTransfer(q.arn, q.name)}
                disabled={submitting}
                className="btn"
                style={{
                  display: "flex",
                  width: "calc(100% - 12px)",
                  margin: "3px 6px",
                  padding: "10px 12px",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  gap: 10,
                  height: "auto",
                  textAlign: "left",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "var(--accent-cyan-soft)",
                    color: "var(--accent-cyan)",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Users size={14} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {q.name}
                  </span>
                  <span
                    className="muted mono"
                    style={{
                      display: "block",
                      fontSize: 10.5,
                      marginTop: 2,
                    }}
                  >
                    {q.type.toLowerCase()}
                  </span>
                </span>
                {submitting ? null : (
                  <Icon.Transfer size={14} style={{ color: "var(--text-3)" }} />
                )}
              </button>
            ))}
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
