import { useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Phone, Clock, Disc3 } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import { useContactDetail } from "@/hooks/useContactDetail";
import { VALORACION_META } from "@/lib/dispositions";
import { formatDurationSec, sanitizeText } from "@/lib/utils";
import type { TranscriptSegment } from "@/types/recordings";

/**
 * CallPlayerView — la vista de "Llamadas" rediseñada con el REPRODUCTOR como
 * protagonista (#grabaciones fase3): una tira selectora de llamadas arriba y,
 * abajo, la llamada elegida a pantalla completa — onda coloreada por sentiment
 * + transporte (AudioPlayer) y transcripción sincronizada (TranscriptViewer).
 * Reemplaza la lista de tarjetas expandibles de CallLogView dentro del workspace.
 */
interface CallRow {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  disconnectReason?: string;
  hasRecording: boolean;
}
interface HistoryResponse { totalContacts: number; contacts: CallRow[] }

export function CallPlayerView({ phone }: { phone: string | null }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setError(null); setSelectedId(null);
    if (!phone) return;
    const url = getApiEndpoints()?.getContactHistory;
    if (!url) { setError("Endpoint no configurado"); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${url}?phone=${encodeURIComponent(phone)}&limit=200`, { signal: ctrl.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => { if (!ok) throw new Error(j.message || `HTTP ${status}`); setData(j as HistoryResponse); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Error"); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [phone]);

  const callRows = useMemo(
    () => (data?.contacts || []).filter((c) => { const ch = (c.channel || "").toUpperCase(); return ch === "VOICE" || ch === "TELEPHONY"; }),
    [data]
  );
  // Auto-selecciona la más reciente cuando llegan las llamadas.
  useEffect(() => {
    if (callRows.length > 0 && !callRows.some((c) => c.contactId === selectedId)) setSelectedId(callRows[0].contactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callRows]);

  if (!phone) return <div className="cpv__msg">Selecciona un cliente para ver sus llamadas.</div>;
  if (loading) return <div className="cpv__msg">Cargando llamadas…</div>;
  if (error) return <div className="cpv__msg cpv__msg--err">{error}</div>;
  if (callRows.length === 0) return <div className="cpv__msg">Este cliente no tiene llamadas registradas.</div>;

  const selected = callRows.find((c) => c.contactId === selectedId) || callRows[0];

  return (
    <div className="cpv">
      <div className="cpv__strip">
        {callRows.map((c) => {
          const dt = c.initiationTimestamp ? new Date(c.initiationTimestamp) : null;
          const on = c.contactId === selected.contactId;
          return (
            <button key={c.contactId} className={`cpv__pill ${on ? "cpv__pill--on" : ""}`} onClick={() => setSelectedId(c.contactId)}>
              <span className="cpv__pill-top">
                {c.hasRecording && <Disc3 size={11} />}
                {dt ? format(dt, "d MMM · HH:mm", { locale: es }) : "—"}
              </span>
              <span className="cpv__pill-sub">{formatDurationSec(c.duration)} · {c.agentUsername || "—"}</span>
            </button>
          );
        })}
      </div>
      <CallPlayer key={selected.contactId} row={selected} />
    </div>
  );
}

function CallPlayer({ row }: { row: CallRow }) {
  const { detail, loading } = useContactDetail(row.contactId);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const audioRef = useRef<AudioPlayerHandle>(null);

  const transcript: TranscriptSegment[] = useMemo(() => {
    const segs = (detail?.transcript?.segments || []) as Array<{
      participant?: string; ParticipantRole?: string;
      content?: string; Content?: string;
      beginOffsetMs?: number; beginOffsetMillis?: number; BeginOffsetMillis?: number;
      endOffsetMs?: number; endOffsetMillis?: number; EndOffsetMillis?: number;
      sentiment?: string; Sentiment?: string;
    }>;
    return segs.map((s) => ({
      participant: (s.participant || s.ParticipantRole || "UNKNOWN") as TranscriptSegment["participant"],
      content: s.content || s.Content || "",
      beginOffsetMillis: s.beginOffsetMs ?? s.beginOffsetMillis ?? s.BeginOffsetMillis ?? 0,
      endOffsetMillis: s.endOffsetMs ?? s.endOffsetMillis ?? s.EndOffsetMillis ?? 0,
      sentiment: s.sentiment || s.Sentiment,
    }));
  }, [detail]);

  const wrap = detail?.wrapUp;
  const valMeta = wrap?.valoracion && (wrap.valoracion as keyof typeof VALORACION_META) in VALORACION_META
    ? VALORACION_META[wrap.valoracion as keyof typeof VALORACION_META] : null;
  const dt = row.initiationTimestamp ? new Date(row.initiationTimestamp) : null;

  return (
    <div className="cpv__main">
      <div className="cpv__meta">
        <span className="cpv__meta-av"><Phone size={15} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cpv__meta-name">{row.agentUsername || "Agente desconocido"} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· {row.queueName || "—"}</span></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{dt ? format(dt, "EEEE d 'de' MMMM yyyy · HH:mm", { locale: es }) : ""} {dt ? `· ${formatDistanceToNow(dt, { addSuffix: true, locale: es })}` : ""}</div>
        </div>
        <span className="chip" style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={11} /> {formatDurationSec(row.duration)}</span>
        {valMeta && <span className={`chip ${valMeta.chip}`} style={{ fontSize: 10.5 }}><span className="dot" /> {valMeta.label}</span>}
        {wrap?.stageLabel && <span className="chip" style={{ fontSize: 10.5 }}>{wrap.stageLabel}</span>}
      </div>

      {loading && <div className="cpv__msg" style={{ padding: 18 }}>Cargando audio + transcripción…</div>}
      {detail && (
        <>
          {detail.recording?.url ? (
            <AudioPlayer ref={audioRef} src={detail.recording.url} onTimeUpdate={setCurrentTimeMs} segments={transcript} durationSecHint={detail.duration ?? row.duration} />
          ) : (
            <div className="cpv__noaudio">No hay grabación de audio para esta llamada.</div>
          )}
          {transcript.length > 0 ? (
            <div className="cpv__transcript">
              <TranscriptViewer segments={transcript} currentTimeMs={currentTimeMs} onSeek={(ms) => audioRef.current?.seekTo(ms)} />
            </div>
          ) : (
            <div className="cpv__msg" style={{ padding: 18 }}>Sin transcripción Contact Lens para esta llamada.</div>
          )}
          {wrap?.notes && (
            <div className="cpv__notes">
              <div className="cpv__notes-h">Notas del agente</div>
              {sanitizeText(wrap.notes)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
