import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

/**
 * RewriterButton — "✨ IA" control in the chat composer. Rewrites the agent's
 * current draft in a chosen tone using Claude (generate-call-summary
 * mode=rewrite). Replaces the draft with the result. Roadmap #19.
 */
const TONES: { id: string; label: string; icon: string }[] = [
  { id: "profesional", label: "Profesional", icon: "👔" },
  { id: "amigable", label: "Amigable", icon: "😊" },
  { id: "conciso", label: "Más conciso", icon: "✂️" },
  { id: "suavizar", label: "Suavizar", icon: "🕊️" },
];

interface Props {
  draft: string;
  disabled?: boolean;
  onRewritten: (text: string) => void;
}

export function RewriterButton({ draft, disabled, onRewritten }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const rewrite = async (tone: string) => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) {
      toast.error("Endpoint de IA no configurado");
      return;
    }
    const text = draft.trim();
    if (!text) {
      toast.message("Escribe algo primero para reescribir");
      return;
    }
    setOpen(false);
    setBusy(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rewrite", text, tone }),
      });
      const data = await r.json().catch(() => ({}));
      const out = (data?.result || "").trim();
      if (out) {
        onRewritten(out);
        toast.success("Mensaje reescrito");
      } else {
        toast.error("No se pudo reescribir, intenta de nuevo");
      }
    } catch {
      toast.error("Error al reescribir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy || !draft.trim()}
        className="btn btn--ghost btn--sm btn--icon"
        title="Reescribir con IA"
        aria-label="Reescribir con IA"
        style={{ fontSize: 14 }}
      >
        {busy ? (
          <Icon.Refresh size={14} style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          <Icon.Sparkles size={14} />
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 50,
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,0.18))",
            padding: 4,
            minWidth: 168,
          }}
        >
          <div
            className="muted"
            style={{ fontSize: 10.5, padding: "4px 8px 2px", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}
          >
            Reescribir en tono…
          </div>
          {TONES.map((t) => (
            <button
              key={t.id}
              onClick={() => rewrite(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                border: 0,
                background: "transparent",
                padding: "7px 8px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12.5,
                color: "var(--text-1)",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
