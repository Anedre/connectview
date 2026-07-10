import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, RotateCcw, Search, LayoutGrid } from "lucide-react";
import { useEscapeKey } from "@/hooks/useDropdown";
import { getApiEndpoints } from "@/lib/api";
import { useCatalogs } from "@/hooks/useCatalogs";
import { useCan } from "@/hooks/usePermissions";

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
  // R29 — Copilot "desactivable por rol": gate por la capability `use_copilot`.
  // Default abierto (capability minRole "Agents" en el matrix) → comportamiento
  // actual intacto; un admin puede subir el mínimo a Supervisores/Admins.
  if (!useCan("use_copilot")) return null;
  return <CopilotPanelInner />;
}

function CopilotPanelInner() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "catalogos">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ep = getApiEndpoints();
  // Escape cierra el panel (no se cierra al click afuera: perdería el chat).
  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, loading, open]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    if (!ep?.generateCallSummary) {
      setMsgs((m) => [
        ...m,
        { role: "user", text: q },
        { role: "bot", text: "Copilot no está configurado." },
      ]);
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
        { role: "bot", text: d.result || "No pude generar una respuesta. Inténtalo de nuevo." },
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

      {/* Tabs: Asistente (chat IA) / Catálogos (referencia viva, en toda ruta) */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-1)",
          flex: "0 0 auto",
        }}
      >
        {(
          [
            ["chat", "Asistente", Sparkles],
            ["catalogos", "Catálogos", LayoutGrid],
          ] as const
        ).map(([v, label, Ic]) => {
          const on = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 11px",
                borderRadius: 8,
                border: "none",
                background: on ? "var(--bg-2)" : "transparent",
                color: on ? "var(--text-1)" : "var(--text-3)",
                boxShadow: on ? "inset 0 0 0 1px var(--border-1)" : "none",
              }}
            >
              <Ic size={13} /> {label}
            </button>
          );
        })}
      </div>

      {view === "catalogos" && <CatalogLookup />}

      {view === "chat" && (
        <>
          {/* Body */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {msgs.length === 0 && (
              <div style={{ color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.6 }}>
                <p style={{ marginTop: 4 }}>
                  Hola 👋 Soy <strong>ARIA Copilot</strong>. Pregúntame cómo usar la plataforma o
                  pídeme que redacte un mensaje.
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
              <div style={{ alignSelf: "flex-start", color: "var(--text-3)", fontSize: 12 }}>
                pensando…
              </div>
            )}
          </div>

          {/* Input */}
          <div
            style={{ padding: 12, borderTop: "1px solid var(--border-1)", display: "flex", gap: 6 }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(text)}
              placeholder="Pregunta algo…"
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
        </>
      )}
    </div>
  );
}

/** Pestaña "Catálogos" del Copilot — búsqueda viva en todos los catálogos del
 *  tenant (precios, programas, motivos…), agrupada por catálogo. Disponible en
 *  toda ruta porque el Copilot es global. Lee del hook compartido useCatalogs. */
function CatalogLookup() {
  const { catalogs, loading } = useCatalogs();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = catalogs
    .map((c) => ({
      catalog: c,
      rows: c.rows.filter(
        (r) => !query || r.some((cell) => (cell ?? "").toLowerCase().includes(query)),
      ),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-1)",
          flex: "0 0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px",
            borderRadius: 9,
            border: "1px solid var(--border-1)",
            background: "var(--bg-2)",
          }}
        >
          <Search size={14} style={{ color: "var(--text-3)" }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar precio, programa, motivo…"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 12.5,
              color: "var(--text-1)",
            }}
          />
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {loading ? (
          <div style={{ color: "var(--text-3)", fontSize: 12.5 }}>Cargando catálogos…</div>
        ) : catalogs.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.6 }}>
            Todavía no hay catálogos. Créalos en <strong>Configuración → Catálogos</strong>{" "}
            (precios, programas, motivos…) y los buscas aquí durante la llamada.
          </div>
        ) : groups.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 12.5 }}>
            Sin coincidencias para “{q}”.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.catalog.catalogId}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  color: "var(--text-3)",
                  marginBottom: 7,
                }}
              >
                <LayoutGrid size={11} /> {g.catalog.name} · {g.rows.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {g.rows.slice(0, 40).map((r, i) => (
                  <div
                    key={i}
                    style={{
                      borderRadius: 10,
                      border: "1px solid var(--border-1)",
                      background: "var(--bg-2)",
                      padding: "9px 11px",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-1)" }}>
                      {r[0] || "—"}
                    </div>
                    {r.slice(1).some((c) => (c ?? "").trim()) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                        {g.catalog.columns.slice(1).map((col, ci) =>
                          (r[ci + 1] ?? "").trim() ? (
                            <span
                              key={ci}
                              style={{
                                fontSize: 11,
                                color: "var(--text-2)",
                                background: "var(--bg-1)",
                                border: "1px solid var(--border-1)",
                                borderRadius: 7,
                                padding: "2px 8px",
                              }}
                            >
                              <span style={{ color: "var(--text-3)" }}>{col}:</span> {r[ci + 1]}
                            </span>
                          ) : null,
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
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
