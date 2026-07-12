import { Fragment, useEffect, useRef, useState } from "react";
import { Send, X, RotateCcw, Bot as BotIcon, Braces, Wrench, Quote } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { NODE_KINDS, type Bot } from "@/lib/botFlow";

/** Nombres internos de herramientas → etiqueta legible para el panel de inspección. */
const TOOL_LABELS: Record<string, string> = {
  book_appointment: "Agendó una cita",
  upsert_lead: "Creó / actualizó un lead",
  lookup_customer: "Buscó un cliente",
  send_whatsapp_template: "Envió una plantilla",
};

/** Motivo de derivación a humano (Pilar 8 Fase B) → etiqueta legible. */
const HANDOFF_LABELS: Record<string, string> = {
  low_confidence: "Baja confianza",
  tool_budget: "Límite de acciones",
  max_turns: "Máx. de turnos",
  ai_error: "Error de IA",
  agent: "Decisión del agente",
};

/**
 * BotTester — the in-builder "Probar bot" simulator (roadmap #16 runtime),
 * styled as a WhatsApp chat preview so what you build looks like what the
 * customer will see. Chats with the bot-runtime Lambda using the CURRENT
 * in-memory graph (so unsaved flows can be tested). Quick-reply buttons / list
 * rows render as clickable chips; free text for questions / AI-agent turns.
 */
interface MediaRef {
  type: string;
  url: string;
  caption?: string;
}
interface OutMsg {
  kind: "bot" | "note";
  text: string;
  buttons?: { id: string; label: string }[];
  rows?: { id: string; title: string; description?: string }[];
  media?: MediaRef;
}
interface ChatItem {
  from: "bot" | "user" | "note" | "tool";
  text: string;
  buttons?: { id: string; label: string }[];
  rows?: { id: string; title: string; description?: string }[];
  media?: MediaRef;
  /** Fuentes citadas por esta respuesta del agente (Pilar 8 RAG) → chips inline. */
  cites?: { id: string; label: string }[];
}

