import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getApiEndpoints } from "@/lib/api";

interface AICoachPanelProps {
  contactId: string | null;
  transcriptSegmentCount: number;
  isActive: boolean;
  sentiment?: string;
}

interface CoachAction {
  action: string;
  reason: string;
}

export function AICoachPanel({
  contactId,
  transcriptSegmentCount,
  isActive,
  sentiment,
}: AICoachPanelProps) {
  const [suggestions, setSuggestions] = useState<CoachAction[]>([]);
  const [loading, setLoading] = useState(false);
  const lastSegmentCount = useRef(0);

  const fetchSuggestions = async () => {
    if (!contactId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) return;

    setLoading(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "next-action" }),
      });
      const data = await r.json();
      try {
        const parsed = JSON.parse(data.result);
        if (Array.isArray(parsed)) {
          setSuggestions(parsed);
        }
      } catch {
        setSuggestions([
          { action: data.result || "No suggestions yet", reason: "" },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-trigger when conversation advances significantly (every 5 new segments)
  useEffect(() => {
    if (!isActive || !contactId) return;
    if (transcriptSegmentCount - lastSegmentCount.current >= 5) {
      lastSegmentCount.current = transcriptSegmentCount;
      fetchSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptSegmentCount, isActive, contactId]);

  if (!isActive) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-purple-500" />
            AI Coach
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Real-time AI suggestions will appear during active calls.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-purple-400/20 to-pink-400/20 blur-2xl" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            AI Coach
            {sentiment === "NEGATIVE" && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                <Zap className="h-2.5 w-2.5" />
                Urgent
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSuggestions}
            disabled={loading}
            className="h-7 text-xs"
          >
            <RefreshCw
              className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Thinking..." : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-2">
        <AnimatePresence mode="popLayout">
          {suggestions.length === 0 && !loading && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-muted-foreground py-2"
            >
              Coach will auto-suggest actions as the conversation develops...
            </motion.p>
          )}
          {suggestions.slice(0, 3).map((s, i) => (
            <motion.div
              key={s.action + i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ delay: i * 0.1 }}
              className="group flex gap-2 rounded-lg border border-purple-200/50 bg-gradient-to-br from-purple-50/50 to-pink-50/50 p-3 dark:border-purple-900/30 dark:from-purple-950/20 dark:to-pink-950/20"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-600 text-white text-xs font-bold">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{s.action}</p>
                {s.reason && (
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {s.reason}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
