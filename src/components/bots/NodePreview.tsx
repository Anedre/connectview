import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link2,
  PhoneCall,
  List as ListIcon,
  Eye,
  StickyNote,
  GitBranch,
  Clock,
  Play,
  Sparkles,
  Paperclip,
  Webhook,
  UserRound,
  Wrench,
} from "lucide-react";
import { OP_LABEL, UNIT_LABEL, type ButtonDef, type ListRow, type NodeKind } from "@/lib/botFlow";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * NodePreview — una vista previa estilo WhatsApp de lo que verá el cliente,
 * mostrada arriba del inspector para los pasos de mensaje (#16). Hace que armar
 * el flujo sea "lo que ves es lo que mandás": el usuario no tiene que imaginar
 * cómo queda una lista o los botones. Se actualiza en vivo al editar.
 */
function vars(text: string): React.ReactNode {
  return text.split(/(\{\{[^}]+\}\})/g).map((p, i) =>
    /^\{\{[^}]+\}\}$/.test(p) ? (
      <span key={i} className="fb-var">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

const PREVIEWABLE: NodeKind[] = [
  "message",
  "media",
  "list",
  "question",
  "template",
  "internal_note",
  "payment",
];

export function NodePreview({ kind, data }: { kind: NodeKind; data: Record<string, unknown> }) {
  if (!PREVIEWABLE.includes(kind)) return null;

  let body: React.ReactNode = null;

  if (kind === "message") {
    const text = String(data.text || "");
    const buttons = (Array.isArray(data.buttons) ? data.buttons : []) as ButtonDef[];
    body = (
      <>
        <div className="fb-prev__bubble">
          {text ? vars(text) : <span className="fb-prev__ph">Mensaje vacío…</span>}
        </div>
        {buttons.length > 0 && (
          <div className="fb-prev__btns">
            {buttons.map((b) => (
              <div key={b.id} className="fb-prev__btn">
                {b.type === "url" ? (
                  <Link2 size={13} />
                ) : b.type === "phone" ? (
                  <PhoneCall size={13} />
                ) : null}
                {b.label || (b.type === "url" ? "Enlace" : b.type === "phone" ? "Llamar" : "Botón")}
              </div>
            ))}
          </div>
        )}
      </>
    );
  } else if (kind === "media") {
    const mtype = String(data.mediaType || "Imagen");
    const url = String(data.url || "");
    const caption = String(data.caption || "");
    body = (
      <>
        {url ? (
          mtype === "Video" ? (
            <video src={url} controls className="fb-prev__img" />
          ) : mtype === "Imagen" ? (
            <img src={url} alt="" className="fb-prev__img" />
          ) : (
            <div className="fb-prev__bubble">
              <Paperclip size={13} /> {mtype}
            </div>
          )
        ) : (
          <div className="fb-prev__bubble">
            <span className="fb-prev__ph">Pegá la URL del archivo…</span>
          </div>
        )}
        {caption && <div className="fb-prev__bubble">{vars(caption)}</div>}
      </>
    );
  } else if (kind === "list") {
    const header = String(data.header || "");
    const bodyText = String(data.body || "");
    const buttonLabel = String(data.buttonLabel || "Ver opciones");
    const rows = (Array.isArray(data.rows) ? data.rows : []) as ListRow[];
    body = (
      <>
        <div className="fb-prev__bubble">
          {header && <div className="fb-prev__bold">{vars(header)}</div>}
          {bodyText ? vars(bodyText) : <span className="fb-prev__ph">Mensaje…</span>}
          <div className="fb-prev__listbtn">
            <ListIcon size={13} /> {buttonLabel || "Ver opciones"}
          </div>
        </div>
        <div className="fb-prev__list">
          {rows.length > 0 ? (
            rows.map((r) => (
              <div key={r.id} className="fb-prev__row">
                <span className="fb-prev__rowt">{r.title || "Opción"}</span>
                {r.description && <span className="fb-prev__rowd">{r.description}</span>}
              </div>
            ))
          ) : (
            <div className="fb-prev__row">
              <span className="fb-prev__ph">Agregá opciones abajo…</span>
            </div>
          )}
        </div>
      </>
    );
  } else if (kind === "question") {
    const prompt = String(data.prompt || "");
    body = (
      <>
        <div className="fb-prev__bubble">
          {prompt ? vars(prompt) : <span className="fb-prev__ph">Pregunta…</span>}
        </div>
        <div className="fb-prev__hintline">El bot espera la respuesta del cliente y la guarda.</div>
      </>
    );
  } else if (kind === "template") {
    const name = String(data.templateName || "");
    const count = Array.isArray(data.variables)
      ? (data.variables as string[]).filter(Boolean).length
      : 0;
    body = (
      <div className="fb-prev__bubble">
        <div className="fb-prev__bold">Plantilla de WhatsApp</div>
        {name ? (
          <code className="fb-prev__code">{name}</code>
        ) : (
          <span className="fb-prev__ph">Elegí una plantilla…</span>
        )}
        {count > 0 && (
          <div className="fb-prev__hintline" style={{ marginTop: 4 }}>
            {count} variable{count > 1 ? "s" : ""} a completar.
          </div>
        )}
      </div>
    );
  } else if (kind === "internal_note") {
    const text = String(data.text || "");
    body = (
      <div className="fb-prev__note">
        <StickyNote size={13} />
        <span>{text ? vars(text) : <span className="fb-prev__ph">Nota interna…</span>}</span>
      </div>
    );
  } else if (kind === "payment") {
    const concept = String(data.concept || "");
    const amount = String(data.amount || "");
    const currency = String(data.currency || "PEN");
    const url = String(data.url || "");
    body = (
      <div className="fb-prev__bubble">
        💳 <b>{concept || "Pago"}</b>
        {amount ? ` — ${currency} ${amount}` : ""}
        {url ? (
          <div className="fb-prev__listbtn">
            <Link2 size={12} /> Pagar ahora
          </div>
        ) : (
          <div style={{ marginTop: 5 }}>
            <span className="fb-prev__ph">Pegá el link de pago…</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Eye size={12} /> Vista previa
      </div>
      <div className={`fb-prev__screen ${kind === "internal_note" ? "fb-prev__screen--note" : ""}`}>
        {body}
      </div>
    </div>
  );
}

/** Condición en lenguaje natural: "Si X contiene 'Y' → Sí / No". */
export function ConditionPreview({ data }: { data: Record<string, unknown> }) {
  const variable = String(data.variable || "").trim();
  const op = String(data.op || "equals");
  const value = String(data.value || "").trim();
  const needsValue = op !== "exists";
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <GitBranch size={12} /> Vista previa
      </div>
      <div className="fb-cond">
        <div className="fb-cond__rule">
          Si{" "}
          {variable ? (
            <span className="fb-var">{variable}</span>
          ) : (
            <span className="fb-prev__ph">(elegí una variable)</span>
          )}{" "}
          <b>{OP_LABEL[op] || op}</b>
          {needsValue && (
            <>
              {" "}
              {value ? (
                <span className="fb-cond__val">“{value}”</span>
              ) : (
                <span className="fb-prev__ph">(valor)</span>
              )}
            </>
          )}
        </div>
        <div className="fb-cond__branches">
          <span className="fb-cond__branch fb-cond__branch--yes">→ sale por «Sí»</span>
          <span className="fb-cond__branch fb-cond__branch--no">si no, por «No»</span>
        </div>
      </div>
    </div>
  );
}

/** Horario de atención en lenguaje natural + ramas Abierto/Cerrado. */
export function BusinessHoursPreview({ data }: { data: Record<string, unknown> }) {
  const days = String(data.daysPreset || "Lunes a viernes");
  const from = String(data.from || "09:00");
  const to = String(data.to || "18:00");
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Clock size={12} /> Vista previa
      </div>
      <div className="fb-cond">
        <div className="fb-cond__rule">
          Si es <b>{days}</b> entre <b>{from}</b> y <b>{to}</b>…
        </div>
        <div className="fb-cond__branches">
          <span className="fb-cond__branch fb-cond__branch--yes">→ sale por «Abierto»</span>
          <span className="fb-cond__branch fb-cond__branch--no">si no, por «Cerrado»</span>
        </div>
      </div>
    </div>
  );
}

/** Derivar a agente: a qué cola entra, prioridad y asignación. */
export function HandoffPreview({ data }: { data: Record<string, unknown> }) {
  const queue = String(data.queue || "");
  const priority = String(data.priority || "normal");
  const assignTo = String(data.assignTo || "");
  const prioStyle =
    priority === "urgente"
      ? { color: "var(--accent-red)", background: "var(--accent-red-soft)" }
      : priority === "alta"
        ? {
            color: "var(--accent-amber)",
            background: "var(--accent-amber-soft, rgba(224,162,59,0.14))",
          }
        : undefined;
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <UserRound size={12} /> Vista previa
      </div>
      <div className="fb-cond">
        <div className="fb-cond__rule">
          La conversación pasa a{" "}
          {queue ? <b>la cola «{queue}»</b> : <span className="fb-prev__ph">una cola</span>}
          {assignTo ? (
            <>
              {" "}
              y se asigna a <b>{assignTo}</b>
            </>
          ) : (
            " (cualquier agente disponible)"
          )}
          .
        </div>
        <div className="fb-cond__branches">
          <span className="fb-cond__branch fb-cond__branch--yes" style={prioStyle}>
            prioridad {priority}
          </span>
        </div>
      </div>
    </div>
  );
}

/** División A/B en lenguaje natural + ramas A/B con sus porcentajes. */
export function ABSplitPreview({ data }: { data: Record<string, unknown> }) {
  const raw = Number(data.percentA);
  const pa = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 50;
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <GitBranch size={12} /> Vista previa
      </div>
      <div className="fb-cond">
        <div className="fb-cond__rule">
          Al azar: <b>{pa}%</b> sale por A y <b>{100 - pa}%</b> por B.
        </div>
        <div className="fb-cond__branches">
          <span className="fb-cond__branch fb-cond__branch--yes">→ A ({pa}%)</span>
          <span className="fb-cond__branch fb-cond__branch--no">→ B ({100 - pa}%)</span>
        </div>
      </div>
    </div>
  );
}

/** Botón "Probar" que llama al webhook desde el navegador y muestra la respuesta. */
export function WebhookTester({ data }: { data: Record<string, unknown> }) {
  const [st, setSt] = useState<{ loading: boolean; out?: string; ok?: boolean }>({
    loading: false,
  });
  const run = async () => {
    const url = String(data.url || "");
    if (!url) {
      setSt({ loading: false, out: "Pegá una URL primero.", ok: false });
      return;
    }
    setSt({ loading: true });
    try {
      const method = String(data.method || "POST");
      const bodyStr = String(data.body || "");
      const r = await fetch(url, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" && bodyStr ? bodyStr : undefined,
      });
      const txt = (await r.text()).slice(0, 280);
      setSt({ loading: false, ok: r.ok, out: `${r.status} ${r.statusText}\n${txt}` });
    } catch (e) {
      setSt({
        loading: false,
        ok: false,
        out:
          "No se pudo llamar (¿CORS o URL inválida?).\n" +
          (e instanceof Error ? e.message : "error"),
      });
    }
  };
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Webhook size={12} /> Probar webhook
      </div>
      <div className="fb-whtest">
        <button type="button" className="btn btn--sm" onClick={run} disabled={st.loading}>
          {st.loading ? "Llamando…" : "Probar ahora"}
        </button>
        {st.out && <pre className={`fb-whtest__out ${st.ok ? "is-ok" : "is-bad"}`}>{st.out}</pre>}
        <div className="fb-whtest__note">
          Se ejecuta desde tu navegador; algunos servidores bloquean por CORS aunque en producción
          sí funcionen.
        </div>
      </div>
    </div>
  );
}

