import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, Mail, MessageCircle } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import * as Icon from "@/components/vox/primitives";

type Channel = "voice" | "email" | "whatsapp";

interface WhatsAppTemplate {
  name: string;
  language: string;
  body?: string;
  variableCount?: number;
  category?: string;
  status?: string;
}

interface EmailAddressEntry {
  id: string;
  arn: string;
  address: string;
  displayName?: string;
}

interface ScheduleFollowupModalProps {
  open: boolean;
  onClose: () => void;
  /** Phone we'll call/whatsapp. Usually the active contact's customerPhone. */
  phone: string | null;
  customerName?: string | null;
  /** Email to use as default recipient when channel=email. Optional. */
  customerEmail?: string | null;
  /** Connect user-id of the agent who promises the follow-up. */
  assignedAgentUserId: string;
  /** Force the channel — used when the wrap-up auto-opens the modal
   *  with a pre-decided channel based on the sub-stage chosen
   *  (volver_llamar → voice, volver_correo → email, etc). */
  defaultChannel?: Channel;
  /** Pre-filled notes — used by the wrap-up integration to seed the
   *  modal with the agent's wrap-up notes. */
  defaultNotes?: string;
  onScheduled?: () => void;
}

const presetMinutes = [15, 30, 60, 120, 240, 1440];

