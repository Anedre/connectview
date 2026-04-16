import { Badge } from "@/components/ui/badge";
import type { TranscriptSegment } from "@/types/recordings";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  currentTimeMs?: number;
}

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: "border-l-green-500",
  NEGATIVE: "border-l-red-500",
  NEUTRAL: "border-l-gray-300",
  MIXED: "border-l-yellow-500",
};

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function TranscriptViewer({ segments, currentTimeMs }: TranscriptViewerProps) {
  if (segments.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No transcript available for this contact.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto">
      {segments.map((seg, i) => {
        const isActive =
          currentTimeMs !== undefined &&
          currentTimeMs >= seg.beginOffsetMillis &&
          currentTimeMs <= seg.endOffsetMillis;
        const isAgent = seg.participant === "AGENT";

        return (
          <div
            key={i}
            className={`flex gap-3 rounded-lg border-l-4 p-3 transition-colors ${
              SENTIMENT_COLORS[seg.sentiment || "NEUTRAL"]
            } ${isActive ? "bg-accent" : "bg-card"}`}
          >
            <div className="shrink-0">
              <Badge
                variant={isAgent ? "default" : "secondary"}
                className="text-xs"
              >
                {isAgent ? "Agent" : "Customer"}
              </Badge>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatTime(seg.beginOffsetMillis)}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm">{seg.content}</p>
              {seg.sentiment && seg.sentiment !== "NEUTRAL" && (
                <span className="mt-1 text-xs text-muted-foreground">
                  {seg.sentiment.toLowerCase()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