const DELAY_PRESETS: { label: string; amount: number; unit: string }[] = [
  { label: "30 min", amount: 30, unit: "minutes" },
  { label: "1 hora", amount: 1, unit: "hours" },
  { label: "1 día", amount: 1, unit: "days" },
  { label: "3 días", amount: 3, unit: "days" },
  { label: "1 semana", amount: 7, unit: "days" },
];

const TRIGGER_EXPLAIN: Record<string, string> = {
  "Mensaje entrante (WhatsApp)": "Arranca cuando un cliente te escribe por WhatsApp.",
  "Nuevo lead": "Arranca solo cuando entra un lead nuevo a tu sistema.",
  "Palabra clave": "Arranca cuando el cliente escribe una palabra clave (p. ej. «PROMO»).",
  "Manual / prueba": "Lo disparás vos a mano — útil para probar el flujo.",
  "Lead sin actividad": "Arranca cuando un lead lleva un tiempo sin responder.",
};

/** Explica en una frase qué dispara el bot, según el disparador elegido. */
export function StartPreview({ data }: { data: Record<string, unknown> }) {
  const trigger = String(data.trigger || "");
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Play size={12} /> Vista previa
      </div>
      <div className="fb-start">
        <div className="fb-start__trigger">{trigger || "Sin disparador"}</div>
        <div className="fb-start__explain">
          {TRIGGER_EXPLAIN[trigger] || "Define cuándo arranca el bot."}
        </div>
      </div>
    </div>
  );
}

