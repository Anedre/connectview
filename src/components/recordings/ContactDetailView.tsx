import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getApiEndpoints } from "@/lib/api";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import { ChatTranscriptView } from "@/components/recordings/ChatTranscriptView";
import type { ChatSegment, ChatAttachment } from "@/components/recordings/ChatTranscriptView";
import type { TranscriptSegment } from "@/types/recordings";
import { VALORACION_META } from "@/lib/dispositions";
import { formatDurationSec, sanitizeText } from "@/lib/utils";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

interface ContactWrapUp {
  notes: string;
  summary: string;
  stage: string;
  stageLabel: string;
  subStage: string;
  subStageLabel: string;
  valoracion: string;
  tags: string[];
  followUps: Record<string, boolean>;
  followUpTaskIds: string[];
  agentUsername: string;
  updatedAt: string;
}

interface ContactDetailResponse {
  contactId: string;
  channel: string;
  subChannel?: string;
  initiationTimestamp: string;
  disconnectTimestamp?: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  customerEndpoint?: string;
  attributes?: Record<string, string>;
  recording?: { url: string; expiresAt: string } | null;
  transcript?: {
    segments?: unknown[];
    source?: string;
  } | null;
  attachments?: ChatAttachment[];
  wrapUp?: ContactWrapUp | null;
}

interface Props {
  contactId: string | null;
}

export function ContactDetailView({ contactId }: Props) {
  const [data, setData] = useState<ContactDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    setCurrentTimeMs(0);
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    const url =
      (endpoints as unknown as Record<string, string | undefined>)?.getContactDetail ||
      endpoints?.getRecording;
    if (!url) {
      setError("Endpoint no configurado");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${url}?contactId=${encodeURIComponent(contactId)}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => {
        if (!ok) throw new Error(j.message || `HTTP ${status}`);
        setData(j as ContactDetailResponse);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error cargando contacto");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [contactId]);

  if (!contactId) {
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
        <Icon.Disc size={32} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 12 }}>
          Selecciona un contacto del centro para ver su detalle.
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>
          Voz → audio + transcript · WhatsApp/Chat → conversación con adjuntos
          · Email → mensaje + adjuntos.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="muted"
        style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}
      >
        Cargando contacto…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          margin: 16,
          padding: 12,
          background: "var(--accent-red-soft)",
          color: "var(--accent-red)",
          borderRadius: 8,
          fontSize: 12.5,
        }}
      >
        {error || "Sin datos."}
      </div>
    );
  }

  const channel = (data.channel || "").toUpperCase();
  const isVoice = channel === "VOICE" || channel === "TELEPHONY";
  const isChat = channel === "CHAT";
  const isEmail = channel === "EMAIL";

  // Decide the right detail subcomponent based on channel.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 14,
        overflowY: "auto",
      }}
    >
      <ContactHeader data={data} />
      {data.wrapUp && <WrapUpCard wrapUp={data.wrapUp} />}
      {isVoice && (
        <VoiceDetail data={data} currentTimeMs={currentTimeMs} setCurrentTimeMs={setCurrentTimeMs} />
      )}
      {isChat && <ChatDetail data={data} />}
      {isEmail && <EmailDetail data={data} />}
      {!isVoice && !isChat && !isEmail && (
        <Card>
          <CardBody>
            <div className="muted" style={{ fontSize: 12 }}>
              Canal “{data.channel}” no soporta vista detallada aún.
            </div>
          </CardBody>
        </Card>
      )}
      <AttributesCard attributes={data.attributes} />
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────

