import { useMemo, useState } from "react";
import * as Icon from "@/components/vox/primitives";
import { Card, CardBody, Kpi } from "@/components/vox/primitives";
import { Input } from "@/components/ui/input";
import { useFeatureStatus } from "@/hooks/useFeatureStatus";
import { getApiEndpoints } from "@/lib/api";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { authedFetch } from "@/lib/authedFetch";

/**
 * AiContactLensManager — "IA y Contact Lens" de Configuración: el centro de
 * inteligencia de ARIA. NO es decorativo: lee el estado EN VIVO de los tres
 * pilares de IA del tenant (Contact Lens, Amazon Bedrock, Amazon Q) del mismo
 * health-check que el panel de integración (`diagnose-connection`), mapea cada
 * pilar a las funciones del producto que potencia, y trae un PROBADOR real que
 * invoca Bedrock (Claude) en la cuenta del cliente — round-trip de verdad.
 *
 * - Pilares con estado real + remediación accionable (link a su consola).
 * - Mapa de capacidades: qué función está disponible según qué pilar esté activo.
 * - Probador del asistente IA: pregunta → `generate-call-summary` mode=assistant.
 */

type Status = "ok" | "warn" | "error" | "unknown";

const PILLAR_META: Record<string, { tone: string; soft: string }> = {
  contactLens: { tone: "var(--accent-cyan)", soft: "var(--accent-cyan-soft)" },
  bedrock: { tone: "var(--accent-violet)", soft: "var(--accent-violet-soft)" },
  amazonQ: { tone: "var(--accent-green)", soft: "var(--accent-green-soft)" },
};

interface Pillar {
  id: "contactLens" | "bedrock" | "amazonQ";
  name: string;
  icon: React.ElementType;
  blurb: string;
  powers: string[];
}

const PILLARS: Pillar[] = [
  {
    id: "contactLens",
    name: "Contact Lens",
    icon: Icon.Activity,
    blurb: "Transcribe y analiza el sentimiento de cada llamada y chat.",
    powers: ["Transcripciones", "Sentimiento", "Insumo de resúmenes"],
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    icon: Icon.Sparkles,
    blurb: "Motor de IA generativa (Claude) que resume, sugiere y redacta.",
    powers: ["Resúmenes", "Tipificación IA", "Respuestas y reescritura"],
  },
  {
    id: "amazonQ",
    name: "Amazon Q in Connect",
    icon: Icon.Headset,
    blurb: "Copiloto nativo del agente: sugiere respuestas y artículos en vivo.",
    powers: ["Sugerencias en vivo", "Base de conocimiento"],
  },
];

interface Capability {
  name: string;
  desc: string;
  icon: React.ElementType;
  deps: Array<"contactLens" | "bedrock" | "amazonQ">;
}

const CAPABILITIES: Capability[] = [
  {
    name: "Resumen automático de llamadas",
    desc: "Motivo, resolución y sentimiento al cerrar el contacto.",
    icon: Icon.Note,
    deps: ["contactLens", "bedrock"],
  },
  {
    name: "Análisis de sentimiento",
    desc: "Positivo / negativo / neutral por contacto, para reportes.",
    icon: Icon.Activity,
    deps: ["contactLens"],
  },
  {
    name: "Tipificación sugerida por IA",
    desc: "Propone la tipificación del wrap-up con % de confianza.",
    icon: Icon.Tag,
    deps: ["bedrock"],
  },
  {
    name: "Respuestas sugeridas",
    desc: "2-3 respuestas listas para enviar en chat / WhatsApp.",
    icon: Icon.Chat,
    deps: ["bedrock"],
  },
  {
    name: "Reescritura de mensajes",
    desc: "Reescribe el borrador del agente con el tono elegido.",
    icon: Icon.Pencil,
    deps: ["bedrock"],
  },
  {
    name: "Copiloto Amazon Q",
    desc: "Sugerencias y artículos en vivo durante la conversación.",
    icon: Icon.Sparkles,
    deps: ["amazonQ"],
  },
];

const SAMPLES = [
  "¿Cómo creo una campaña saliente?",
  "Redacta un saludo de bienvenida para WhatsApp",
  "¿Qué es la tipificación de un contacto?",
];