export function BotTester({
  bot,
  onClose,
  suggestions,
}: {
  bot: Bot;
  onClose: () => void;
  suggestions?: string[];
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [convState, setConvState] = useState<any>(null);
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const ep = getApiEndpoints();

  const call = async (
    input: { text?: string; choice?: string } | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    st: any,
  ) => {
    if (!ep?.botRuntime) {
      setItems((i) => [...i, { from: "note", text: "Runtime no configurado." }]);
      return;
    }
    setLoading(true);
    try {
      // authedFetch → Bearer idToken: el bot-runtime resuelve el tenant del admin
      // logueado (Novasys/default) y así buildKnowledge LEE de verdad catálogos/
      // programas/FAQ. Con fetch anónimo, resolveDynamo cae a blockedDynamoClient
      // y el RAG vuelve vacío (el agente alucina). El playground debe correr con
      // la misma identidad de tenant que producción.
      const r = await authedFetch(ep.botRuntime, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot,
          state: st,
          input,
          source: "playground",
          // Tool endpoints so the agent's function-calling can hit the real Lambdas.
          toolEndpoints: {
            manageAppointment: ep.manageAppointment,
            manageLeads: ep.manageLeads,
            lookupCustomerProfile: ep.lookupCustomerProfile,
            sendWhatsAppTemplate: ep.sendWhatsAppTemplate,
          },
        }),
      });
      const d = await r.json();
      const msgs: OutMsg[] = Array.isArray(d.messages) ? d.messages : [];
      // Herramientas nuevas de ESTA respuesta (diff del acumulado) → badge inline en vivo,
      // antes del texto del bot ("ejecutó la acción, luego respondió").
      const prevN = Array.isArray(st?.toolsUsed) ? st.toolsUsed.length : 0;
      const allTools: string[] = Array.isArray(d.state?.toolsUsed) ? d.state.toolsUsed : [];
      const newTools = allTools.slice(prevN);
      // Fuentes citadas NUEVAS de esta respuesta (diff del acumulado) → chips inline
      // bajo la última burbuja del agente, no escondidas en el cajón "Inspeccionar".
      const prevCiteN = Array.isArray(st?.citations) ? st.citations.length : 0;
      const allCites: { id: string; label: string }[] = Array.isArray(d.state?.citations)
        ? d.state.citations
        : [];
      const newCites = allCites.slice(prevCiteN);
      setItems((i) => {
        const added: ChatItem[] = [
          ...newTools.map((t) => ({ from: "tool" as const, text: TOOL_LABELS[t] || t })),
          ...msgs
            // No dupliques la nota cruda de la tool (p.ej. "book_appointment"): ya la
            // mostramos arriba como badge legible ("Agendó una cita").
            .filter((m) => !(m.kind === "note" && !!TOOL_LABELS[(m.text || "").trim()]))
            .map((m) => ({
              from: (m.kind === "note" ? "note" : "bot") as ChatItem["from"],
              text: m.text,
              buttons: m.buttons,
              rows: m.rows,
              media: m.media,
            })),
        ];
        // Cuelga las citas de la última burbuja del agente de este turno.
        if (newCites.length) {
          for (let k = added.length - 1; k >= 0; k--) {
            if (added[k].from === "bot") {
              added[k] = { ...added[k], cites: newCites };
              break;
            }
          }
        }
        return [...i, ...added];
      });
      setConvState(d.state);
      setAwaiting(d.awaiting ?? null);
      setDone(!!d.done);
    } catch {
      setItems((i) => [...i, { from: "note", text: "Error de conexión con el runtime." }]);
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setItems([]);
    setConvState(null);
    setAwaiting(null);
    setDone(false);
    call(undefined, null);
  };

  // Start on mount (guard against StrictMode's double-invoke in dev).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, loading]);

  const sendQuick = (t: string) => {
    if (loading || done || awaiting === "choice") return;
    setItems((i) => [...i, { from: "user", text: t }]);
    call({ text: t }, convState);
  };

  const sendText = () => {
    const t = text.trim();
    if (!t || loading || done) return;
    setItems((i) => [...i, { from: "user", text: t }]);
    setText("");
    call({ text: t }, convState);
  };
  const choose = (id: string, label: string) => {
    if (loading || done) return;
    setItems((i) => [...i, { from: "user", text: label }]);
    call({ choice: id }, convState);
  };

  // Active choices = the last bot message's buttons / rows (when awaiting one).
  const lastBot = [...items].reverse().find((i) => i.from === "bot");
  const choices =
    awaiting === "choice" && lastBot
      ? lastBot.buttons || (lastBot.rows || []).map((r) => ({ id: r.id, label: r.title }))
      : [];

  // ── Datos para el panel "Inspeccionar" (variables capturadas + herramientas) ──
  const varEntries: [string, string][] =
    convState?.vars && typeof convState.vars === "object" ? Object.entries(convState.vars) : [];
  const toolsUsed: string[] = Array.isArray(convState?.toolsUsed) ? convState.toolsUsed : [];
  const aiTurns: number = typeof convState?.aiTurns === "number" ? convState.aiTurns : 0;
  // Pilar 8 Fase B — auditoría: fuentes citadas, confianza, motivo de derivación.
  const citations: { id: string; label: string }[] = Array.isArray(convState?.citations)
    ? convState.citations
    : [];
  const confidences: number[] = Array.isArray(convState?.confidences) ? convState.confidences : [];
  const confidenceAvg = confidences.length
    ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
    : null;
  const handoffReason: string =
    typeof convState?.handoffReason === "string" ? convState.handoffReason : "";
  const stepLabel: string = done
    ? "Finalizado"
    : (() => {
        const id = convState?.nodeId;
        if (!id) return "";
        const n = bot.nodes.find((x) => x.id === id);
        return n ? NODE_KINDS[n.kind]?.label || n.kind : "";
      })();

  return (
    <div className="fb-wa">
      {/* WhatsApp-style header */}
      <div className="fb-wa__head">
        <span className="fb-wa__avatar">
          <BotIcon size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fb-wa__name">{bot.name || "Asistente ARIA"}</div>
          <div className="fb-wa__presence">{loading ? "escribiendo…" : "en línea"}</div>
        </div>
        <button
          onClick={() => setInspect((v) => !v)}
          title="Inspeccionar variables y herramientas"
          className={`fb-wa__ibtn ${inspect ? "is-on" : ""}`}
        >
          <Braces size={14} />
        </button>
        <button onClick={restart} title="Reiniciar" className="fb-wa__ibtn">
          <RotateCcw size={14} />
        </button>
        <button onClick={onClose} title="Cerrar" className="fb-wa__ibtn">
          <X size={15} />
        </button>
      </div>

      {/* Chat */}
      <div ref={scrollRef} className="fb-wa__chat">
        {items.map((m, idx) =>
          m.from === "tool" ? (
            <div key={idx} className="fb-wa__toolnote">
              <Wrench size={11} /> {m.text}
            </div>
          ) : m.from === "note" ? (
            <div key={idx} className="fb-wa__note">
              {m.text}
            </div>
          ) : (
            <Fragment key={idx}>
              <div
                className={`fb-wa__bubble ${m.from === "user" ? "fb-wa__bubble--me" : "fb-wa__bubble--bot"}`}
              >
                {m.media &&
                  (m.media.type === "Video" ? (
                    <video src={m.media.url} controls className="fb-wa__media" />
                  ) : m.media.type === "Imagen" ? (
                    <img src={m.media.url} alt={m.media.caption || ""} className="fb-wa__media" />
                  ) : (
                    <a href={m.media.url} target="_blank" rel="noreferrer" className="fb-wa__file">
                      📎 {m.media.type}
                    </a>
                  ))}
                {m.text}
                {m.rows && m.rows.length > 0 && (
                  <div className="fb-wa__rows">
                    {m.rows.map((r) => (
                      <div key={r.id} className="fb-wa__listrow">
                        {r.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {m.cites && m.cites.length > 0 && (
                <div className="fb-wa__cites">
                  {m.cites.map((c) => (
                    <span key={c.id} className="fb-wa__cite" title={`${c.id} · ${c.label}`}>
                      <Quote size={9} /> <b>{c.id}</b> {c.label}
                    </span>
                  ))}
                </div>
              )}
            </Fragment>
          ),
        )}
        {loading && (
          <div className="fb-wa__bubble fb-wa__bubble--bot fb-wa__typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {/* Inspect drawer — variables capturadas + herramientas ejecutadas */}
      {inspect && (
        <div className="fb-wa__inspect">
          <div className="fb-wa__insp-sec">
            <div className="fb-wa__insp-h">
              <Braces size={12} /> Variables capturadas
              <span className="fb-wa__insp-count">{varEntries.length}</span>
            </div>
            {varEntries.length > 0 ? (
              <div className="fb-wa__insp-vars">
                {varEntries.map(([k, v]) => (
                  <div key={k} className="fb-wa__insp-var">
                    <span className="fb-wa__insp-k">{k}</span>
                    <span className="fb-wa__insp-v">{v || "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="fb-wa__insp-empty">Aún no se capturó ninguna variable.</div>
            )}
          </div>
          <div className="fb-wa__insp-sec">
            <div className="fb-wa__insp-h">
              <Wrench size={12} /> Herramientas ejecutadas
              <span className="fb-wa__insp-count">{toolsUsed.length}</span>
            </div>
            {toolsUsed.length > 0 ? (
              <div className="fb-wa__insp-tools">
                {toolsUsed.map((t, i) => (
                  <span key={i} className="fb-wa__insp-tool">
                    {TOOL_LABELS[t] || t}
                  </span>
                ))}
              </div>
            ) : (
              <div className="fb-wa__insp-empty">Ninguna herramienta ejecutada todavía.</div>
            )}
          </div>
          {/* Pilar 8 Fase B — fuentes citadas (auditoría del RAG) */}
          <div className="fb-wa__insp-sec">
            <div className="fb-wa__insp-h">
              <Quote size={12} /> Fuentes citadas
              <span className="fb-wa__insp-count">{citations.length}</span>
            </div>
            {citations.length > 0 ? (
              <div className="fb-wa__insp-tools">
                {citations.map((c) => (
                  <span key={c.id} className="fb-wa__insp-tool" title={`${c.id} · ${c.label}`}>
                    {c.label}
                  </span>
                ))}
              </div>
            ) : (
              <div className="fb-wa__insp-empty">El agente todavía no citó ninguna fuente.</div>
            )}
          </div>
          {(stepLabel || aiTurns > 0 || confidenceAvg != null || handoffReason) && (
            <div className="fb-wa__insp-meta">
              {stepLabel && (
                <span>
                  Paso: <b>{stepLabel}</b>
                </span>
              )}
              {aiTurns > 0 && (
                <span>
                  Turnos IA: <b>{aiTurns}</b>
                </span>
              )}
              {confidenceAvg != null && (
                <span>
                  Confianza: <b>{confidenceAvg}%</b>
                </span>
              )}
              {handoffReason && (
                <span>
                  Derivó por: <b>{HANDOFF_LABELS[handoffReason] || handoffReason}</b>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick-reply chips */}
      {choices.length > 0 && !done && (
        <div className="fb-wa__chips">
          {choices.map((c) => (
            <button
              key={c.id}
              onClick={() => choose(c.id, c.label)}
              disabled={loading}
              className="fb-wa__chip"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Suggested test prompts (agent playground) */}
      {suggestions &&
        suggestions.length > 0 &&
        !done &&
        awaiting !== "choice" &&
        choices.length === 0 && (
          <div className="fb-wa__suggest">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => sendQuick(s)}
                disabled={loading}
                className="fb-wa__suggest-chip"
                title="Enviar este mensaje de prueba"
              >
                {s}
              </button>
            ))}
          </div>
        )}

      {/* Input bar */}
      <div className="fb-wa__inputbar">
        {done ? (
          <button
            onClick={restart}
            className="btn btn--sm"
            style={{ width: "100%", justifyContent: "center", display: "flex", gap: 6 }}
          >
            <RotateCcw size={13} /> Conversación finalizada · reiniciar
          </button>
        ) : (
          <>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder={awaiting === "choice" ? "Elige una opción…" : "Escribe un mensaje…"}
              disabled={awaiting === "choice" || loading}
              className="fb-wa__field"
            />
            <button
              onClick={sendText}
              disabled={awaiting === "choice" || loading || !text.trim()}
              className="fb-wa__send"
              title="Enviar"
            >
              <Send size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
