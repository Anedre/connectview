import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";

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
          { action: data.result || "Sin sugerencias por ahora", reason: "" },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

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
      <div className="q-card">
        <div className="q-card__head">
          <Icon.Sparkles size={14} /> Amazon Q · Coach
        </div>
        <div className="q-card__body muted">
          Las sugerencias de Q aparecerán durante una llamada activa.
        </div>
      </div>
    );
  }

  return (
    <div className="q-card">
      <div className="q-card__head" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon.Sparkles size={14} /> Amazon Q · Coach
          {sentiment === "NEGATIVE" && (
            <span className="chip chip--red" style={{ height: 18, fontSize: 10 }}>
              <Icon.Shield size={10} /> Urgente
            </span>
          )}
        </div>
        <button
          className="btn btn--ghost btn--sm"
          onClick={fetchSuggestions}
          disabled={loading}
          style={{ marginLeft: "auto" }}
        >
          <Icon.Refresh
            size={12}
            style={loading ? { animation: "spin 1s linear infinite" } : undefined}
          />
          {loading ? "Pensando…" : "Actualizar"}
        </button>
      </div>
      <div className="q-card__body">
        <AnimatePresence mode="popLayout">
          {suggestions.length === 0 && !loading && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="muted"
              style={{ fontSize: 12, margin: 0 }}
            >
              Q sugerirá la próxima mejor acción conforme avance la
              conversación…
            </motion.p>
          )}
          {suggestions.slice(0, 3).map((s, i) => (
            <motion.div
              key={s.action + i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ delay: i * 0.1 }}
              style={{
                display: "flex",
                gap: 10,
                padding: 10,
                background: "var(--bg-2)",
                borderRadius: 8,
                marginTop: i === 0 ? 0 : 6,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  background:
                    "linear-gradient(135deg, var(--accent-violet), var(--accent-pink))",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                  {s.action}
                </div>
                {s.reason && (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    {s.reason}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