/** RichText — render mínimo de markdown (negritas, encabezados, viñetas) para
 *  que la respuesta del modelo se vea pulida sin meter una librería ni HTML
 *  crudo. Pure string→React, sin dangerouslySetInnerHTML. */
function RichText({ text }: { text: string }) {
  const bold = (s: string) =>
    s
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      );
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-1)" }}>
      {text.split("\n").map((ln, i) => {
        const t = ln.trim();
        if (!t) return <div key={i} style={{ height: 7 }} />;
        const h = t.match(/^#{1,6}\s+(.*)$/);
        if (h)
          return (
            <div key={i} style={{ fontWeight: 800, fontSize: 14, margin: "4px 0 3px" }}>
              {bold(h[1])}
            </div>
          );
        const li = t.match(/^(?:[-*]|\d+[.)])\s+(.*)$/);
        if (li)
          return (
            <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 2, margin: "2px 0" }}>
              <span style={{ color: "var(--accent-violet)", flex: "0 0 auto", fontWeight: 700 }}>
                •
              </span>
              <span style={{ minWidth: 0 }}>{bold(li[1])}</span>
            </div>
          );
        return (
          <div key={i} style={{ margin: "2px 0" }}>
            {bold(t)}
          </div>
        );
      })}
    </div>
  );
}

function pill(status: Status, loading: boolean): { label: string; chip: string; tone: string } {
  if (status === "ok") return { label: "Activo", chip: "chip--green", tone: "var(--accent-green)" };
  if (status === "error") return { label: "Error", chip: "chip--red", tone: "var(--accent-red)" };
  if (status === "warn")
    return { label: "Apagado", chip: "chip--amber", tone: "var(--accent-amber)" };
  return { label: loading ? "Verificando…" : "Sin verificar", chip: "", tone: "var(--text-3)" };
}

