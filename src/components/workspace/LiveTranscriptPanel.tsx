import { useEffect, useRef, useState } from "react";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { Avatar } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

/**
 * If the contact has been active for this long without producing any
 * transcript segments, we assume Contact Lens analytics is NOT enabled
 * in the contact flow. Real Contact Lens typically produces the first
 * segment within 5-8 seconds of conversation; 20 s is a forgiving
 * threshold that still gives clear feedback before the agent gives up.
 */
const CONTACT_LENS_GRACE_PERIOD_MS = 20_000;

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

  // Track when the contact became active so we can detect "Contact
  // Lens not enabled" — if segments don't arrive within 20s of the
  // call going live, the flow most likely never enabled analytics.
  const [activeSinceTs, setActiveSinceTs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (isActive && contactId) {
      // Reset the timer on every new contact, not just on isActive flips.
      setActiveSinceTs((prev) => (prev === null ? Date.now() : prev));
    } else {
      setActiveSinceTs(null);
    }
  }, [isActive, contactId]);

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const elapsedActiveMs = activeSinceTs ? now - activeSinceTs : 0;
  const totalSegments = data?.totalSegments ?? 0;
  // Heuristic: after 20s of an active call with zero transcripts, we
  // surface "Contact Lens not enabled" to the agent so they know the
  // empty panel is configuration — not a delay.
  const contactLensLikelyDisabled =
    isActive && totalSegments === 0 && elapsedActiveMs > CONTACT_LENS_GRACE_PERIOD_MS;

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

        {!data?.segments.length && !loading && !error && !contactLensLikelyDisabled && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            Esperando que inicie la conversación…
            {activeSinceTs && (
              <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
                {Math.floor(elapsedActiveMs / 1000)}s sin segmentos
              </div>
            )}
          </div>
        )}

        {/* Feature-disabled hint — appears after the grace period when
            the call is active but no segments have arrived. Most
            common cause: flow doesn't enable Contact Lens analytics. */}
        {contactLensLikelyDisabled && (
          <div
            style={{
              padding: "20px 24px",
              borderRadius: 10,
              background:
                "linear-gradient(180deg, var(--accent-amber-soft), transparent 80%)",
              border: "1px solid var(--accent-amber-soft)",
              textAlign: "center",
            }}
          >
            <Icon.Shield
              size={28}
              style={{ color: "var(--accent-amber)", opacity: 0.8 }}
            />
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--text-1)",
                marginTop: 8,
              }}
            >
              Contact Lens no parece habilitado en este flujo
            </div>
            <div
              className="muted"
              style={{
                fontSize: 11.5,
                marginTop: 6,
                lineHeight: 1.55,
                maxWidth: 420,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              No llegan segmentos de transcripción después de{" "}
              {Math.floor(elapsedActiveMs / 1000)} s en la llamada.
              <br />
              Para activarlo agrega un bloque{" "}
              <span className="mono">Set recording &amp; analytics</span> al
              flow de contacto con
              <span className="mono"> AnalyticsBehavior.Enabled = True</span>.
            </div>
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
