import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Paperclip } from "lucide-react";
import { useContactDetail } from "@/hooks/useContactDetail";
import { sanitizeText } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";

interface EmailThreadPanelProps {
  contactId: string | null;
  customerName: string;
}

function fmtFileSize(bytes: number | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDateLong(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-PE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Outlook/Gmail-style email viewer + composer for an active EMAIL
 * contact. The agent sees:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Subject (header bold)                          [chip TYPE] │
 *   │  De   andre.alata@novasysperu.com                          │
 *   │  Para admision-udep@novasys.email.connect.aws              │
 *   │  CC   (when present)                                       │
 *   │  fecha · adjuntos chip                                     │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  Body (pre-wrap, max-height scroll)                        │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  Adjuntos: [📎 file1.pdf · 1.2 MB ↓]                       │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  Composer (Reply / Reply-all stub)                         │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Right now the Reply composer is read-only (TODO: wire to Connect
 * SendEmail). The viewer is fully functional — the body comes from the
 * contact transcript / attributes via get-contact-detail.
 */
export function EmailThreadPanel({
  contactId,
  customerName,
}: EmailThreadPanelProps) {
  const { detail, loading, error } = useContactDetail(contactId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [replyOpen, setReplyOpen] = useState(false);

  const attrs = detail?.attributes || {};
  // Connect inbound email puts the Subject in `Contact.Name` (not in
  // attributes), the sender in `CustomerEndpoint.Address`, and the
  // recipient in `SystemEndpoint.Address`. For custom outbound flows
  // that DO set email_* attributes we fall back to those.
  const subject =
    sanitizeText(
      detail?.subject || attrs.email_subject || attrs.subject || attrs.Subject || ""
    ) || "(sin asunto)";
  const from =
    detail?.customerEndpoint ||
    attrs.email_from ||
    attrs.from ||
    attrs.From ||
    "";
  const to =
    detail?.systemEndpoint ||
    attrs.email_to ||
    attrs.to ||
    attrs.To ||
    "";
  const cc = attrs.email_cc || attrs.cc || attrs.Cc || "";
  const segments = detail?.transcript?.segments || [];
  // Connect dumps the email body into transcript segments. Concatenate
  // them in order, dropping any blank ones.
  const body = useMemo(() => {
    const parts: string[] = [];
    for (const s of segments) {
      const c = (s.content || "").trim();
      if (c) parts.push(c);
    }
    return parts.join("\n\n");
  }, [segments]);

  // Reset reply box when the contact changes
  useEffect(() => {
    setReplyOpen(false);
  }, [contactId]);

  if (!contactId) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 220,
          color: "var(--text-3)",
          textAlign: "center",
          padding: 24,
          fontSize: 13,
        }}
      >
        <div>
          <Icon.Mail size={28} style={{ opacity: 0.4 }} />
          <div style={{ marginTop: 10 }}>
            El email aparecerá cuando el contacto esté activo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-1)",
      }}
    >
      {/* Header — subject + meta */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-1)",
          background: "var(--bg-1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <Icon.Mail
            size={18}
            style={{ color: "var(--accent-amber)", marginTop: 2, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--text-1)",
                lineHeight: 1.3,
                wordBreak: "break-word",
              }}
              title={subject}
            >
              {subject}
            </div>
            {detail?.initiationTimestamp && (
              <div
                className="muted"
                style={{ fontSize: 11, marginTop: 3 }}
              >
                {fmtDateLong(detail.initiationTimestamp)}
                {detail.queueName && ` · ${detail.queueName}`}
              </div>
            )}
          </div>
          <span
            className="chip"
            style={{
              fontSize: 10.5,
              background: "var(--accent-amber-soft)",
              color: "var(--accent-amber)",
              borderColor: "transparent",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Mail size={12} /> Email
          </span>
        </div>

        {/* From / To / CC — Gmail-style mini header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "60px 1fr",
            gap: "3px 10px",
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          {from && (
            <>
              <span className="muted" style={{ fontWeight: 500 }}>
                De
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={from}
              >
                {sanitizeText(from)}{" "}
                {customerName && (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    · {customerName}
                  </span>
                )}
              </span>
            </>
          )}
          {to && (
            <>
              <span className="muted" style={{ fontWeight: 500 }}>
                Para
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={to}
              >
                {sanitizeText(to)}
              </span>
            </>
          )}
          {cc && (
            <>
              <span className="muted" style={{ fontWeight: 500 }}>
                CC
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={cc}
              >
                {sanitizeText(cc)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 22px",
          background: "var(--bg-0, #fafafa)",
          color: "var(--text-1)",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {loading && !detail && (
          <div
            className="muted"
            style={{ padding: 16, textAlign: "center", fontSize: 12.5 }}
          >
            Cargando email…
          </div>
        )}
        {error && (
          <div
            style={{
              padding: 12,
              background: "var(--accent-red-soft)",
              color: "var(--accent-red)",
              borderRadius: 6,
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && !body && (
          <div
            className="muted"
            style={{ padding: 20, textAlign: "center", fontSize: 12.5 }}
          >
            (Sin cuerpo de email disponible. Revisa la consola de Connect.)
          </div>
        )}
        {body && sanitizeText(body)}
      </div>

      {/* Attachments strip */}
      {(detail?.attachments?.length || 0) > 0 && (
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border-1)",
            background: "var(--bg-1)",
          }}
        >
          <div
            className="muted"
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            {detail?.attachments?.length} adjunto
            {(detail?.attachments?.length || 0) === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(detail?.attachments || []).map((a) => (
              <a
                key={a.fileId}
                href={a.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  fontSize: 11.5,
                  color: "var(--text-1)",
                  textDecoration: "none",
                  cursor: a.url ? "pointer" : "not-allowed",
                  opacity: a.url ? 1 : 0.5,
                  maxWidth: 280,
                }}
              >
                <Paperclip size={13} style={{ flexShrink: 0 }} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 180,
                  }}
                  title={a.fileName || a.fileId}
                >
                  {a.fileName || a.fileId}
                </span>
                <span className="muted" style={{ fontSize: 10 }}>
                  {fmtFileSize(a.fileSizeBytes) || a.fileStatus || ""}
                </span>
                {a.url && (
                  <Icon.Download
                    size={11}
                    style={{ color: "var(--accent-cyan)" }}
                  />
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Compose footer — collapsed by default */}
      <div
        style={{
          padding: "10px 18px",
          borderTop: "1px solid var(--border-1)",
          background: "var(--bg-1)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {replyOpen ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon.Mail size={13} style={{ color: "var(--accent-amber)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                Responder a {from || customerName}
              </span>
              <button
                className="btn btn--ghost btn--sm btn--icon"
                onClick={() => setReplyOpen(false)}
                style={{ marginLeft: "auto" }}
                title="Cerrar"
              >
                <Icon.Close size={11} />
              </button>
            </div>
            <textarea
              placeholder="Escribe tu respuesta…"
              style={{
                width: "100%",
                minHeight: 80,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: 6,
                padding: 10,
                fontFamily: "inherit",
                fontSize: 12.5,
                color: "var(--text-1)",
                resize: "vertical",
                outline: "none",
              }}
            />
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled
                title="Pendiente — necesita wiring a Connect SendEmail"
              >
                Enviar
              </button>
              <span className="muted" style={{ fontSize: 11 }}>
                Próximamente · necesita Connect SendEmail Lambda
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setReplyOpen(true)}
            >
              <Icon.Mail size={11} /> Responder
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled
              title="Reply-all · próximamente"
            >
              Responder a todos
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled
              title="Forward · próximamente"
            >
              Reenviar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