export function AiContactLensManager() {
  const { checks, loading, refetch } = useFeatureStatus();
  const { instanceUrl } = useConnectAuth();
  const ep = getApiEndpoints();

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ms: number; degraded?: boolean } | null>(
    null,
  );

  // Estado por pilar (del diagnóstico real).
  const statusOf = (id: string): Status => {
    const c = checks.find((x) => x.id === id);
    return (c?.status as Status) ?? "unknown";
  };
  const checkOf = (id: string) => checks.find((x) => x.id === id);

  const okCount = PILLARS.filter((p) => statusOf(p.id) === "ok").length;
  const errCount = PILLARS.filter((p) => statusOf(p.id) === "error").length;
  const availableCaps = useMemo(
    () => CAPABILITIES.filter((c) => c.deps.every((d) => statusOf(d) === "ok")).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checks],
  );

  const overall: { label: string; color: string } =
    errCount > 0
      ? { label: "Atención", color: "var(--accent-red)" }
      : okCount === PILLARS.length
        ? { label: "Operativo", color: "var(--accent-green)" }
        : checks.length === 0
          ? { label: loading ? "Verificando…" : "Sin datos", color: "var(--text-3)" }
          : { label: "Parcial", color: "var(--accent-amber)" };

  const bedrockLink = checkOf("bedrock")?.link;

  const ask = async (q: string) => {
    const query = q.trim();
    if (!query || asking || !ep?.generateCallSummary) return;
    setAsking(true);
    setAnswer(null);
    const t0 = performance.now();
    try {
      const r = await authedFetch(ep.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "assistant", question: query, history: [] }),
      });
      const d = await r.json();
      const ms = Math.round(performance.now() - t0);
      const text = (d.result || "").trim();
      setAnswer({ text, ms, degraded: !!d.degraded || !text });
    } catch {
      setAnswer({ text: "", ms: Math.round(performance.now() - t0), degraded: true });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
            IA y Contact Lens
          </div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 3, maxWidth: 660, lineHeight: 1.5 }}
          >
            Análisis conversacional, transcripciones y asistencia con IA generativa sobre tu Amazon
            Connect. El estado se lee <strong>en vivo</strong> de tu cuenta.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          {bedrockLink && (
            <button
              className="btn btn--sm"
              onClick={() => window.open(bedrockLink, "_blank", "noopener")}
            >
              <Icon.Sparkles size={13} /> Abrir Bedrock
            </button>
          )}
          <button className="btn btn--sm" onClick={refetch} disabled={loading}>
            <Icon.Refresh size={13} /> {loading ? "Verificando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14 }}>
        <Kpi
          label="Capacidades IA activas"
          value={
            <span>
              <span style={{ color: okCount > 0 ? "var(--accent-green)" : "var(--text-3)" }}>
                {okCount}
              </span>{" "}
              <span style={{ color: "var(--text-3)", fontSize: 18 }}>/ {PILLARS.length}</span>
            </span>
          }
          color="var(--accent-violet)"
        />
        <Kpi
          label="Estado general"
          value={<span style={{ color: overall.color }}>{overall.label}</span>}
          color={overall.color}
        />
        <Kpi
          label="Modelo de IA"
          value={<span style={{ fontSize: 17 }}>Claude Haiku 4.5</span>}
          color="var(--accent-violet)"
        />
        <Kpi
          label="Funciones potenciadas"
          value={
            <span>
              {availableCaps}{" "}
              <span style={{ color: "var(--text-3)", fontSize: 18 }}>/ {CAPABILITIES.length}</span>
            </span>
          }
          color="var(--accent-cyan)"
        />
      </div>

      {/* Pilares */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {PILLARS.map((p) => {
          const st = statusOf(p.id);
          const meta = PILLAR_META[p.id];
          const pl = pill(st, loading);
          const chk = checkOf(p.id);
          const on = st === "ok";
          return (
            <div
              key={p.id}
              style={{
                position: "relative",
                borderRadius: 12,
                border: "1px solid var(--border-1)",
                background: "var(--bg-1)",
                padding: "16px 18px",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  background: on ? meta.tone : "var(--border-1)",
                }}
              />
              <div className="row" style={{ gap: 11, alignItems: "center" }}>
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: meta.soft,
                    color: meta.tone,
                    flex: "0 0 auto",
                  }}
                >
                  <p.icon size={19} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 7, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{p.name}</span>
                    <span
                      className={`chip ${pl.chip}`}
                      style={pl.chip ? undefined : { color: "var(--text-3)" }}
                    >
                      <span
                        className="dot"
                        style={pl.chip ? undefined : { background: "var(--text-3)" }}
                      />{" "}
                      {pl.label}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
                    {p.blurb}
                  </div>
                </div>
              </div>

              {/* Qué potencia */}
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {p.powers.map((w) => (
                  <span
                    key={w}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-2)",
                      background: "var(--bg-2)",
                      border: "1px solid var(--border-1)",
                      borderRadius: 999,
                      padding: "3px 9px",
                    }}
                  >
                    {w}
                  </span>
                ))}
              </div>

              {/* Remediación si no está OK */}
              {!on && chk?.remediation && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border-1)",
                    fontSize: 11.5,
                    color: "var(--text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {chk.remediation}
                  {chk.link && (
                    <a
                      href={chk.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        color: "var(--accent-cyan)",
                        fontWeight: 700,
                        marginTop: 6,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Activar en mi consola <Icon.ChevRight size={12} />
                    </a>
                  )}
                </div>
              )}
              {!on && !chk && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid var(--border-1)",
                    fontSize: 11.5,
                    color: "var(--text-3)",
                  }}
                >
                  {loading
                    ? "Verificando el estado en tu cuenta…"
                    : "Pulsa Actualizar para verificar el estado."}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mapa de capacidades */}
      <Card>
        <CardBody>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Qué potencia la IA en ARIA</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Cada función se activa cuando su pilar está operativo.{" "}
                <span style={{ color: "var(--accent-green)" }}>●</span> disponible ·{" "}
                <span style={{ color: "var(--text-3)" }}>●</span> requiere activar un pilar.
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 10,
              marginTop: 14,
            }}
          >
            {CAPABILITIES.map((c) => {
              const avail = c.deps.every((d) => statusOf(d) === "ok");
              return (
                <div
                  key={c.name}
                  style={{
                    display: "flex",
                    gap: 11,
                    alignItems: "flex-start",
                    padding: "12px 14px",
                    borderRadius: 11,
                    border: "1px solid var(--border-1)",
                    background: "var(--bg-1)",
                    opacity: avail ? 1 : 0.72,
                  }}
                >
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: avail ? "var(--accent-violet-soft)" : "var(--bg-2)",
                      color: avail ? "var(--accent-violet)" : "var(--text-3)",
                      flex: "0 0 auto",
                      marginTop: 1,
                    }}
                  >
                    <c.icon size={16} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 7, alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: avail ? "var(--accent-green)" : "var(--text-3)",
                          flex: "0 0 auto",
                        }}
                      />
                    </div>
                    <div
                      className="muted"
                      style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}
                    >
                      {c.desc}
                    </div>
                    <div className="row" style={{ gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                      {c.deps.map((d) => {
                        const dp = PILLARS.find((x) => x.id === d)!;
                        const on = statusOf(d) === "ok";
                        return (
                          <span
                            key={d}
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: on ? PILLAR_META[d].tone : "var(--text-3)",
                              background: on ? PILLAR_META[d].soft : "var(--bg-2)",
                              borderRadius: 999,
                              padding: "2px 7px",
                            }}
                          >
                            {dp.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Probador del asistente IA */}
      <Card>
        <CardBody>
          <div className="row" style={{ gap: 9, alignItems: "center" }}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "var(--accent-violet-soft)",
                color: "var(--accent-violet)",
                flex: "0 0 auto",
              }}
            >
              <Icon.Sparkles size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Prueba el asistente IA</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Haz una pregunta — corre en vivo sobre tu Amazon Bedrock (Claude Haiku 4.5).
              </div>
            </div>
          </div>

          {/* Sugerencias */}
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 13 }}>
            {SAMPLES.map((s) => (
              <button
                key={s}
                className="btn btn--ghost btn--sm"
                style={{ fontSize: 11.5, fontWeight: 500 }}
                disabled={asking}
                onClick={() => {
                  setQuestion(s);
                  ask(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: "stretch" }}>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(question);
                }
              }}
              placeholder="Escribe una pregunta para el asistente…"
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--primary"
              onClick={() => ask(question)}
              disabled={asking || !question.trim() || !ep?.generateCallSummary}
            >
              {asking ? (
                "Pensando…"
              ) : (
                <>
                  <Icon.Send size={13} /> Probar
                </>
              )}
            </button>
          </div>

          {!ep?.generateCallSummary && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              El endpoint de IA todavía no está configurado en este entorno.
            </div>
          )}

          {/* Respuesta */}
          {(asking || answer) && (
            <div
              style={{
                marginTop: 14,
                borderRadius: 11,
                border: "1px solid var(--border-1)",
                background: "var(--bg-1)",
                padding: "14px 16px",
              }}
            >
              {asking ? (
                <div
                  className="muted"
                  style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Icon.Sparkles size={14} style={{ color: "var(--accent-violet)" }} /> El asistente
                  está pensando…
                </div>
              ) : answer && answer.text ? (
                <>
                  <RichText text={answer.text} />
                  <div
                    className="row"
                    style={{
                      gap: 7,
                      alignItems: "center",
                      marginTop: 11,
                      paddingTop: 10,
                      borderTop: "1px solid var(--border-1)",
                    }}
                  >
                    <span className="chip chip--green">
                      <span className="dot" /> Respuesta de Bedrock
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      <Icon.Clock size={11} style={{ verticalAlign: "-1px" }} /> {answer.ms} ms ·
                      Claude Haiku 4.5
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--accent-amber)", lineHeight: 1.5 }}>
                  El motor de IA no devolvió respuesta. Verifica que <strong>Amazon Bedrock</strong>{" "}
                  tenga habilitado el acceso a los modelos de Anthropic (arriba) en la región de tu
                  instancia.
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Nota de privacidad / cuenta */}
      <div
        className="muted"
        style={{ fontSize: 11, lineHeight: 1.5, display: "flex", gap: 7, alignItems: "flex-start" }}
      >
        <Icon.Shield size={13} style={{ flex: "0 0 auto", marginTop: 1 }} />
        <span>
          La IA generativa corre en <strong>tu</strong> cuenta de Amazon Bedrock (tu cuota, tus
          datos) cuando tienes Connect conectado.
          {instanceUrl && (
            <>
              {" "}
              Gestiona las features de análisis en la{" "}
              <a
                href={`${instanceUrl}/connect/contact-lens`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent-cyan)", fontWeight: 600 }}
              >
                consola de Connect
              </a>
              .
            </>
          )}
        </span>
      </div>
    </div>
  );
}