function ContactHeader({ data }: { data: ContactDetailResponse }) {
  const ch = (data.channel || "").toUpperCase();
  const isWA = (data.subChannel || "").toLowerCase().includes("messaging");
  const channelLabel =
    ch === "VOICE"
      ? "📞 Llamada"
      : ch === "CHAT"
      ? isWA
        ? "💚 WhatsApp"
        : "💬 Chat"
      : ch === "EMAIL"
      ? "📧 Email"
      : data.channel;
  return (
    <Card>
      <CardBody>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "150px 1fr",
            gap: "8px 14px",
            fontSize: 12.5,
          }}
        >
          <span className="muted">Canal</span>
          <span>
            <span className="chip">{channelLabel}</span>
            {data.initiationMethod && (
              <span
                className="muted"
                style={{ marginLeft: 6, fontSize: 10.5 }}
              >
                · {data.initiationMethod}
              </span>
            )}
          </span>
          <span className="muted">Agente</span>
          <span>{data.agentUsername || "—"}</span>
          <span className="muted">Cola</span>
          <span>{data.queueName || "—"}</span>
          <span className="muted">Cliente</span>
          <span className="mono" style={{ fontSize: 11.5 }}>
            {data.customerEndpoint || "—"}
          </span>
          <span className="muted">Duración</span>
          <span className="mono">{formatDurationSec(data.duration)}</span>
          <span className="muted">Inicio</span>
          <span className="mono" style={{ fontSize: 11.5 }}>
            {data.initiationTimestamp
              ? new Date(data.initiationTimestamp).toLocaleString("es-PE")
              : "—"}
          </span>
          {data.disconnectReason && (
            <>
              <span className="muted">Cierre</span>
              <span style={{ fontSize: 11.5 }}>{data.disconnectReason}</span>
            </>
          )}
          <span className="muted">Contact ID</span>
          <span className="mono" style={{ fontSize: 10.5 }}>
            {data.contactId}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function VoiceDetail({
  data,
  currentTimeMs,
  setCurrentTimeMs,
}: {
  data: ContactDetailResponse;
  currentTimeMs: number;
  setCurrentTimeMs: (n: number) => void;
}) {
  const segs = data.transcript?.segments || [];
  type RawSeg = {
    participant?: string;
    ParticipantRole?: string;
    content?: string;
    Content?: string;
    beginOffsetMs?: number;
    beginOffsetMillis?: number;
    BeginOffsetMillis?: number;
    endOffsetMs?: number;
    endOffsetMillis?: number;
    EndOffsetMillis?: number;
    sentiment?: string;
    Sentiment?: string;
  };
  const transcript: TranscriptSegment[] = (segs as RawSeg[]).map((s) => ({
    participant:
      (s.participant || s.ParticipantRole || "UNKNOWN") as
        | "AGENT"
        | "CUSTOMER"
        | "SYSTEM"
        | "UNKNOWN",
    content: s.content || s.Content || "",
    beginOffsetMillis:
      s.beginOffsetMs ?? s.beginOffsetMillis ?? s.BeginOffsetMillis ?? 0,
    endOffsetMillis: s.endOffsetMs ?? s.endOffsetMillis ?? s.EndOffsetMillis ?? 0,
    sentiment: s.sentiment || s.Sentiment,
  }));

  return (
    <div className="grid-2" style={{ gap: 14 }}>
      <Card>
        <CardHead title="Reproducción de audio" />
        <CardBody>
          <AudioPlayer
            src={data.recording?.url || ""}
            onTimeUpdate={setCurrentTimeMs}
          />
          <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
            {data.recording?.url
              ? "Grabación cargada desde S3 (presigned URL · expira en 1 h)."
              : "Este contacto no tiene grabación disponible en S3."}
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHead title="Transcripción · Contact Lens" />
        <CardBody>
          <TranscriptViewer
            segments={transcript}
            currentTimeMs={currentTimeMs}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function ChatDetail({ data }: { data: ContactDetailResponse }) {
  const segments = (data.transcript?.segments || []) as ChatSegment[];
  const attachments = data.attachments || [];
  return (
    <Card>
      <CardHead
        title="Conversación"
        right={
          <span className="card__sub">
            {segments.length} mensajes · {attachments.length} adjuntos
          </span>
        }
      />
      <CardBody>
        <ChatTranscriptView segments={segments} attachments={attachments} />
      </CardBody>
    </Card>
  );
}

function EmailDetail({ data }: { data: ContactDetailResponse }) {
  const attrs = data.attributes || {};
  const subject =
    sanitizeText(attrs.email_subject || attrs.subject || attrs.Subject || "") ||
    "(sin asunto)";
  const from = attrs.email_from || attrs.from || attrs.From || "";
  const to = attrs.email_to || attrs.to || attrs.To || "";
  const cc = attrs.email_cc || attrs.cc || attrs.Cc || "";
  // Body: prefer Contact Lens chat-style transcript (some Connect email
  // pipelines drop the body into the same JSON shape), otherwise hint to
  // the agent that the body is in the attachments / Connect console.
  const segments = (data.transcript?.segments || []) as Array<{
    participant?: string;
    content?: string;
    contentType?: string;
    timestamp?: string;
  }>;

  return (
    <Card>
      <CardHead
        title="Email"
        right={
          <span className="card__sub">
            {data.attachments?.length || 0} adjunto
            {(data.attachments?.length || 0) === 1 ? "" : "s"}
          </span>
        }
      />
      <CardBody>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "70px 1fr",
            gap: "4px 12px",
            fontSize: 12.5,
            marginBottom: 14,
          }}
        >
          {subject && (
            <>
              <span className="muted">Asunto</span>
              <span style={{ fontWeight: 600 }}>{subject}</span>
            </>
          )}
          {from && (
            <>
              <span className="muted">De</span>
              <span className="mono" style={{ fontSize: 11.5 }}>
                {sanitizeText(from)}
              </span>
            </>
          )}
          {to && (
            <>
              <span className="muted">Para</span>
              <span className="mono" style={{ fontSize: 11.5 }}>
                {sanitizeText(to)}
              </span>
            </>
          )}
          {cc && (
            <>
              <span className="muted">CC</span>
              <span className="mono" style={{ fontSize: 11.5 }}>
                {sanitizeText(cc)}
              </span>
            </>
          )}
        </div>

        {segments.length > 0 ? (
          <div
            style={{
              background: "var(--bg-2)",
              padding: 14,
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              maxHeight: 460,
              overflowY: "auto",
            }}
          >
            {segments.map((s, i) => (
              <div
                key={i}
                style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < segments.length - 1 ? "1px solid var(--border-1)" : "none" }}
              >
                <div
                  className="muted"
                  style={{ fontSize: 10.5, marginBottom: 4 }}
                >
                  {s.participant === "AGENT"
                    ? "Agente"
                    : s.participant === "CUSTOMER"
                    ? "Cliente"
                    : "Sistema"}
                  {s.timestamp &&
                    ` · ${new Date(s.timestamp).toLocaleString("es-PE")}`}
                </div>
                <div>{sanitizeText(s.content || "")}</div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="muted"
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 12,
              background: "var(--bg-2)",
              borderRadius: 8,
            }}
          >
            El contenido del email no está disponible en el transcript. Los
            adjuntos sí — los puedes descargar abajo.
          </div>
        )}

        {(data.attachments?.length || 0) > 0 && (
          <div style={{ marginTop: 14 }}>
            <div
              className="muted"
              style={{
                fontSize: 10.5,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Adjuntos
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {(data.attachments || []).map((a) => (
                <li
                  key={a.fileId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "var(--bg-2)",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 12 }}>
                    📎 {a.fileName || a.fileId}
                  </span>
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn--sm btn--ghost"
                    >
                      Descargar
                    </a>
                  ) : (
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      {a.fileStatus || "sin URL"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function WrapUpCard({ wrapUp }: { wrapUp: ContactWrapUp }) {
  // Resolve valoración label/chip class via the same disposition meta
  // the WrapUpView uses, so /recordings shows the exact same chip the
  // agent picked at the end of the contact.
  const valMeta =
    wrapUp.valoracion && (wrapUp.valoracion as keyof typeof VALORACION_META) in VALORACION_META
      ? VALORACION_META[wrapUp.valoracion as keyof typeof VALORACION_META]
      : null;
  const updatedRel = (() => {
    if (!wrapUp.updatedAt) return "";
    try {
      return formatDistanceToNow(new Date(wrapUp.updatedAt), {
        addSuffix: true,
        locale: es,
      });
    } catch {
      return "";
    }
  })();
  const followUpEntries = Object.entries(wrapUp.followUps || {}).filter(
    ([, v]) => v === true
  );
  return (
    <Card>
      <CardHead
        title="📝 Cierre por el agente"
        right={
          <span className="card__sub">
            {wrapUp.agentUsername}
            {updatedRel ? ` · ${updatedRel}` : ""}
          </span>
        }
      />
      <CardBody>
        {(wrapUp.stageLabel || wrapUp.subStageLabel) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            {wrapUp.stageLabel && (
              <span className="chip" style={{ fontSize: 11.5 }}>
                {wrapUp.stageLabel}
              </span>
            )}
            {wrapUp.subStageLabel && (
              <>
                <span className="muted" style={{ fontSize: 12 }}>
                  →
                </span>
                <span
                  className="chip"
                  style={{ fontSize: 11.5, background: "var(--bg-2)" }}
                >
                  {wrapUp.subStageLabel}
                </span>
              </>
            )}
            {valMeta && (
              <span
                className={`chip ${valMeta.chip}`}
                style={{ fontSize: 11 }}
              >
                <span className="dot" /> {valMeta.label}
              </span>
            )}
          </div>
        )}

        {wrapUp.notes && (
          <div
            style={{
              background: "var(--bg-2)",
              padding: 12,
              borderRadius: 6,
              marginBottom: 10,
              fontSize: 12.5,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}
          >
            {sanitizeText(wrapUp.notes)}
          </div>
        )}

        {wrapUp.tags.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
              marginBottom: followUpEntries.length > 0 ? 10 : 0,
            }}
          >
            <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>
              Tags:
            </span>
            {wrapUp.tags.map((t) => (
              <span
                key={t}
                className="chip chip--cyan"
                style={{ fontSize: 11 }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {followUpEntries.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>
              Follow-ups:
            </span>
            {followUpEntries.map(([k]) => (
              <span
                key={k}
                className="chip chip--violet"
                style={{ fontSize: 11 }}
                title={
                  k === "task24h" && wrapUp.followUpTaskIds.length > 0
                    ? `Tarea creada (${wrapUp.followUpTaskIds[0].slice(0, 8)})`
                    : k
                }
              >
                {k === "task24h"
                  ? "✓ Tarea 24h"
                  : k === "emailConfirm"
                  ? "✉ Email confirmación"
                  : k === "nps"
                  ? "📊 NPS"
                  : k}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AttributesCard({
  attributes,
}: {
  attributes?: Record<string, string>;
}) {
  if (!attributes) return null;
  const entries = Object.entries(attributes).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim()
  );
  if (entries.length === 0) return null;
  // Group UDEP and campaign attrs first
  entries.sort(([a], [b]) => {
    const pri = (k: string) =>
      k.startsWith("udep_") ? 0 : k.startsWith("campaign") ? 1 : 2;
    return pri(a) - pri(b);
  });
  return (
    <Card>
      <CardHead title="Atributos del contacto" />
      <CardBody>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            gap: "4px 12px",
            fontSize: 11.5,
          }}
        >
          {entries.map(([k, v]) => (
            <span key={k} style={{ display: "contents" }}>
              <span className="muted mono" style={{ fontSize: 11 }}>
                {k}
              </span>
              <span style={{ wordBreak: "break-word" }}>
                {sanitizeText(String(v))}
              </span>
            </span>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
