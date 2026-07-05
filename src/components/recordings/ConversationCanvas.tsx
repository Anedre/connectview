import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { fetchContactHistory } from "@/hooks/useCallHistory";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import { initials } from "@/lib/initials";
import {
  ChatTranscriptView,
  type ChatSegment,
  type ChatAttachment,
} from "@/components/recordings/ChatTranscriptView";
import { useContactDetail, type ContactDetail } from "@/hooks/useContactDetail";
import { VALORACION_META } from "@/lib/dispositions";
import { formatDurationSec, sanitizeText } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import type { TranscriptSegment } from "@/types/recordings";

/**
 * ConversationCanvas — the unified omnichannel thread. Given a customer phone,
 * it pulls EVERY contact across channels (voice / WhatsApp / email) into one
 * chronological canvas. Each contact is a card on a channel-colored rail;
 * clicking it expands the real conversation inline — the premium waveform +
 * transcript for calls, WhatsApp bubbles for chats, the message for emails — so
 * an agent reads the whole relationship as one continuous conversation without
 * hopping between screens.
 *
 * Design opportunity #1 from the audit: the omnichannel thread.
 */

export interface CanvasContact {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  duration: number;
  agentUsername?: string;
  queueName?: string;
  disconnectReason?: string;
  hasRecording?: boolean;
}

interface ChannelMeta {
  key: "voice" | "chat" | "email" | "other";
  label: string;
  color: string;
  soft: string;
  icon: ReactNode;
}

function channelMeta(channel?: string): ChannelMeta {
  const c = (channel || "").toUpperCase();
  if (c === "VOICE" || c === "TELEPHONY")
    return {
      key: "voice",
      label: "Llamada",
      color: "var(--accent-cyan)",
      soft: "var(--accent-cyan-soft)",
      icon: <Icon.Phone size={14} />,
    };
  if (c === "CHAT")
    return {
      key: "chat",
      label: "WhatsApp",
      color: "var(--accent-green)",
      soft: "var(--accent-green-soft)",
      icon: <Icon.WhatsApp size={14} />,
    };
  if (c === "EMAIL")
    return {
      key: "email",
      label: "Email",
      color: "var(--accent-violet)",
      soft: "var(--accent-violet-soft)",
      icon: <Icon.Mail size={14} />,
    };
  return {
    key: "other",
    label: channel || "Contacto",
    color: "var(--text-3)",
    soft: "var(--bg-2)",
    icon: <Icon.Note size={14} />,
  };
}

/** El agentUsername a veces llega como un GUID sin resolver (cola/IVR sin agente
 *  humano) — no lo mostramos crudo; caemos al nombre de la cola. */
const looksUuid = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s);
const agentOrQueue = (c: { agentUsername?: string; queueName?: string }) =>
  c.agentUsername && !looksUuid(c.agentUsername) ? c.agentUsername : c.queueName || "";

/** ContactDetail segments (…OffsetMs) → TranscriptSegment (…OffsetMillis). */
function toTranscript(detail: ContactDetail | null): TranscriptSegment[] {
  const segs = detail?.transcript?.segments || [];
  return segs
    .filter((s) => s.type === "transcript" || s.type === "message")
    .map((s) => ({
      participant: (s.participant || "UNKNOWN") as TranscriptSegment["participant"],
      content: s.content || "",
      beginOffsetMillis: s.beginOffsetMs ?? 0,
      endOffsetMillis: s.endOffsetMs ?? 0,
      sentiment: s.sentiment,
    }));
}

interface DemoData {
  contacts: CanvasContact[];
  details: Record<string, ContactDetail>;
}

interface Props {
  phone: string | null;
  name?: string;
  /** Demo escape hatch: inject contacts + per-contact details and skip the
   *  network. Mirrors WrapUpView's `initialSuggestion`. Production never sets it. */
  demo?: DemoData;
}

