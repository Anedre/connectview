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
 * Blind transfer-to-queue modal. Lists every queue exposed by the
 * `listQueues` endpoint, lets the agent filter by name, and on click
 * triggers `transferToQueue(queueArn)` from the CCP context. We use
 * blind transfer (drop the agent leg after `addConnection` succeeds)
 * which is the simplest UX — the agent doesn't have to wait for the
 * receiving queue to pick up.
 */
export function TransferQueueModal({
  open,
  onClose,
  contactId,
  channelLabel = "contacto",
}: TransferQueueModalProps) {
  const { transferToQueue } = useCCP();
  const { queues, loading, error } = useQueues();
  const [filter, setFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Reset state on open/close + focus the filter on open
  useEffect(() => {
    if (!open) {
      setFilter("");
      setSubmitting(false);
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
      await transferToQueue(queueArn, contactId || undefined);
      toast.success(`Transferido a ${queueName}`);
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
              Selecciona la cola destino — transferencia ciega
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

        <div style={{ padding: 12, borderBottom: "1px solid var(--border-1)" }}>
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
