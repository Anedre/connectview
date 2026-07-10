import { useEffect, useRef, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { useConnections } from "@/hooks/useConnections";
import type { ChatMessage } from "@/hooks/useChatSession";

/**
 * FlowsPopover — botón "Formulario" del composer (solo WhatsApp): envía un
 * WhatsApp Flow (formulario nativo de Meta, #10) al cliente del chat actual.
 * Los Flows disponibles se configuran en Configuración → Integraciones →
 * WhatsApp (el tenant pega el flow_id publicado en Meta Business Manager).
 *
 * Solo dentro de la ventana de 24h (fuera, Meta solo permite plantillas —
 * misma señal que WindowCountdown). La respuesta del cliente vuelve por el
 * webhook → lead + Customer Profile + trigger de Automatizaciones.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

function isWhatsApp(channel: string | null, label?: string): boolean {
  const c = `${channel || ""} ${label || ""}`.toLowerCase();
  return c.includes("whatsapp") || c.includes("wa");
}

export function FlowsPopover({
  messages,
  channel,
  channelLabel,
  customerPhone,
  disabled,
}: {
  messages: ChatMessage[];
  channel: string | null;
  channelLabel?: string;
  customerPhone?: string | null;
  disabled?: boolean;
}) {
  const ep = getApiEndpoints();
  const { config } = useConnections();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Cerrar al click afuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!isWhatsApp(channel, channelLabel)) return null;
  if (!ep?.sendWhatsAppFlow) return null;

  const flows = config.whatsapp?.flows || [];

  // Ventana de 24h: misma señal que WindowCountdown (último mensaje del cliente).
  const lastInbound = [...messages].reverse().find((m) => m.participantRole === "CUSTOMER");
  const lastTs = lastInbound ? Date.parse(lastInbound.timestamp) || 0 : 0;
  const windowOpen = !!lastTs && Date.now() - lastTs < WINDOW_MS;

  const blocked =
    disabled || !customerPhone
      ? "Necesita el teléfono del cliente"
      : !windowOpen
        ? "Ventana de 24h cerrada — solo plantillas"
        : null;

  const send = async (f: { id: string; name: string; cta?: string; screen?: string }) => {
    if (!customerPhone || sending) return;
    setSending(f.id);
    try {
      const r = await fetch(ep.sendWhatsAppFlow!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: customerPhone,
          flowId: f.id,
          flowName: f.name,
          cta: f.cta,
          screen: f.screen,
          bodyText: `Completa el formulario "${f.name}" para continuar 👉`,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.sent) throw new Error(d?.error || "no se pudo enviar");
      toast.success(`Formulario "${f.name}" enviado`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al enviar el formulario");
    } finally {
      setSending(null);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="btn btn--ghost btn--sm btn--icon"
        style={{ fontSize: 14 }}
        title={blocked || "Enviar formulario (WhatsApp Flow)"}
        aria-label="Enviar formulario"
        disabled={!!blocked}
        onClick={() => setOpen((o) => !o)}
      >
        <ClipboardList size={16} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: "var(--z-dropdown)" as unknown as number,
            background: "var(--bg-1)",
            border: "1px solid var(--border-2)",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            padding: 6,
            minWidth: 260,
          }}
        >
          <div
            style={{
              padding: "6px 10px",
              fontSize: 10.5,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            Formularios · WhatsApp Flows
          </div>
          {flows.length === 0 ? (
            <div
              style={{
                padding: "10px 10px 12px",
                fontSize: 12,
                color: "var(--text-2)",
                maxWidth: 260,
              }}
            >
              No hay formularios configurados. Registra tus Flows (id + nombre) en{" "}
              <b>Configuración → Integraciones → WhatsApp</b>.
            </div>
          ) : (
            flows.map((f) => (
              <button
                key={f.id}
                className="sb__item"
                style={{ margin: 0, padding: "8px 10px" }}
                disabled={sending !== null}
                onClick={() => send(f)}
              >
                {sending === f.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ClipboardList size={14} style={{ color: "var(--accent-pink)" }} />
                )}
                <span className="sb__label">{f.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
