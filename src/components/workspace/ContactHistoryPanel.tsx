import { useState } from "react";
import { useContactHistory } from "@/hooks/useContactHistory";
import { formatDistanceToNow, format } from "date-fns";
import * as Icon from "@/components/vox/primitives";
import type { ChannelType } from "@/components/vox/primitives";
import { ContactDetailModal } from "@/components/workspace/ContactDetailModal";

interface ContactHistoryPanelProps {
  phone: string | null;
}

const CHANNEL_MAP: Record<
  string,
  { type: ChannelType; color: string; Icn: (typeof Icon)["Phone"] }
> = {
  VOICE: { type: "voice", color: "var(--accent-green)", Icn: Icon.Phone },
  CHAT: { type: "chat", color: "var(--accent-cyan)", Icn: Icon.Chat },
  EMAIL: { type: "email", color: "var(--accent-amber)", Icn: Icon.Mail },
  TASK: { type: "sms", color: "var(--accent-violet)", Icn: Icon.Note },
};

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function ContactHistoryPanel({ phone }: ContactHistoryPanelProps) {
  const { contacts, loading, error } = useContactHistory(phone);
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  if (!phone) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 220,
          color: "var(--text-3)",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <Icon.Calendar size={28} style={{ opacity: 0.45 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            El historial del cliente aparecerá cuando haya un contacto activo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <span className="section-title" style={{ margin: 0 }}>
          Historial
        </span>
        <span className="chip">
          {contacts.length} contactos · 90 días
        </span>
      </div>

      {loading && (
        <div
          className="muted"
          style={{ padding: 16, textAlign: "center", fontSize: 12.5 }}
        >
          Cargando historial…
        </div>
      )}
      {error && !loading && (
        <div
          style={{
            padding: 10,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
            borderRadius: 8,
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}
      {!loading && !error && contacts.length === 0 && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-3)",
            fontSize: 12.5,
          }}
        >
          Sin contactos previos para <span className="mono">{phone}</span>.
          Primera llamada.
        </div>
      )}

      <div className="tl">
        {contacts.map((contact) => {
          const meta = CHANNEL_MAP[contact.channel] ?? CHANNEL_MAP.VOICE;
          const Icn = meta.Icn;
          return (
            <div
              key={contact.contactId}
              className="tl__item"
              onClick={() => setOpenContactId(contact.contactId)}
              style={{ cursor: "pointer" }}
              title="Click para ver el detalle (grabación, transcripción, adjuntos)"
            >
              <div
                className="tl__dot"
                style={{ color: meta.color, borderColor: meta.color }}
              >
                <Icn size={11} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="spread" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tl__time">
                      {format(
                        new Date(contact.initiationTimestamp),
                        "dd MMM yyyy HH:mm"
                      )}
                    </div>
                    <div className="tl__body">
                      <div className="tl__title">
                        {contact.channel}
                        {contact.subChannel ? ` · ${contact.subChannel}` : ""} ·{" "}
                        {formatDistanceToNow(
                          new Date(contact.initiationTimestamp),
                          { addSuffix: true }
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {contact.agentUsername
                          ? `Agente: ${contact.agentUsername}`
                          : "Sin agente asignado"}
                        {contact.disconnectReason && (
                          <> · {contact.disconnectReason}</>
                        )}
                      </div>
                      <div
                        className="row"
                        style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}
                      >
                        <span className="chip" style={{ height: 18, fontSize: 10.5 }}>
                          {formatDuration(contact.duration)}
                        </span>
                        {contact.hasRecording && (
                          <span
                            className="chip chip--violet"
                            style={{ height: 18, fontSize: 10.5 }}
                          >
                            <Icon.Disc size={10} /> Grabación
                          </span>
                        )}
                        {contact.initiationMethod && (
                          <span className="chip" style={{ height: 18, fontSize: 10.5 }}>
                            {contact.initiationMethod}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ContactDetailModal
        open={!!openContactId}
        onClose={() => setOpenContactId(null)}
        contactId={openContactId}
      />
    </div>
  );
}
