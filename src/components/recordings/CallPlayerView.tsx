import { useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Phone,
  Clock,
  Disc3,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import { useContactDetail, type ContactTranscriptSegment } from "@/hooks/useContactDetail";
import { useCallHistory, type CallHistoryRow as CallRow } from "@/hooks/useCallHistory";
import { Sparkline } from "@/components/recordings/Sparkline";
import { keyMoments, type KeyMoment } from "@/components/recordings/WaveformTimeline";
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
export interface ActiveCall {
  contactId: string;
  segments: ContactTranscriptSegment[];
  sentiment: { positive: number; negative: number; neutral: number; mixed: number };
  moments: KeyMoment[];
}

function ymdLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Dirección de la llamada a partir del initiationMethod de Connect. */
function dirOf(method?: string): "in" | "out" {
  const k = (method || "").toUpperCase();
  return k === "OUTBOUND" || k === "API" || k === "CALLBACK" ? "out" : "in";
}
const isMissed = (r: CallRow) => (r.duration || 0) === 0;
/** El agentUsername a veces viene como un id/GUID sin resolver (colas/IVR sin
 *  agente humano) — no lo mostramos crudo, caemos a la cola. */
const looksUuid = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s);
const realAgentOf = (r: CallRow) =>
  r.agentUsername && !looksUuid(r.agentUsername) ? r.agentUsername : "";
/** queueName a veces también llega como ARN/GUID sin resolver — no lo mostramos crudo. */
const realQueueOf = (r: CallRow) => (r.queueName && !looksUuid(r.queueName) ? r.queueName : "");
const WD = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