function presetLabel(min: number) {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${min / 60} h`;
  return `${min / 1440} día${min === 1440 ? "" : "s"}`;
}

const CHANNELS: {
  id: Channel;
  label: string;
  icon: React.ElementType;
  help: string;
  /** CSS color token used to tint the active card and submit button */
  color: string;
  colorSoft: string;
}[] = [
  {
    id: "voice",
    label: "Llamada",
    icon: Phone,
    help: "El sistema te llamará automáticamente al cliente y a ti",
    color: "var(--accent-green)",
    colorSoft: "var(--accent-green-soft)",
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    help: "Te recordamos enviar el correo a la hora pactada",
    color: "var(--accent-amber)",
    colorSoft: "var(--accent-amber-soft)",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    help: "Te recordamos enviar el template a la hora pactada",
    color: "var(--accent-cyan)",
    colorSoft: "var(--accent-cyan-soft)",
  },
];

/**
 * "📅 Agendar follow-up" modal — the agent picks WHEN to follow up
 * with the customer and through WHICH channel (voice / email /
 * WhatsApp). Submits to the schedule-callback Lambda which inserts a
 * row in the callbacks table:
 *
 *   channel=voice    → dispatcher places the outbound call at the
 *                      agreed time, attributes carry the agent's user-id
 *   channel=email    → dispatcher marks DUE; row surfaces in the
 *                      agent's "Mis pendientes" drawer so they send it
 *                      manually with the pre-filled subject/body
 *   channel=whatsapp → same as email; row carries the template name +
 *                      variables the agent will send
 *
 * The previously-named "ScheduleCallbackModal" still works (backward
 * compat alias at the bottom) — the modal is just multi-channel now.
 */
export function ScheduleFollowupModal({
  open,
  onClose,
  phone,
  customerName,
  customerEmail,
  assignedAgentUserId,
  defaultChannel = "voice",
  defaultNotes,
  onScheduled,
}: ScheduleFollowupModalProps) {
  // Default to "+1 hour from now" so the picker is rarely empty.
  const defaultIso = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [scheduledLocal, setScheduledLocal] = useState(defaultIso());
  const [notes, setNotes] = useState(defaultNotes || "");
  const [submitting, setSubmitting] = useState(false);

  // Email-specific state — only used when channel === "email".
  const [emailAddresses, setEmailAddresses] = useState<EmailAddressEntry[]>([]);
  const [emailFromId, setEmailFromId] = useState("");
  const [emailTo, setEmailTo] = useState(customerEmail || "");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // WhatsApp-specific state — only used when channel === "whatsapp".
  const [waTemplates, setWaTemplates] = useState<WhatsAppTemplate[]>([]);
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waTemplateLang, setWaTemplateLang] = useState("es");
  const [waVars, setWaVars] = useState<string[]>([]);

  // Reset state every time the modal opens — keeps each follow-up
  // independent and avoids "ghost" data from a previous open.
  useEffect(() => {
    if (open) {
      setChannel(defaultChannel);
      setScheduledLocal(defaultIso());
      setNotes(defaultNotes || "");
      setSubmitting(false);
      setEmailTo(customerEmail || "");
      setEmailSubject("");
      setEmailBody("");
      setEmailFromId("");
      setWaTemplateName("");
      setWaVars([]);
    }
  }, [open, defaultChannel, defaultNotes, customerEmail]);

  // Lazy-load email addresses (only when the user picks email channel)
  useEffect(() => {
    if (!open || channel !== "email" || emailAddresses.length > 0) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.listEmailAddresses) return;
    authedFetch(endpoints.listEmailAddresses)
      .then((r) => r.json())
      .then((j) => {
        const items = (j.items || []) as EmailAddressEntry[];
        setEmailAddresses(items);
        if (items.length > 0 && !emailFromId) setEmailFromId(items[0].id);
      })
      .catch(() => setEmailAddresses([]));
  }, [open, channel, emailAddresses.length, emailFromId]);

  // Lazy-load WhatsApp templates (only when the user picks whatsapp channel)
  useEffect(() => {
    if (!open || channel !== "whatsapp" || waTemplates.length > 0) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.listWhatsAppTemplates) return;
    setWaTemplatesLoading(true);
    fetch(endpoints.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => {
        const list = (j.templates || []) as WhatsAppTemplate[];
        setWaTemplates(list);
        if (list.length > 0 && !waTemplateName) {
          const first = list[0];
          setWaTemplateName(first.name);
          setWaTemplateLang(first.language || "es");
          setWaVars(new Array(first.variableCount || 0).fill(""));
        }
      })
      .catch(() => setWaTemplates([]))
      .finally(() => setWaTemplatesLoading(false));
  }, [open, channel, waTemplates.length, waTemplateName]);

  // Resize the WA-variable array when the user picks a different template
  useEffect(() => {
    if (!waTemplateName) return;
    const tpl = waTemplates.find((t) => t.name === waTemplateName);
    if (!tpl) return;
    setWaTemplateLang(tpl.language || "es");
    setWaVars((prev) => {
      const n = tpl.variableCount || 0;
      const next = new Array(n).fill("");
      for (let i = 0; i < Math.min(prev.length, n); i++) next[i] = prev[i];
      return next;
    });
  }, [waTemplateName, waTemplates]);

  // Esc closes
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

  // Picked template body — we show a preview so the agent confirms
  // they chose the right template.
  const pickedTemplate = useMemo(
    () => waTemplates.find((t) => t.name === waTemplateName) || null,
    [waTemplates, waTemplateName]
  );
  const pickedFromAddress = useMemo(
    () => emailAddresses.find((e) => e.id === emailFromId)?.address || "",
    [emailAddresses, emailFromId]
  );

  const channelMeta = CHANNELS.find((c) => c.id === channel)!;

  const submit = async () => {
    if (!phone) {
      toast.error("No hay teléfono para programar el follow-up");
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
    const ts = new Date(scheduledLocal).getTime();
    if (Number.isNaN(ts)) {
      toast.error("Fecha/hora inválida");
      return;
    }
    if (ts < Date.now() - 30_000) {
      toast.error("La hora del follow-up debe estar en el futuro");
      return;
    }

    // Channel-specific validation
    if (channel === "email") {
      if (!emailTo.trim()) {
        toast.error("Falta el correo del destinatario");
        return;
      }
    }
    if (channel === "whatsapp" && !waTemplateName) {
      toast.error("Selecciona un template de WhatsApp");
      return;
    }

    setSubmitting(true);
    try {
      // Build the payload — only include channel-specific fields when
      // they apply, so the row stays clean.
      const payload: Record<string, unknown> = {
        phone,
        customerName: customerName || "",
        scheduledAt: new Date(ts).toISOString(),
        assignedAgentUserId,
        notes: notes.trim() || undefined,
        channel,
      };
      if (channel === "email") {
        payload.emailToAddress = emailTo.trim();
        payload.emailSubject = emailSubject.trim() || undefined;
        payload.emailBody = emailBody.trim() || undefined;
        if (pickedFromAddress) payload.emailFromAddress = pickedFromAddress;
      }
      if (channel === "whatsapp") {
        payload.templateName = waTemplateName;
        payload.templateLanguage = waTemplateLang;
        payload.templateVariables = waVars.filter((v) => v.trim());
      }

      const r = await fetch(endpoints.scheduleCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      toast.success(
        `Follow-up agendado · ${new Date(ts).toLocaleString("es-PE", {
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

  // Dynamic width — whatsapp + email need more space for the long
  // fields (subject, body, template preview).
  const modalWidth = channel === "voice" ? 380 : 480;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agendar follow-up"
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
          width: modalWidth,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
          fontFamily: "var(--font-ui)",
          display: "flex",
          flexDirection: "column",
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
              background: channelMeta.colorSoft,
              color: channelMeta.color,
              fontSize: 16,
            }}
          >
            <Icon.Calendar size={15} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              Agendar follow-up
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {channelMeta.help}
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

        <div style={{ padding: 16, overflowY: "auto", flex: 1, minHeight: 0 }}>
          {/* Recipient chip — avatar + name + phone */}
          {phone && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: 10,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: channelMeta.color,
                  color: "white",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {(customerName || "C").slice(0, 2).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                  {customerName || "Cliente"}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11.5, color: "var(--text-3)" }}
                >
                  {phone}
                </div>
              </div>
            </div>
          )}

          {/* Channel picker — 3 colored cards */}
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--text-3)",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Canal
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {CHANNELS.map((c) => {
              const active = channel === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannel(c.id)}
                  disabled={submitting}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                    padding: "12px 6px",
                    borderRadius: 10,
                    border: "1px solid",
                    borderColor: active ? c.color : "var(--border-1)",
                    background: active ? c.colorSoft : "var(--bg-2)",
                    color: active ? c.color : "var(--text-2)",
                    cursor: submitting ? "not-allowed" : "pointer",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    transition: "background .15s, border-color .15s, color .15s",
                  }}
                >
                  <c.icon size={22} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>

        {/* Cuándo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 10.5 }}>
            Cuándo
          </span>
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

        {/* Channel-specific fields */}
        {channel === "email" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 10.5 }}>
                De (From)
              </span>
              <select
                value={emailFromId}
                onChange={(e) => setEmailFromId(e.target.value)}
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
                }}
              >
                {emailAddresses.length === 0 ? (
                  <option value="">Cargando…</option>
                ) : (
                  emailAddresses.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.displayName ? `${e.displayName} · ` : ""}
                      {e.address}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 10.5 }}>
                Para (To)
              </span>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="andre@example.com"
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
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 10.5 }}>
                Asunto
              </span>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Ej. Información de admisión UDEP"
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
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 10.5 }}>
                Cuerpo
              </span>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Hola Andre, te comparto la información que pediste..."
                rows={4}
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
                  minHeight: 80,
                  fontFamily: "var(--font-ui)",
                }}
              />
            </div>
          </>
        )}

        {channel === "whatsapp" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 10.5 }}>
                Plantilla aprobada
              </span>
              {waTemplatesLoading ? (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  Cargando templates…
                </div>
              ) : (
                <select
                  value={waTemplateName}
                  onChange={(e) => setWaTemplateName(e.target.value)}
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
                  }}
                >
                  {waTemplates.length === 0 ? (
                    <option value="">No hay templates aprobadas</option>
                  ) : (
                    waTemplates.map((t) => (
                      <option key={`${t.name}|${t.language}`} value={t.name}>
                        {t.name} · {t.language}
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>
            {pickedTemplate?.body && (
              <div
                style={{
                  padding: "8px 10px",
                  background: "var(--accent-green-soft)",
                  border: "1px solid var(--accent-green)",
                  borderRadius: 6,
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: "var(--text-1)",
                  marginBottom: 10,
                  whiteSpace: "pre-wrap",
                }}
              >
                {pickedTemplate.body}
              </div>
            )}
            {waVars.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                <span className="muted" style={{ fontSize: 10.5 }}>
                  Variables del template
                </span>
                {waVars.map((v, i) => (
                  <input
                    key={i}
                    type="text"
                    value={v}
                    onChange={(e) =>
                      setWaVars((prev) => {
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
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--text-1)",
                      outline: "none",
                      fontSize: 12.5,
                      fontFamily: "var(--font-ui)",
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Notas (siempre) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 10.5 }}>
            Notas (opcional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              channel === "voice"
                ? "Ej. Llamarlo después de su clase 📚"
                : channel === "email"
                ? "Recordatorio interno para vos"
                : "Recordatorio interno para vos"
            }
            rows={2}
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
              minHeight: 50,
              fontFamily: "var(--font-ui)",
            }}
          />
        </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: channelMeta.colorSoft,
              color: channelMeta.color,
              fontSize: 11.5,
              lineHeight: 1.5,
              marginBottom: 4,
            }}
          >
            {channel === "voice"
              ? "Te lo asignamos a ti automáticamente — el sistema te llamará al cliente y a ti a la hora pactada."
              : "A la hora pactada aparecerá en tu drawer de pendientes para que envíes el " +
                (channel === "email" ? "correo" : "WhatsApp") +
                " manualmente."}
          </div>
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
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={submitting || !phone || !assignedAgentUserId}
            style={{
              background: channelMeta.color,
              borderColor: channelMeta.color,
              color: "white",
              fontWeight: 600,
            }}
          >
            <Icon.Calendar size={12} />
            {submitting ? "Agendando…" : "Agendar follow-up"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Backward-compat alias — earlier code referenced `ScheduleCallbackModal`.
 * The component is now multi-channel; the name is kept so existing
 * imports keep working without touching every caller.
 */
export const ScheduleCallbackModal = ScheduleFollowupModal;
