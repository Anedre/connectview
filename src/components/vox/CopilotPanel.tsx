import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, RotateCcw } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";

/**
 * CopilotPanel — the global "ARIA Copilot" assistant (Kommo-style floating
 * Copilot). A launcher pill on the right edge opens a slide-in chat that talks
 * to generate-call-summary's `assistant` mode (Bedrock). App-wide: it lives in
 * AppContent next to MonitorControlBar, so it's available on every route.
 * It does NOT duplicate the in-call AI Coach — that stays scoped to a live
 * contact; this is the general "how do I…/draft this…" helper.
 */
interface Msg {
  role: "user" | "bot";
  text: string;
}

const SUGGESTIONS = [
  "¿Cómo creo una campaña de WhatsApp?",
  "Redacta un saludo para un lead nuevo",
  "¿Qué es la tipificación unificada?",
];

export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ep = getApiEndpoints();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, loading, open]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    if (!ep?.generateCallSummary) {
      setMsgs((m) => [...m, { role: "user", text: q }, { role: "bot", text: "Copilot no está configurado." }]);
      return;
    }
    const history = msgs.slice(-6);
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setText("");
    setLoading(true);
    try {
      const r = await fetch(ep.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "assistant", question: q, history }),
      });
      const d = await r.json();
      setMsgs((m) => [
        ...m,
        { role: "bot", text: d.result || "No pude generar una respuesta. Intentá de nuevo." },
      ]);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "Error de conexión con Copilot." }]);
    } finally {
      setLoading(false);
    }
  };

  // Launcher (collapsed)
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="ARIA Copilot"
        style={{
          position: "fixed",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "12px 7px",
          border: "none",
          borderRadius: "12px 0 0 12px",
          background: "linear-gradient(160deg, #9B6DFF, #6E54E0)",
          color: "#fff",
          cursor: "pointer",
          boxShadow: "-4px 0 16px -4px rgba(110,84,224,0.6)",
          writingMode: "vertical-rl",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
        }}
      >
        <Sparkles size={15} style={{ writingMode: "horizontal-tb" }} />
        Copilot
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        top: 72,
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: 14,
        boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "12px 14px",
          background: "linear-gradient(135deg, rgba(155,109,255,0.18), transparent)",
          borderBottom: "1px solid var(--border-1)",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "linear-gradient(150deg, #9B6DFF, #6E54E0)",
            color: "#fff",
          }}
        >
          <Sparkles size={14} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>ARIA Copilot</div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>Asistente de la plataforma</div>
        </div>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} title="Reiniciar" style={iconBtn}>
            <RotateCcw size={13} />
          </button>
        )}
        <button onClick={() => setOpen(false)} title="Cerrar" style={iconBtn}>
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {msgs.length === 0 && (
          <div style={{ color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.6 }}>
            <p style={{ marginTop: 4 }}>
              Hola 👋 Soy <strong>ARIA Copilot</strong>. Preguntame cómo usar la plataforma o pedime que
              redacte un mensaje.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  style={{
                    textAlign: "left",
                    fontSize: 12,
                    padding: "8px 10px",
                    borderRadius: 9,
                    border: "1px solid var(--border-1)",
                    background: "var(--bg-2)",
                    color: "var(--text-1)",
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: "8px 11px",
              borderRadius: 12,
              fontSize: 12.5,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              background: m.role === "user" ? "#6E54E0" : "var(--bg-2)",
              color: m.role === "user" ? "#fff" : "var(--text-1)",
              border: m.role === "user" ? "none" : "1px solid var(--border-1)",
            }}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", color: "var(--text-3)", fontSize: 12 }}>pensando…</div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: "1px solid var(--border-1)", display: "flex", gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(text)}
          placeholder="Preguntá algo…"
          disabled={loading}
          style={{
            flex: 1,
            fontSize: 12.5,
            padding: "8px 10px",
            borderRadius: 9,
            border: "1px solid var(--border-1)",
            background: "var(--bg-2)",
            color: "var(--text-1)",
          }}
        />
        <button
          onClick={() => ask(text)}
          disabled={loading || !text.trim()}
          style={{
            border: "none",
            background: "#6E54E0",
            color: "#fff",
            borderRadius: 9,
            padding: "0 12px",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  border: "1px solid var(--border-1)",
  background: "var(--bg-1)",
  color: "var(--text-2)",
  borderRadius: 7,
  width: 26,
  height: 26,
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
