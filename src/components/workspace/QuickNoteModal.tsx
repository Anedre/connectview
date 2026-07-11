import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import * as Icon from "@/components/vox/primitives";

interface QuickNoteModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
  agentUsername: string;
}

// Validación declarativa con zod (PoC react-hook-form + zod): la nota es
// obligatoria (sin contar espacios) y tiene un tope de 500 caracteres. El
// mensaje de cada regla se muestra inline bajo el textarea.
const noteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Escribe una nota antes de guardar")
    .max(500, "La nota no puede superar los 500 caracteres"),
});
type NoteForm = z.infer<typeof noteSchema>;

/**
 * Tiny modal for jotting a quick note during a chat / voice contact
 * without opening the full Cliente 360° notes panel. The note gets
 * appended (with a timestamp) to whatever's already saved on
 * `saveAgentNotes` so nothing the agent typed before is overwritten.
 *
 * Formulario manejado con react-hook-form + zodResolver: validación tipada,
 * estado de envío (isSubmitting) y errores sin useState a mano. El "chrome"
 * (overlay, focus-trap, Esc, restore-focus) lo aporta el primitivo `Modal`.
 */
export function QuickNoteModal({ open, onClose, contactId, agentUsername }: QuickNoteModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<NoteForm>({
    resolver: zodResolver(noteSchema),
    defaultValues: { text: "" },
  });

  // Limpia al cerrar; enfoca el textarea al abrir.
  useEffect(() => {
    if (!open) {
      reset({ text: "" });
      return;
    }
    const t = setTimeout(() => setFocus("text"), 50);
    return () => clearTimeout(t);
  }, [open, reset, setFocus]);

  const onSubmit = async ({ text }: NoteForm) => {
    if (!contactId) {
      toast.error("Sin contacto activo");
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.saveAgentNotes) {
      toast.error("Endpoint de notas no configurado");
      return;
    }
    try {
      // Pull current notes first so we don't clobber anything the agent
      // already typed in the Cliente 360° panel.
      const r = await fetch(
        `${endpoints.saveAgentNotes}?contactId=${encodeURIComponent(contactId)}`,
      );
      const current = r.ok ? await r.json() : { notes: "" };
      const ts = new Date().toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const stamp = `[${ts} · ${agentUsername || "agente"}]`;
      const merged = current.notes ? `${current.notes}\n${stamp} ${text}` : `${stamp} ${text}`;
      const put = await fetch(endpoints.saveAgentNotes, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, agentUsername, notes: merged }),
      });
      if (!put.ok) throw new Error(`HTTP ${put.status}`);
      toast.success("Nota guardada");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la nota");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && !isSubmitting) onClose();
      }}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon.Note size={14} style={{ color: "var(--accent-amber)" }} />
          Nota rápida
        </span>
      }
      className="max-w-sm"
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="quick-note-form"
            className="btn btn--success"
            disabled={isSubmitting || !contactId}
          >
            {isSubmitting ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="quick-note-form" onSubmit={handleSubmit(onSubmit)} style={{ marginTop: 12 }}>
        <textarea
          {...register("text")}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              handleSubmit(onSubmit)();
            }
          }}
          placeholder="Escribe una nota corta…"
          rows={5}
          aria-invalid={errors.text ? "true" : "false"}
          style={{
            width: "100%",
            background: "var(--bg-2)",
            border: `1px solid ${errors.text ? "var(--accent-red)" : "var(--border-1)"}`,
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

        {errors.text ? (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--accent-red)", marginTop: 6 }}>
            {errors.text.message}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Se añade al panel de notas con tu nombre y la hora. ⌘+Enter para guardar.
          </div>
        )}
      </form>
    </Modal>
  );
}
