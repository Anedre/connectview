import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, AlertTriangle } from "lucide-react";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";

interface LiveTranscriptPanelProps {
  contactId: string | null;
  isActive: boolean;
}

const SENTIMENT_BORDER: Record<string, string> = {
  POSITIVE: "border-l-green-500",
  NEGATIVE: "border-l-red-500",
  NEUTRAL: "border-l-gray-300",
  MIXED: "border-l-yellow-500",
};

const SENTIMENT_OVERALL: Record<string, { bg: string; emoji: string }> = {
  POSITIVE: { bg: "bg-green-100 text-green-800", emoji: "😊" },
  NEGATIVE: { bg: "bg-red-100 text-red-800", emoji: "😠" },
  NEUTRAL: { bg: "bg-gray-100 text-gray-800", emoji: "😐" },
};

// Render the segment's absolute clock time in Lima (Peru) timezone when we know when the call started.
// Falls back to the relative offset (m:ss) if the backend hasn't sent the start timestamp yet.
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

  // Auto-scroll to latest segment
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.segments.length]);

  if (!isActive) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5" />
            Live Transcript
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Real-time transcription will appear when a call is active.
          </p>
        </CardContent>
      </Card>
    );
  }

  const overall = data?.overallSentiment || "NEUTRAL";
  const sentimentStyle = SENTIMENT_OVERALL[overall];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-red-500 animate-pulse" />
            Live Transcript
          </CardTitle>
          <div className="flex items-center gap-2">
            {data && (
              <Badge className={sentimentStyle.bg}>
                {sentimentStyle.emoji} {overall}
              </Badge>
            )}
            {data && (
              <Badge variant="outline" className="text-xs">
                {data.totalSegments} segments
              </Badge>
            )}
          </div>
        </div>

        {/* Categories detected */}
        {data && data.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            <span className="text-xs text-muted-foreground">Categories:</span>
            {data.categories.map((cat) => (
              <Badge key={cat} variant="secondary" className="text-xs">
                {cat}
              </Badge>
            ))}
          </div>
        )}

        {/* Coaching alert for negative sentiment */}
        {overall === "NEGATIVE" && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-yellow-50 p-2 text-xs text-yellow-800">
            <AlertTriangle className="h-3 w-3" />
            <span>
              Customer sentiment is negative. Use empathetic language and focus
              on resolution.
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="space-y-2 max-h-[400px] overflow-y-auto pr-2"
        >
          {error && (
            <p className="text-sm text-red-600">Error: {error}</p>
          )}
          {!data?.segments.length && !loading && !error && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Waiting for conversation to start...
            </p>
          )}
          {data?.segments.map((seg, i) => {
            const isAgent = seg.participant === "AGENT";
            return (
              <div
                key={i}
                className={`flex gap-2 rounded-md border-l-4 bg-card p-2 ${
                  SENTIMENT_BORDER[seg.sentiment || "NEUTRAL"]
                }`}
              >
                <div className="shrink-0 w-20">
                  <Badge
                    variant={isAgent ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {isAgent ? "Agent" : "Customer"}
                  </Badge>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {formatTime(seg.beginOffsetMs, data?.transcriptStartTimestamp)}
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-sm">{seg.content}</p>
                  {seg.issueText && (
                    <div className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Issue: {seg.issueText}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
