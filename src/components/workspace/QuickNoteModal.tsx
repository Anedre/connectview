import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

interface QuickNoteModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
  agentUsername: string;
}

/**
 * Tiny modal for jotting a quick note during a chat / voice contact
 * without opening the full Cliente 360° notes panel. The note gets
 * appended (with a timestamp) to whatever's already saved on
 * `saveAgentNotes` so nothing the agent typed before is overwritten.
 */
export function QuickNoteModal({
  open,
  onClose,
  contactId,
  agentUsername,
}: QuickNoteModalProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setSaving(false);
      return;
    }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, saving]);

  const save = async () => {
    if (!contactId) {
      toast.error("Sin contacto activo");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.saveAgentNotes) {
      toast.error("Endpoint de notas no configurado");
      return;
    }
    setSaving(true);
    try {
      // Pull current notes first so we don't clobber anything the agent
      // already typed in the Cliente 360° panel.
      const r = await fetch(
        `${endpoints.saveAgentNotes}?contactId=${encodeURIComponent(contactId)}`
      );
      const current = r.ok ? await r.json() : { notes: "" };
      const ts = new Date().toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const stamp = `[${ts} · ${agentUsername || "agente"}]`;
      const merged = current.notes
        ? `${current.notes}\n${stamp} ${trimmed}`
        : `${stamp} ${trimmed}`;
      const put = await fetch(endpoints.saveAgentNotes, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          agentUsername,
          notes: merged,
        }),
      });
      if (!put.ok) throw new Error(`HTTP ${put.status}`);
      toast.success("Nota guardada");
      onClose();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se pudo guardar la nota"
      );
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nota rápida"
      onClick={() => !saving && onClose()}
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
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <Icon.Note size={14} style={{ color: "var(--accent-amber)" }} />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Nota rápida
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
          }}
          placeholder="Escribe una nota corta…"
          rows={5}
          style={{
            width: "100%",
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            padding: "10px 12px",
            color: "var(--text-1)",
            outline: "none",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            resize: "vertical",
            minHeight: 92,
          }}
        />

        <div
          className="muted"
          style={{ fontSize: 11, marginTop: 6, marginBottom: 10 }}
        >
          Se añade al panel de notas con tu nombre y la hora. ⌘+Enter para
          guardar.
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--success"
            onClick={save}
            disabled={saving || !text.trim() || !contactId}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