export function CallPlayerView({
  phone,
  onActiveCall,
}: {
  phone: string | null;
  onActiveCall?: (c: ActiveCall | null) => void;
}) {
  const { rows, loading, error } = useCallHistory(phone);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [dir, setDir] = useState<"all" | "in" | "out" | "missed">("all");
  const [agent, setAgent] = useState<string>("all");

  // Reinicia la selección/filtros al cambiar de cliente (el fetch lo hace el hook).
  useEffect(() => {
    setSelectedId(null);
    setSelectedDay(null);
    setMonth(null);
    setDir("all");
    setAgent("all");
  }, [phone]);

  const callRows = useMemo(
    () =>
      rows.filter((c) => {
        const ch = (c.channel || "").toUpperCase();
        return ch === "VOICE" || ch === "TELEPHONY";
      }),
    [rows],
  );
  const agents = useMemo(() => {
    const s = new Set<string>();
    callRows.forEach((c) => {
      if (c.agentUsername) s.add(c.agentUsername);
    });
    return [...s].sort();
  }, [callRows]);
  const filtered = useMemo(
    () =>
      callRows.filter((r) => {
        if (agent !== "all" && r.agentUsername !== agent) return false;
        if (dir === "in" && dirOf(r.initiationMethod) !== "in") return false;
        if (dir === "out" && dirOf(r.initiationMethod) !== "out") return false;
        if (dir === "missed" && !isMissed(r)) return false;
        return true;
      }),
    [callRows, dir, agent],
  );
  const countsByDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of filtered) {
      const d = ymdLocal(r.initiationTimestamp);
      if (d) m[d] = (m[d] || 0) + 1;
    }
    return m;
  }, [filtered]);
  // Tendencias por semana (últimas 12) para los sparklines de las métricas.
  const trends = useMemo(() => {
    const WEEKS = 12;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const calls = new Array(WEEKS).fill(0),
      missed = new Array(WEEKS).fill(0);
    const durSum = new Array(WEEKS).fill(0),
      durCnt = new Array(WEEKS).fill(0);
    for (const r of filtered) {
      const t = Date.parse(r.initiationTimestamp);
      if (Number.isNaN(t)) continue;
      const wa = Math.floor((today.getTime() - t) / (7 * 86400000));
      if (wa < 0 || wa >= WEEKS) continue;
      const i = WEEKS - 1 - wa;
      calls[i]++;
      if ((r.duration || 0) === 0) missed[i]++;
      else {
        durSum[i] += r.duration;
        durCnt[i]++;
      }
    }
    return {
      calls,
      missed,
      answeredPct: calls.map((c, i) => (c ? Math.round(((c - missed[i]) / c) * 100) : 0)),
      avgDur: durSum.map((s, i) => (durCnt[i] ? Math.round(s / durCnt[i]) : 0)),
    };
  }, [filtered]);

  // Inicializa mes + día + selección desde la llamada más reciente (el backend
  // ordena de más nuevo a más viejo). Solo corre una vez por contacto.
  useEffect(() => {
    if (callRows.length === 0 || month) return;
    const recent = callRows[0];
    const d = new Date(recent.initiationTimestamp);
    if (!Number.isNaN(d.getTime())) {
      setMonth({ y: d.getFullYear(), m: d.getMonth() });
      setSelectedDay(ymdLocal(recent.initiationTimestamp));
    }
    setSelectedId(recent.contactId);
  }, [callRows, month]);

  const dayRows = useMemo(() => {
    if (!selectedDay) return [];
    return filtered
      .filter((r) => ymdLocal(r.initiationTimestamp) === selectedDay)
      .sort(
        (a, b) =>
          (Date.parse(a.initiationTimestamp) || 0) - (Date.parse(b.initiationTimestamp) || 0),
      );
  }, [filtered, selectedDay]);

  const pickDay = (ymd: string) => {
    setSelectedDay(ymd);
    const first = filtered
      .filter((r) => ymdLocal(r.initiationTimestamp) === ymd)
      .sort(
        (a, b) =>
          (Date.parse(a.initiationTimestamp) || 0) - (Date.parse(b.initiationTimestamp) || 0),
      )[0];
    if (first) setSelectedId(first.contactId);
  };

  if (!phone) return <div className="cpv__msg">Selecciona un cliente para ver sus llamadas.</div>;
  if (loading) return <div className="cpv__msg">Cargando llamadas…</div>;
  if (error) return <div className="cpv__msg cpv__msg--err">{error}</div>;
  if (callRows.length === 0)
    return <div className="cpv__msg">Este cliente no tiene llamadas registradas.</div>;

  const total = filtered.length;
  const missed = filtered.filter(isMissed).length;
  const answeredPct = total ? Math.round(((total - missed) / total) * 100) : 0;
  const durs = filtered.filter((r) => (r.duration || 0) > 0).map((r) => r.duration);
  const avg = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  const selected =
    filtered.find((c) => c.contactId === selectedId) ||
    callRows.find((c) => c.contactId === selectedId) ||
    null;

  return (
    <div className="cpv2">
      <div className="cpv2__stats">
        <div className="cpv2__stat">
          <div className="cpv2__stat-l">Llamadas</div>
          <div className="cpv2__stat-v">{total}</div>
          <div className="cpv2__stat-spark">
            <Sparkline data={trends.calls} color="var(--accent-cyan)" />
          </div>
        </div>
        <div className="cpv2__stat">
          <div className="cpv2__stat-l">Contestadas</div>
          <div className="cpv2__stat-v">{answeredPct}%</div>
          <div className="cpv2__stat-spark">
            <Sparkline data={trends.answeredPct} color="var(--accent-green)" />
          </div>
        </div>
        <div className="cpv2__stat">
          <div className="cpv2__stat-l">Duración prom</div>
          <div className="cpv2__stat-v">{formatDurationSec(avg)}</div>
          <div className="cpv2__stat-spark">
            <Sparkline data={trends.avgDur} color="var(--accent-violet)" />
          </div>
        </div>
        <div className="cpv2__stat">
          <div className="cpv2__stat-l">Perdidas</div>
          <div className="cpv2__stat-v">{missed}</div>
          <div className="cpv2__stat-spark">
            <Sparkline data={trends.missed} color="var(--accent-red)" />
          </div>
        </div>
      </div>
      <div className="cpv2__body">
        <aside className="cpv2__left">
          <div className="cpv2__filters">
            {(
              [
                ["all", "Todas"],
                ["in", "Entrantes"],
                ["out", "Salientes"],
                ["missed", "Perdidas"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                className={`rec-list__chip ${dir === k ? "rec-list__chip--on" : ""}`}
                onClick={() => setDir(k)}
              >
                {l}
              </button>
            ))}
            {agents.length > 1 && (
              <select
                className="cpv2__agent"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                aria-label="Filtrar por agente"
              >
                <option value="all">Todos</option>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            )}
          </div>
          {month && (
            <Calendar
              y={month.y}
              m={month.m}
              counts={countsByDay}
              selectedDay={selectedDay}
              onPick={pickDay}
              onPrev={() =>
                setMonth((c) =>
                  c ? (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }) : c,
                )
              }
              onNext={() =>
                setMonth((c) =>
                  c ? (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }) : c,
                )
              }
            />
          )}
          <div className="cpv2__daylist">
            <div className="cpv2__day-h">
              {selectedDay
                ? format(new Date(selectedDay + "T00:00:00"), "EEEE d 'de' MMMM", { locale: es })
                : "—"}{" "}
              · {dayRows.length} llamada{dayRows.length === 1 ? "" : "s"}
            </div>
            {dayRows.length === 0 ? (
              <div className="cpv2__day-empty">Sin llamadas ese día.</div>
            ) : (
              dayRows.map((c) => {
                const miss = isMissed(c);
                const d = new Date(c.initiationTimestamp);
                const on = c.contactId === selectedId;
                const D = dirOf(c.initiationMethod);
                const ag = realAgentOf(c);
                return (
                  <button
                    key={c.contactId}
                    className={`cpv2__call ${on ? "cpv2__call--on" : ""}`}
                    onClick={() => setSelectedId(c.contactId)}
                  >
                    <span className="cpv2__call-time">
                      {Number.isNaN(d.getTime()) ? "—" : format(d, "HH:mm")}
                    </span>
                    <span className="cpv2__call-dir">
                      {miss ? (
                        <PhoneMissed size={14} />
                      ) : D === "in" ? (
                        <PhoneIncoming size={14} />
                      ) : (
                        <PhoneOutgoing size={14} />
                      )}
                    </span>
                    <span className="cpv2__call-body">
                      <span className="cpv2__call-agent">
                        {ag || realQueueOf(c) || "Sin agente"}
                      </span>
                      <span className="cpv2__call-sub">
                        {miss
                          ? "sin atender"
                          : `${formatDurationSec(c.duration)}${ag && realQueueOf(c) ? ` · ${realQueueOf(c)}` : ""}`}
                      </span>
                    </span>
                    {c.hasRecording && !miss && <Disc3 size={12} className="cpv2__call-rec" />}
                    <span className={`cpv2__call-pill ${miss ? "cpv2__call-pill--miss" : ""}`}>
                      {miss ? "Perdida" : "Contestada"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
        <main className="cpv2__right">
          {selected ? (
            <CallPlayer key={selected.contactId} row={selected} onActiveCall={onActiveCall} />
          ) : (
            <div className="cpv__msg" style={{ margin: "auto" }}>
              Elegí una llamada del día para reproducirla.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Calendar({
  y,
  m,
  counts,
  selectedDay,
  onPick,
  onPrev,
  onNext,
}: {
  y: number;
  m: number;
  counts: Record<string, number>;
  selectedDay: string | null;
  onPick: (ymd: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const first = new Date(y, m, 1);
  const firstWd = (first.getDay() + 6) % 7; // semana arranca el lunes
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return (
    <div className="mcal">
      <div className="mcal__head">
        <button onClick={onPrev} aria-label="Mes anterior">
          <ChevronLeft size={15} />
        </button>
        <span className="mcal__month">{format(first, "MMMM yyyy", { locale: es })}</span>
        <button onClick={onNext} aria-label="Mes siguiente">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="mcal__wd">
        {WD.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mcal__grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} className="mcal__cell mcal__cell--empty" />;
          const ymd = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const c = counts[ymd] || 0;
          return (
            <button
              key={ymd}
              className={`mcal__cell ${ymd === selectedDay ? "mcal__cell--sel" : ""} ${c ? "mcal__cell--has" : ""}`}
              onClick={() => onPick(ymd)}
            >
              <span>{d}</span>
              {c > 0 && <span className="mcal__cnt">{c}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CallPlayer({
  row,
  onActiveCall,
}: {
  row: CallRow;
  onActiveCall?: (c: ActiveCall | null) => void;
}) {
  const { detail, loading } = useContactDetail(row.contactId);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const audioRef = useRef<AudioPlayerHandle>(null);

  const transcript: TranscriptSegment[] = useMemo(() => {
    const segs = (detail?.transcript?.segments || []) as Array<{
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
    }>;
    return segs.map((s) => ({
      participant: (s.participant ||
        s.ParticipantRole ||
        "UNKNOWN") as TranscriptSegment["participant"],
      content: s.content || s.Content || "",
      beginOffsetMillis: s.beginOffsetMs ?? s.beginOffsetMillis ?? s.BeginOffsetMillis ?? 0,
      endOffsetMillis: s.endOffsetMs ?? s.endOffsetMillis ?? s.EndOffsetMillis ?? 0,
      sentiment: s.sentiment || s.Sentiment,
    }));
  }, [detail]);

  const wrap = detail?.wrapUp;
  const valMeta =
    wrap?.valoracion && (wrap.valoracion as keyof typeof VALORACION_META) in VALORACION_META
      ? VALORACION_META[wrap.valoracion as keyof typeof VALORACION_META]
      : null;
  const dt = row.initiationTimestamp ? new Date(row.initiationTimestamp) : null;

  // Sentimiento general de la llamada, derivado de los segmentos de Contact Lens
  // (real, sin fetch extra). null = todo neutral / sin transcripción → sin badge.
  const callSentiment = useMemo(() => {
    let pos = 0,
      neg = 0,
      mix = 0;
    for (const s of transcript) {
      const k = (s.sentiment || "").toUpperCase();
      if (k === "POSITIVE") pos++;
      else if (k === "NEGATIVE") neg++;
      else if (k === "MIXED") mix++;
    }
    if (pos + neg + mix === 0) return null;
    if (mix > 0 || (pos > 0 && neg > 0)) return { label: "mixto", color: "var(--accent-amber)" };
    if (neg >= pos) return { label: "negativo", color: "var(--accent-red)" };
    return { label: "positivo", color: "var(--accent-green)" };
  }, [transcript]);

  // Reporta la llamada activa hacia arriba (para los insights del panel derecho).
  useEffect(() => {
    if (!onActiveCall || !detail) return;
    const rawSegments = (detail.transcript?.segments || []) as ContactTranscriptSegment[];
    const sentiment = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    for (const s of transcript) {
      const k = (s.sentiment || "").toUpperCase();
      if (k === "POSITIVE") sentiment.positive++;
      else if (k === "NEGATIVE") sentiment.negative++;
      else if (k === "MIXED") sentiment.mixed++;
      else sentiment.neutral++;
    }
    onActiveCall({
      contactId: row.contactId,
      segments: rawSegments,
      sentiment,
      moments: keyMoments(transcript),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, row.contactId]);

  return (
    <div className="cpv__main">
      <div className="cpv__meta">
        <span className="cpv__meta-av">
          <Phone size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="cpv__meta-name"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {realAgentOf(row) || realQueueOf(row) || "Llamada"}
            {realAgentOf(row) && realQueueOf(row) ? (
              <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                {" "}
                · {realQueueOf(row)}
              </span>
            ) : null}
            {callSentiment && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 99,
                  textTransform: "capitalize",
                  background: `color-mix(in srgb, ${callSentiment.color} 16%, transparent)`,
                  color: callSentiment.color,
                }}
              >
                {callSentiment.label}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
            {dt ? format(dt, "EEEE d 'de' MMMM yyyy · HH:mm", { locale: es }) : ""}{" "}
            {dt ? `· ${formatDistanceToNow(dt, { addSuffix: true, locale: es })}` : ""}
          </div>
        </div>
        <span
          className="chip"
          style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <Clock size={11} /> {formatDurationSec(row.duration)}
        </span>
        {valMeta && (
          <span className={`chip ${valMeta.chip}`} style={{ fontSize: 10.5 }}>
            <span className="dot" /> {valMeta.label}
          </span>
        )}
        {wrap?.stageLabel && (
          <span className="chip" style={{ fontSize: 10.5 }}>
            {wrap.stageLabel}
          </span>
        )}
      </div>

      {loading && (
        <div className="cpv__msg" style={{ padding: 18 }}>
          Cargando audio + transcripción…
        </div>
      )}
      {detail && (
        <>
          {detail.recording?.url ? (
            <AudioPlayer
              ref={audioRef}
              src={detail.recording.url}
              onTimeUpdate={setCurrentTimeMs}
              segments={transcript}
              durationSecHint={detail.duration ?? row.duration}
            />
          ) : (
            <div className="cpv__noaudio">No hay grabación de audio para esta llamada.</div>
          )}
          {transcript.length > 0 ? (
            <div className="cpv__transcript">
              <TranscriptViewer
                segments={transcript}
                currentTimeMs={currentTimeMs}
                onSeek={(ms) => audioRef.current?.seekTo(ms)}
              />
            </div>
          ) : (
            <div className="cpv__msg" style={{ padding: 18 }}>
              Sin transcripción Contact Lens para esta llamada.
            </div>
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
