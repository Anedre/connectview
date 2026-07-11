import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import { useQueues } from "@/hooks/useQueues";
import { Btn, Icon } from "@/components/aria";
import { Modal } from "@/components/ui/modal";

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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return queues;
    return queues.filter(
      (qu) =>
        qu.name.toLowerCase().includes(q) ||
        qu.id.toLowerCase().includes(q) ||
        qu.type.toLowerCase().includes(q),
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
      toast.error(err instanceof Error ? err.message : "No se pudo transferir");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
      title={
        <span className="row gap10" style={{ alignItems: "center" }}>
          <span
            className="tl__ico"
            style={{ ["--_c" as string]: "var(--accent)", width: 30, height: 30, flex: "0 0 auto" }}
          >
            <Icon name="route" size={15} />
          </span>
          Transferir {channelLabel}
        </span>
      }
      description={
        warmMode
          ? "Warm — consultas primero y luego cuelgas"
          : "Blind — la cola recibe el contacto al instante"
      }
      className="max-w-md"
      footer={
        <Btn variant="ghost" onClick={onClose} disabled={submitting}>
          Cancelar
        </Btn>
      }
    >
      <div className="col gap10" style={{ marginTop: 16 }}>
        {/* Mode toggle: blind (default) vs warm transfer */}
        <label
          className="row gap10"
          style={{
            padding: "8px 10px",
            borderRadius: "var(--r-md)",
            background: warmMode ? "var(--iris-soft)" : "var(--bg-2)",
            border: "1px solid var(--border-1)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={warmMode}
            onChange={(e) => setWarmMode(e.target.checked)}
            style={{ accentColor: "var(--iris)" }}
          />
          <span className="grow">
            <b
              style={{
                fontSize: 12.5,
                color: warmMode ? "var(--iris-2)" : "var(--text-1)",
              }}
            >
              Consultar primero (warm transfer)
            </b>
            <div className="dim" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
              Conversas con el agente destino antes de soltar la llamada.
            </div>
          </span>
        </label>

        <div
          className="row gap8"
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--r-md)",
            padding: "0 10px",
            height: 42,
          }}
        >
          <Icon name="search" size={14} style={{ color: "var(--text-3)" }} />
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
            <button type="button" className="ctab__x" onClick={() => setFilter("")} title="Limpiar">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        <div style={{ maxHeight: "44vh", overflowY: "auto", margin: "0 -4px" }}>
          {loading && (
            <div className="dim" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
              Cargando colas…
            </div>
          )}
          {error && !loading && (
            <div
              style={{
                margin: 10,
                padding: 12,
                background: "var(--red-soft)",
                color: "var(--red-2)",
                borderRadius: "var(--r-md)",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="dim" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
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
                className="row gap10"
                style={{
                  width: "calc(100% - 12px)",
                  margin: "4px 6px",
                  padding: "10px 12px",
                  borderRadius: "var(--r-sm)",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  className="tl__ico"
                  style={{
                    ["--_c" as string]: "var(--cyan)",
                    width: 30,
                    height: 30,
                    flex: "0 0 auto",
                  }}
                >
                  <Icon name="users" size={14} />
                </div>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="trunc" style={{ display: "block", fontSize: 13 }}>
                    {q.name}
                  </b>
                  <span className="dim" style={{ display: "block", fontSize: 11, marginTop: 1 }}>
                    {q.type.toLowerCase()}
                  </span>
                </span>
                {submitting ? null : (
                  <Icon name="route" size={14} style={{ color: "var(--text-3)" }} />
                )}
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}