const PERSONAS: { label: string; instructions: string }[] = [
  {
    label: "Asesor cordial",
    instructions:
      "Sos un asesor cordial y conciso. Respondé en español, claro y al grano. Tuteá al cliente.",
  },
  {
    label: "Soporte técnico",
    instructions:
      "Sos soporte técnico paciente. Pedí los datos concretos que necesitás y guiá paso a paso, sin tecnicismos innecesarios.",
  },
  {
    label: "Ventas consultivas",
    instructions:
      "Sos un vendedor consultivo. Primero entendé la necesidad del cliente con preguntas; recién después recomendá. No presiones.",
  },
  {
    label: "Recepción formal",
    instructions:
      "Sos la recepción de la empresa, con tono formal y amable. Tratá de «usted». Derivá a un humano si la consulta excede lo básico.",
  },
];

/** Chips de personalidad que rellenan las instrucciones del Agente IA. */
export function AiPersonaPresets({
  onChange,
}: {
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Sparkles size={12} /> Personalidad rápida
      </div>
      <div className="fb-persona">
        <div className="fb-persona__hint">
          Elegí una base para las instrucciones (después la editás):
        </div>
        <div className="fb-persona__chips">
          {PERSONAS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="fb-persona__chip"
              onClick={() => onChange({ instructions: p.instructions })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Agente IA · pickers dinámicos (Pilar 8) ─────────────────────────────────
 * Tools (qué puede ejecutar), catálogos para anclar (RAG) y base de conocimiento
 * (FAQ). El bot-runtime lee data.tools[] / data.ragCatalogs[] / data.ragKbId.
 * Antes el agente no era configurable desde el builder: las tools se editaban a
 * mano y el RAG no tenía UI. */
const AI_TOOLS: { key: string; label: string; hint: string; sensitive?: boolean }[] = [
  {
    key: "lookup_customer",
    label: "Buscar cliente",
    hint: "Consulta el perfil por teléfono/email (solo lectura)",
  },
  {
    key: "upsert_lead",
    label: "Crear / actualizar lead",
    hint: "Registra o mueve el lead en el funnel",
    sensitive: true,
  },
  {
    key: "book_appointment",
    label: "Agendar cita",
    hint: "Reserva una cita en el calendario",
    sensitive: true,
  },
  {
    key: "send_whatsapp_template",
    label: "Enviar plantilla WhatsApp",
    hint: "Manda una plantilla aprobada",
    sensitive: true,
  },
];

const ACC = "#9B6DFF";
const pickerLabel: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--text-2)",
  marginBottom: 6,
};
const emptyHint: React.CSSProperties = { fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 };
const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border-1)",
  background: "var(--surface-1, var(--bg-1))",
  color: "var(--text-1)",
  fontSize: 12.5,
};
const sensTag: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 9,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--accent-amber)",
  background: "var(--accent-amber-soft)",
  padding: "1px 5px",
  borderRadius: 5,
};
function pickRow(on: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    textAlign: "left",
    width: "100%",
    padding: "8px 9px",
    borderRadius: 9,
    cursor: "pointer",
    border: `1px solid ${on ? `color-mix(in srgb, ${ACC} 45%, var(--border-1))` : "var(--border-1)"}`,
    background: on ? `color-mix(in srgb, ${ACC} 9%, transparent)` : "var(--surface-1, transparent)",
  };
}
function checkBox(on: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 17,
    height: 17,
    marginTop: 1,
    borderRadius: 5,
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    fontWeight: 800,
    color: "#fff",
    border: `1.5px solid ${on ? ACC : "var(--border-strong, var(--border-1))"}`,
    background: on ? ACC : "transparent",
  };
}
function chip(on: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${on ? ACC : "var(--border-1)"}`,
    background: on
      ? `color-mix(in srgb, ${ACC} 14%, transparent)`
      : "var(--surface-1, transparent)",
    color: on ? ACC : "var(--text-2)",
  };
}

export function AiAgentTools({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const ep = getApiEndpoints();
  const enabledTools = Array.isArray(data.tools) ? (data.tools as string[]) : [];
  const enabledCats = Array.isArray(data.ragCatalogs) ? (data.ragCatalogs as string[]) : [];
  const kbId = typeof data.ragKbId === "string" ? data.ragKbId : "";

  const catalogs = useQuery({
    queryKey: ["ai-agent-catalogs"],
    enabled: !!ep?.manageCatalog,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await authedFetch(ep!.manageCatalog!);
      const d = await r.json();
      return (d.catalogs || []) as { catalogId: string; name: string }[];
    },
  });
  const kbs = useQuery({
    queryKey: ["ai-agent-kbs"],
    enabled: !!ep?.manageKnowledge,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await authedFetch(ep!.manageKnowledge!);
      const d = await r.json();
      return (d.kbs || []) as { kbId: string; name: string; entries?: unknown[] }[];
    },
  });

  const toggleTool = (k: string) =>
    onChange({
      tools: enabledTools.includes(k) ? enabledTools.filter((x) => x !== k) : [...enabledTools, k],
    });
  const toggleCat = (id: string) =>
    onChange({
      ragCatalogs: enabledCats.includes(id)
        ? enabledCats.filter((x) => x !== id)
        : [...enabledCats, id],
    });

  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Wrench size={12} /> Herramientas y datos del agente
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 15, padding: "3px 2px 5px" }}>
        {/* Tools — qué acciones puede ejecutar el agente */}
        <div>
          <div style={pickerLabel}>Acciones que puede ejecutar</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {AI_TOOLS.map((t) => {
              const on = enabledTools.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleTool(t.key)}
                  style={pickRow(on)}
                >
                  <span style={checkBox(on)}>{on ? "✓" : ""}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: 600,
                        fontSize: 12.5,
                        color: "var(--text-1)",
                      }}
                    >
                      {t.label}
                      {t.sensitive && <span style={sensTag}>confirmar</span>}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-3)" }}>
                      {t.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {enabledTools.length === 0 && (
            <div style={{ ...emptyHint, marginTop: 6 }}>
              Sin acciones: la IA solo conversa (no toca datos ni envía nada).
            </div>
          )}
        </div>

        {/* Catálogos — anclaje RAG */}
        <div>
          <div style={pickerLabel}>Catálogos para anclar (RAG)</div>
          {!ep?.manageCatalog ? (
            <div style={emptyHint}>Endpoint de catálogos no configurado.</div>
          ) : catalogs.isLoading ? (
            <div style={emptyHint}>Cargando catálogos…</div>
          ) : (catalogs.data?.length ?? 0) === 0 ? (
            <div style={emptyHint}>Sin catálogos. Creá uno en Configuración → Catálogos.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {catalogs.data!.map((c) => {
                const on = enabledCats.includes(c.catalogId);
                return (
                  <button
                    key={c.catalogId}
                    type="button"
                    onClick={() => toggleCat(c.catalogId)}
                    style={chip(on)}
                  >
                    {on ? "✓ " : ""}
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Base de conocimiento (FAQ) */}
        <div>
          <div style={pickerLabel}>Base de conocimiento (FAQ)</div>
          {!ep?.manageKnowledge ? (
            <div style={emptyHint}>Endpoint de FAQ no configurado.</div>
          ) : (
            <select
              value={kbId}
              onChange={(e) => onChange({ ragKbId: e.target.value })}
              style={selectStyle}
            >
              <option value="">— Ninguna —</option>
              {(kbs.data || []).map((k) => (
                <option key={k.kbId} value={k.kbId}>
                  {k.name}
                  {Array.isArray(k.entries) ? ` · ${k.entries.length} FAQ` : ""}
                </option>
              ))}
            </select>
          )}
          <div style={{ ...emptyHint, marginTop: 5 }}>
            El agente responde anclado a estas FAQs. Gestionalas en Configuración → Base de
            conocimiento.
          </div>
        </div>
      </div>
    </div>
  );
}

/** Presets rápidos + frase en lenguaje natural para el paso "Esperar". */
export function DelayPresets({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const amount = Number(data.amount) || 0;
  const unit = String(data.unit || "minutes");
  return (
    <div className="fb-prev">
      <div className="fb-prev__top">
        <Clock size={12} /> Vista previa
      </div>
      <div className="fb-delay">
        <div className="fb-delay__line">
          El bot{" "}
          <b>
            espera {amount} {UNIT_LABEL[unit] || unit}
          </b>{" "}
          y sigue al próximo paso.
        </div>
        <div className="fb-delay__presets">
          {DELAY_PRESETS.map((p) => {
            const on = amount === p.amount && unit === p.unit;
            return (
              <button
                key={p.label}
                type="button"
                className={`fb-delay__chip ${on ? "is-on" : ""}`}
                onClick={() => onChange({ amount: p.amount, unit: p.unit })}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
