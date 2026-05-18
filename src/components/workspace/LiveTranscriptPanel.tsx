import { useEffect, useRef } from "react";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { Avatar } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

interface LiveTranscriptPanelProps {
  contactId: string | null;
  isActive: boolean;
}

const SENTIMENT_TO_CLASS: Record<string, string> = {
  POSITIVE: "transcript__sent--pos",
  NEGATIVE: "transcript__sent--neg",
  NEUTRAL: "transcript__sent--neu",
  MIXED: "transcript__sent--neu",
};

const SENTIMENT_TO_LABEL: Record<string, string> = {
  POSITIVE: "Positivo",
  NEGATIVE: "Negativo",
  NEUTRAL: "Neutro",
  MIXED: "Mixto",
};

const LIMA_TIME_FMT = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "America/Lima",
});

function formatTime(beginOffsetMs: number, startIso?: string | null): string {
  if (startIso) {
    const startMs = Date.parse(startIso);
    if (!Number.isNaN(startMs)) {
      return LIMA_TIME_FMT.format(new Date(startMs + beginOffsetMs));
    }
  }
  const s = Math.floor(beginOffsetMs / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function LiveTranscriptPanel({
  contactId,
  isActive,
}: LiveTranscriptPanelProps) {
  const { data, loading, error } = useLiveTranscript(
    isActive ? contactId : null
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.segments.length]);

  if (!isActive) {
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
          <Icon.Activity size={28} style={{ opacity: 0.45 }} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            La transcripción aparecerá cuando haya una llamada activa.
          </div>
        </div>
      </div>
    );
  }

  const overall = data?.overallSentiment || "NEUTRAL";
  const overallLabel = SENTIMENT_TO_LABEL[overall] ?? "Neutro";
  const overallChip =
    overall === "POSITIVE"
      ? "chip--green"
      : overall === "NEGATIVE"
      ? "chip--red"
      : "chip--violet";

  return (
    <div ref={scrollRef} style={{ minHeight: 220 }}>
      {/* Header chips */}
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 12, gap: 6 }}>
        <span className={`chip ${overallChip}`}>
          <span className="dot" /> Sentiment {overallLabel}
        </span>
        {data && (
          <span className="chip">
            {data.totalSegments} segmentos
          </span>
        )}
        {data?.categories?.map((cat) => (
          <span key={cat} className="chip chip--cyan">
            {cat}
          </span>
        ))}
      </div>

      {/* Negative coaching nudge */}
      {overall === "NEGATIVE" && (
        <div
          className="q-card"
          style={{
            background: "linear-gradient(180deg, var(--accent-red-soft), transparent 80%)",
            borderColor: "var(--accent-red-soft)",
            marginBottom: 12,
          }}
        >
          <div className="q-card__head" style={{ color: "var(--accent-red)" }}>
            <Icon.Shield size={14} /> Coach · sentiment negativo
          </div>
          <div className="q-card__body">
            El cliente muestra frustración. Usa lenguaje empático y enfócate en
            la resolución.
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="transcript">
        {error && (
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

        {!data?.segments.length && !loading && !error && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            Esperando que inicie la conversación…
          </div>
        )}

        {data?.segments.map((seg, i) => {
          const isAgent = seg.participant === "AGENT";
          const sentCls = SENTIMENT_TO_CLASS[seg.sentiment || "NEUTRAL"];
          const sentLabel = SENTIMENT_TO_LABEL[seg.sentiment || "NEUTRAL"];
          const speakerName = isAgent ? "Agente" : "Cliente";
          const color = isAgent ? "#8B7EE8" : "#22B8D9";

          return (
            <div
              key={i}
              className={`transcript__row transcript__row--${isAgent ? "agent" : "customer"}`}
            >
              <Avatar name={speakerName} color={color} size="sm" />
              <div>
                <div className="transcript__bubble">{seg.content}</div>
                <div className="transcript__meta">
                  <span>{speakerName}</span>
                  <span>
                    {formatTime(seg.beginOffsetMs, data?.transcriptStartTimestamp)}
                  </span>
                  <span className={`transcript__sent ${sentCls}`}>
                    {sentLabel}
                  </span>
                  {seg.issueText && (
                    <span className="chip chip--red" style={{ height: 18, fontSize: 10 }}>
                      <Icon.Shield size={10} /> {seg.issueText}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
