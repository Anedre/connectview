import { useEffect, useRef, useState } from "react";
import { Send, X, RotateCcw, Bot as BotIcon, Braces, Wrench } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { NODE_KINDS, type Bot } from "@/lib/botFlow";

/** Nombres internos de herramientas → etiqueta legible para el panel de inspección. */
const TOOL_LABELS: Record<string, string> = {
  book_appointment: "Agendó una cita",
  upsert_lead: "Creó / actualizó un lead",
  lookup_customer: "Buscó un cliente",
  send_whatsapp_template: "Envió una plantilla",
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
  from: "bot" | "user" | "note";
  text: string;
  buttons?: { id: string; label: string }[];
  rows?: { id: string; title: string; description?: string }[];
  media?: MediaRef;
}

export function BotTester({ bot, onClose, suggestions }: { bot: Bot; onClose: () => void; suggestions?: string[] }) {
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
    st: any
  ) => {
    if (!ep?.botRuntime) {
      setItems((i) => [...i, { from: "note", text: "Runtime no configurado." }]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(ep.botRuntime, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot, state: st, input,
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
      setItems((i) => [
        ...i,
        ...msgs.map((m) => ({
          from: (m.kind === "note" ? "note" : "bot") as ChatItem["from"],
          text: m.text,
          buttons: m.buttons,
          rows: m.rows,
          media: m.media,
        })),
      ]);
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
        <span className="fb-wa__avatar"><BotIcon size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fb-wa__name">{bot.name || "Asistente AIRA"}</div>
          <div className="fb-wa__presence">{loading ? "escribiendo…" : "en línea"}</div>
        </div>
        <button onClick={() => setInspect((v) => !v)} title="Inspeccionar variables y herramientas" className={`fb-wa__ibtn ${inspect ? "is-on" : ""}`}><Braces size={14} /></button>
        <button onClick={restart} title="Reiniciar" className="fb-wa__ibtn"><RotateCcw size={14} /></button>
        <button onClick={onClose} title="Cerrar" className="fb-wa__ibtn"><X size={15} /></button>
      </div>

      {/* Chat */}
      <div ref={scrollRef} className="fb-wa__chat">
        {items.map((m, idx) =>
          m.from === "note" ? (
            <div key={idx} className="fb-wa__note">{m.text}</div>
          ) : (
            <div key={idx} className={`fb-wa__bubble ${m.from === "user" ? "fb-wa__bubble--me" : "fb-wa__bubble--bot"}`}>
              {m.media && (
                m.media.type === "Video" ? (
                  <video src={m.media.url} controls className="fb-wa__media" />
                ) : m.media.type === "Imagen" ? (
                  <img src={m.media.url} alt={m.media.caption || ""} className="fb-wa__media" />
                ) : (
                  <a href={m.media.url} target="_blank" rel="noreferrer" className="fb-wa__file">📎 {m.media.type}</a>
                )
              )}
              {m.text}
              {m.rows && m.rows.length > 0 && (
                <div className="fb-wa__rows">
                  {m.rows.map((r) => (
                    <div key={r.id} className="fb-wa__listrow">{r.title}</div>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {loading && (
          <div className="fb-wa__bubble fb-wa__bubble--bot fb-wa__typing"><span /><span /><span /></div>
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
                  <span key={i} className="fb-wa__insp-tool">{TOOL_LABELS[t] || t}</span>
                ))}
              </div>
            ) : (
              <div className="fb-wa__insp-empty">Ninguna herramienta ejecutada todavía.</div>
            )}
          </div>
          {(stepLabel || aiTurns > 0) && (
            <div className="fb-wa__insp-meta">
              {stepLabel && <span>Paso: <b>{stepLabel}</b></span>}
              {aiTurns > 0 && <span>Turnos IA: <b>{aiTurns}</b></span>}
            </div>
          )}
        </div>
      )}

      {/* Quick-reply chips */}
      {choices.length > 0 && !done && (
        <div className="fb-wa__chips">
          {choices.map((c) => (
            <button key={c.id} onClick={() => choose(c.id, c.label)} disabled={loading} className="fb-wa__chip">
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Suggested test prompts (agent playground) */}
      {suggestions && suggestions.length > 0 && !done && awaiting !== "choice" && choices.length === 0 && (
        <div className="fb-wa__suggest">
          {suggestions.map((s) => (
            <button key={s} onClick={() => sendQuick(s)} disabled={loading} className="fb-wa__suggest-chip" title="Enviar este mensaje de prueba">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="fb-wa__inputbar">
        {done ? (
          <button onClick={restart} className="btn btn--sm" style={{ width: "100%", justifyContent: "center", display: "flex", gap: 6 }}>
            <RotateCcw size={13} /> Conversación finalizada · reiniciar
          </button>
        ) : (
          <>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder={awaiting === "choice" ? "Elegí una opción…" : "Escribí un mensaje…"}
              disabled={awaiting === "choice" || loading}
              className="fb-wa__field"
            />
            <button onClick={sendText} disabled={awaiting === "choice" || loading || !text.trim()} className="fb-wa__send" title="Enviar">
              <Send size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
