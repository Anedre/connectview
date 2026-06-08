import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

interface WhatsAppTemplate {
  name: string;
  language: string;
  body?: string;
  variableCount?: number;
  category?: string;
  status?: string;
}

interface WhatsAppQuickSendModalProps {
  open: boolean;
  onClose: () => void;
  /** E.164 phone of the recipient. */
  phone: string;
  /** Optional name shown in the recipient chip. */
  customerName?: string;
  /** Optional callback after a successful send. */
  onSent?: () => void;
}

/**
 * Quick WhatsApp template send — one-shot dialog used from the Leads
 * board, the customer 360°, and anywhere else the agent wants to send
 * an approved template NOW (vs scheduling it via ScheduleCallback).
 *
 * Posts to the `sendWhatsAppTemplate` Lambda (which wraps the AWS
 * SocialMessaging SendWhatsAppMessage API + records the send in the
 * `connectview-hsm-sends` audit table).
 */
export function WhatsAppQuickSendModal({
  open,
  onClose,
  phone,
  customerName,
  onSent,
}: WhatsAppQuickSendModalProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [language, setLanguage] = useState("es");
  const [vars, setVars] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  // Reset + lazy-load templates when the modal opens.
  useEffect(() => {
    if (!open) return;
    setTemplateName("");
    setVars([]);
    setLanguage("es");
    const endpoints = getApiEndpoints();
    if (!endpoints?.listWhatsAppTemplates) return;
    setLoading(true);
    fetch(endpoints.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => {
        const list = (j.templates || []) as WhatsAppTemplate[];
        setTemplates(list);
        if (list.length > 0) {
          const first = list[0];
          setTemplateName(first.name);
          setLanguage(first.language || "es");
          setVars(new Array(first.variableCount || 0).fill(""));
        }
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [open]);

  // Adjust the variables array when a different template is picked.
  useEffect(() => {
    if (!templateName) return;
    const tpl = templates.find((t) => t.name === templateName);
    if (!tpl) return;
    setLanguage(tpl.language || "es");
    setVars((prev) => {
      const n = tpl.variableCount || 0;
      const next = new Array(n).fill("");
      for (let i = 0; i < Math.min(prev.length, n); i++) next[i] = prev[i];
      return next;
    });
  }, [templateName, templates]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, sending]);

  const pickedTemplate = useMemo(
    () => templates.find((t) => t.name === templateName) || null,
    [templates, templateName]
  );

  const send = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.sendWhatsAppTemplate) {
      toast.error("Endpoint sendWhatsAppTemplate no configurado");
      return;
    }
    if (!templateName) {
      toast.error("Selecciona un template");
      return;
    }
    if (!phone || !/^\+\d{7,15}$/.test(phone)) {
      toast.error("Teléfono inválido (formato E.164)");
      return;
    }
    const expected = pickedTemplate?.variableCount || 0;
    if (vars.filter((v) => v.trim()).length < expected) {
      toast.error(`Faltan variables (${expected} requeridas)`);
      return;
    }
    setSending(true);
    try {
      const r = await fetch(endpoints.sendWhatsAppTemplate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          templateName,
          language,
          variables: vars,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      toast.success("WhatsApp enviado");
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enviar WhatsApp"
      onClick={() => !sending && onClose()}
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
          width: 440,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--accent-green-soft)",
              color: "var(--accent-green)",
            }}
          >
            <Icon.WhatsApp size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Enviar WhatsApp</div>
            <div className="muted" style={{ fontSize: 11 }}>
              Template aprobado · via Amazon Connect
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            disabled={sending}
            aria-label="Cerrar"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Recipient chip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 10,
            }}
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--accent-green)",
                color: "white",
              }}
            >
              <Icon.Phone size={13} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {customerName && (
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-1)",
                  }}
                >
                  {customerName}
                </div>
              )}
              <div
                className="mono"
                style={{ fontSize: 11.5, color: "var(--text-3)" }}
              >
                {phone}
              </div>
            </div>
          </div>

          {/* Template picker */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: 10.5,
                color: "var(--text-3)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Plantilla aprobada
            </span>
            {loading ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Cargando templates…
              </div>
            ) : (
              <select
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                style={{
                  width: "100%",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 8,
                  padding: "9px 10px",
                  color: "var(--text-1)",
                  outline: "none",
                  fontSize: 13,
                  fontFamily: "var(--font-ui)",
                }}
              >
                {templates.length === 0 ? (
                  <option value="">No hay templates aprobadas</option>
                ) : (
                  templates.map((t) => (
                    <option key={`${t.name}|${t.language}`} value={t.name}>
                      {t.name} · {t.language}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>

          {/* Template preview */}
          {pickedTemplate?.body && (
            <div
              style={{
                padding: "10px 12px",
                background: "var(--accent-green-soft)",
                border: "1px solid var(--accent-green)",
                borderRadius: 10,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "var(--text-1)",
                whiteSpace: "pre-wrap",
              }}
            >
              {pickedTemplate.body}
            </div>
          )}

          {/* Variables */}
          {vars.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Variables del template
              </span>
              {vars.map((v, i) => (
                <input
                  key={i}
                  type="text"
                  value={v}
                  onChange={(e) =>
                    setVars((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder={`{{${i + 1}}}`}
                  style={{
                    width: "100%",
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "7px 10px",
                    color: "var(--text-1)",
                    outline: "none",
                    fontSize: 12.5,
                    fontFamily: "var(--font-ui)",
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
            background: "var(--bg-2)",
          }}
        >
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={sending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn"
            onClick={send}
            disabled={sending || !templateName}
            style={{
              background: "var(--accent-green)",
              borderColor: "var(--accent-green)",
              color: "white",
              fontWeight: 600,
            }}
          >
            <Icon.WhatsApp size={13} />
            {sending ? "Enviando…" : "Enviar ahora"}
          </button>
        </div>
      </div>
    </div>
  );
}