export function ConversationCanvas({ phone, name, demo }: Props) {
  const [contacts, setContacts] = useState<CanvasContact[]>(demo?.contacts || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (demo) return; // injected — no fetch
    setContacts([]);
    setError(null);
    setExpandedId(null);
    if (!phone) return;
    let alive = true;
    setLoading(true);
    // Fetch COMPARTIDO (dedup + caché): misma data que el heatmap y los conteos.
    fetchContactHistory(phone)
      .then((rows) => {
        if (alive) setContacts(rows);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Error cargando el hilo");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [phone, demo]);

  // Newest first.
  const ordered = useMemo(
    () =>
      [...contacts].sort((a, b) =>
        (b.initiationTimestamp || "").localeCompare(a.initiationTimestamp || ""),
      ),
    [contacts],
  );

  // Per-channel counts for the header summary.
  const counts = useMemo(() => {
    const acc = { voice: 0, chat: 0, email: 0 };
    for (const c of contacts) {
      const k = channelMeta(c.channel).key;
      if (k === "voice") acc.voice++;
      else if (k === "chat") acc.chat++;
      else if (k === "email") acc.email++;
    }
    return acc;
  }, [contacts]);

  if (!phone && !demo) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <Icon.Chat size={30} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 10 }}>Elegí un cliente para ver su conversación completa.</div>
        <div style={{ marginTop: 4, fontSize: 11 }}>
          Llamadas, WhatsApp y emails — un solo hilo, en orden.
        </div>
      </div>
    );
  }

  const summaryChips: { n: number; label: string; meta: ChannelMeta }[] = [
    {
      n: counts.voice,
      label: counts.voice === 1 ? "llamada" : "llamadas",
      meta: channelMeta("VOICE"),
    },
    { n: counts.chat, label: "WhatsApp", meta: channelMeta("CHAT") },
    { n: counts.email, label: counts.email === 1 ? "email" : "emails", meta: channelMeta("EMAIL") },
  ].filter((c) => c.n > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header — quién es + resumen por canal */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 2px 14px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 15,
            fontWeight: 700,
            background: "var(--accent-violet-soft)",
            color: "var(--accent-violet)",
            flex: "0 0 auto",
          }}
        >
          {initials(name || phone)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
            {name || phone}
          </div>
          {name && (
            <div className="mono muted" style={{ fontSize: 11 }}>
              {phone}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {summaryChips.map((c) => (
            <span
              key={c.meta.label}
              className="chip"
              style={{
                gap: 5,
                background: c.meta.soft,
                color: c.meta.color,
                borderColor: "transparent",
              }}
            >
              {c.meta.icon} {c.n} {c.label}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
          Cargando conversación…
        </div>
      ) : error ? (
        <div
          style={{
            margin: "8px 0",
            padding: 12,
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
            borderRadius: 8,
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      ) : ordered.length === 0 ? (
        <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
          Sin interacciones registradas para este cliente.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {ordered.map((c, i) => (
            <ConversationItem
              key={c.contactId}
              contact={c}
              last={i === ordered.length - 1}
              expanded={expandedId === c.contactId}
              onToggle={() => setExpandedId((id) => (id === c.contactId ? null : c.contactId))}
              demoDetail={demo?.details[c.contactId]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationItem({
  contact,
  last,
  expanded,
  onToggle,
  demoDetail,
}: {
  contact: CanvasContact;
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
  demoDetail?: ContactDetail;
}) {
  const meta = channelMeta(contact.channel);
  const ts = contact.initiationTimestamp;
  const rel = ts ? formatDistanceToNow(new Date(ts), { addSuffix: true, locale: es }) : "";
  const exact = ts ? format(new Date(ts), "d MMM yyyy · HH:mm", { locale: es }) : "";

  return (
    <div className="row" style={{ gap: 12, alignItems: "stretch" }}>
      {/* Rail */}
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 32,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: meta.soft,
            color: meta.color,
            border: `1px solid color-mix(in srgb, ${meta.color} 40%, transparent)`,
            flex: "0 0 auto",
          }}
        >
          {meta.icon}
        </span>
        {!last && (
          <span
            style={{
              flex: 1,
              width: 2,
              background: "var(--border-1)",
              marginTop: 2,
              minHeight: 10,
            }}
          />
        )}
      </div>

      {/* Card */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            width: "100%",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border-1)",
            borderLeftWidth: 3,
            borderLeftStyle: "solid",
            borderLeftColor: meta.color,
            background: expanded ? "var(--bg-active)" : "var(--bg-1)",
            cursor: "pointer",
            color: "var(--text-1)",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{meta.label}</span>
              {meta.key === "voice" && contact.duration > 0 && (
                <span className="chip" style={{ height: 17, fontSize: 10 }}>
                  <Icon.Clock size={10} /> {formatDurationSec(contact.duration)}
                </span>
              )}
              {meta.key === "voice" && contact.hasRecording && (
                <span
                  className="chip"
                  style={{ height: 17, fontSize: 10, background: meta.soft, color: meta.color }}
                >
                  <Icon.Disc size={10} /> grabación
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {exact}
              {agentOrQueue(contact) ? ` · ${agentOrQueue(contact)}` : ""}
              {rel ? ` · ${rel}` : ""}
            </div>
          </div>
          <span
            style={{
              fontSize: 15,
              color: "var(--text-3)",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s",
              flex: "0 0 auto",
            }}
          >
            ›
          </span>
        </button>

        {expanded && (
          <div style={{ marginTop: 10 }}>
            <ConversationItemBody contact={contact} demoDetail={demoDetail} />
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationItemBody({
  contact,
  demoDetail,
}: {
  contact: CanvasContact;
  demoDetail?: ContactDetail;
}) {
  // When demo data is injected we skip the hook fetch (pass null).
  const { detail: fetched, loading } = useContactDetail(demoDetail ? null : contact.contactId);
  const detail = demoDetail || fetched;
  const meta = channelMeta(contact.channel);

  if (loading && !detail) {
    return (
      <div className="muted" style={{ fontSize: 11.5, padding: "8px 2px" }}>
        Cargando contenido…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="muted" style={{ fontSize: 11.5, padding: "8px 2px" }}>
        Sin contenido disponible.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {detail.wrapUp?.summary && (
        <SummaryStrip summary={detail.wrapUp.summary} valoracion={detail.wrapUp.valoracion} />
      )}
      {meta.key === "voice" && <VoiceBody detail={detail} />}
      {meta.key === "chat" && (
        <div
          style={{
            border: "1px solid var(--border-1)",
            borderRadius: 10,
            padding: 8,
            background: "var(--bg-2)",
          }}
        >
          <ChatTranscriptView
            segments={(detail.transcript?.segments || []) as unknown as ChatSegment[]}
            attachments={(detail.attachments || []) as unknown as ChatAttachment[]}
            dense
          />
        </div>
      )}
      {meta.key === "email" && <EmailBody detail={detail} />}
      {meta.key === "other" && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          Canal “{contact.channel}” sin vista detallada.
        </div>
      )}
    </div>
  );
}

function VoiceBody({ detail }: { detail: ContactDetail }) {
  const audioRef = useRef<AudioPlayerHandle>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const segments = useMemo(() => toTranscript(detail), [detail]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
      <AudioPlayer
        ref={audioRef}
        src={detail.recording?.url || ""}
        onTimeUpdate={setCurrentMs}
        segments={segments}
        durationSecHint={detail.duration}
      />
      <div
        style={{
          border: "1px solid var(--border-1)",
          borderRadius: 10,
          padding: 8,
          background: "var(--bg-2)",
        }}
      >
        <TranscriptViewer
          segments={segments}
          currentTimeMs={currentMs}
          onSeek={(ms) => audioRef.current?.seekTo(ms)}
        />
      </div>
    </div>
  );
}

function EmailBody({ detail }: { detail: ContactDetail }) {
  const attrs = detail.attributes || {};
  const subject =
    sanitizeText(attrs.email_subject || attrs.subject || attrs.Subject || "") || "(sin asunto)";
  const segments = detail.transcript?.segments || [];
  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        padding: 12,
        background: "var(--bg-2)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{subject}</div>
      {segments.length > 0 ? (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            color: "var(--text-1)",
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {segments.map((s, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              {sanitizeText(s.content || "")}
            </div>
          ))}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11.5 }}>
          El cuerpo del email no está en el transcript. Los adjuntos sí.
        </div>
      )}
      {(detail.attachments?.length || 0) > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {detail.attachments.map((a) => (
            <span key={a.fileId} className="chip" style={{ fontSize: 10.5 }}>
              <Icon.Note size={10} /> {a.fileName || a.fileId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({ summary, valoracion }: { summary: string; valoracion?: string }) {
  const valMeta =
    valoracion && (valoracion as keyof typeof VALORACION_META) in VALORACION_META
      ? VALORACION_META[valoracion as keyof typeof VALORACION_META]
      : null;
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "9px 11px",
        borderRadius: 10,
        background: "var(--accent-violet-soft)",
        border: "1px solid color-mix(in srgb, var(--accent-violet) 25%, transparent)",
      }}
    >
      <Icon.Sparkles
        size={13}
        style={{ color: "var(--accent-violet)", flex: "0 0 auto", marginTop: 2 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-violet)" }}>
            Resumen IA
          </span>
          {valMeta && (
            <span className={`chip ${valMeta.chip}`} style={{ height: 16, fontSize: 9.5 }}>
              <span className="dot" /> {valMeta.label}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-1)" }}>{summary}</div>
      </div>
    </div>
  );
}
