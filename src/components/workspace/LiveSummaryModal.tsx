import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import * as Icon from "@/components/vox/primitives";

interface LiveSummaryModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
}

/**
 * On-demand call summary modal. Triggered from the "Resumen" button in
 * the transcript panel. Calls the existing `generateCallSummary` Lambda
 * with `mode: "summary"` and renders the resulting markdown-ish text.
 *
 * Stays mounted across multiple presses so the agent can refresh the
 * summary while the conversation evolves — useful during long calls
 * where the agent wants a TL;DR before transferring. El overlay,
 * focus-trap y Esc los aporta el primitivo `Modal`.
 */
export function LiveSummaryModal({ open, onClose, contactId }: LiveSummaryModalProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedFor = useRef<string | null>(null);

  // Auto-fetch when the modal opens for a new contactId
  useEffect(() => {
    if (!open || !contactId) return;
    if (lastFetchedFor.current === contactId && summary) return;
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactId]);

  const fetchSummary = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) {
      setError("El endpoint de resumen no está configurado");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "summary" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const result = data.result || data.summary || "";
      if (!result) {
        setError("Aún no hay suficiente transcripción para generar un resumen.");
        setSummary(null);
      } else {
        setSummary(result);
        lastFetchedFor.current = contactId;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el resumen");
    } finally {
      setLoading(false);
    }
  };

  const copySummary = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Resumen copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon.Sparkles size={16} style={{ color: "var(--accent-violet)" }} />
          Resumen de la conversación
        </span>
      }
      description="Generado por Amazon Bedrock con la transcripción de Contact Lens"
      className="max-w-lg"
      footer={
        <>
          {summary && !loading && (
            <button type="button" className="btn btn--ghost" onClick={copySummary}>
              <Icon.Copy size={13} /> Copiar
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={fetchSummary}
            disabled={loading || !contactId}
          >
            <Icon.Refresh size={13} /> {loading ? "Generando…" : summary ? "Regenerar" : "Generar"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      <div style={{ maxHeight: "60vh", overflowY: "auto", marginTop: 14 }}>
        {loading && (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 160,
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            <div>
              <Icon.Sparkles size={26} style={{ opacity: 0.45 }} />
              <div style={{ marginTop: 10 }}>Generando resumen…</div>
            </div>
          </div>
        )}

        {error && !loading && (
          <div
            style={{
              padding: 14,
              background: "var(--accent-red-soft)",
              color: "var(--accent-red)",
              borderRadius: 8,
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && summary && (
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--text-1)",
            }}
          >
            {summary}
          </div>
        )}

        {!loading && !error && !summary && (
          <div
            className="muted"
            style={{
              textAlign: "center",
              padding: 24,
              fontSize: 12.5,
            }}
          >
            Pulsa "Generar" para crear un resumen de la conversación.
          </div>
        )}
      </div>
    </Modal>
  );
}
