import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, Mail, MessageCircle, Lightbulb } from "lucide-react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { useLeadOverview } from "@/hooks/useLeadOverview";
import { useCCP } from "@/hooks/useCCP";
import { getApiEndpoints } from "@/lib/api";
import { VALORACION_META, type DispositionStage } from "@/lib/dispositions";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import * as Icon from "@/components/vox/primitives";
import { Btn, Card, Icon as AIcon, Pill } from "@/components/aria";
import { ScheduleFollowupModal } from "@/components/workspace/ScheduleCallbackModal";

/**
 * Map a sub-stage id (from the disposition tree) to the channel of
 * follow-up the agent is implicitly committing to. Returning null
 * means the sub-stage is not a follow-up commitment (e.g.
 * "no_contesta", "se_inscribio") so we don't open the modal.
 *
 * The mapping reads the prefix from `volver_*` sub-stage ids:
 *   volver_llamar   → voice
 *   volver_correo   → email
 *   volver_whatsapp → whatsapp
 */
function followupChannelFor(subStageId: string | null): "voice" | "email" | "whatsapp" | null {
  if (!subStageId) return null;
  if (subStageId === "volver_llamar") return "voice";
  if (subStageId === "volver_correo") return "email";
  if (subStageId === "volver_whatsapp") return "whatsapp";
  return null;
}

/** Tolerant parse of the wrap-up-suggest result. Claude may wrap the JSON
 *  in fences or add a stray sentence; we strip and slice the first object. */
function parseSuggestion(raw: unknown): {
  stageId: string;
  subStageId: string;
  valoracion: string;
  confidence: number;
  reason: string;
} | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  try {
    const o = JSON.parse(text);
    if (!o || typeof o.stageId !== "string" || typeof o.subStageId !== "string") {
      return null;
    }
    return {
      stageId: o.stageId,
      subStageId: o.subStageId,
      valoracion: typeof o.valoracion === "string" ? o.valoracion : "",
      confidence:
        typeof o.confidence === "number" ? Math.max(0, Math.min(100, Math.round(o.confidence))) : 0,
      reason: typeof o.reason === "string" ? o.reason : "",
    };
  } catch {
    return null;
  }
}

/** Color for the confidence chip: green ≥75, amber 50-74, red <50. */
function confidenceColor(c: number): string {
  if (c >= 75) return "var(--accent-green)";
  if (c >= 50) return "var(--accent-amber)";
  return "var(--accent-red)";
}

// #21 Auto-resumen: textos de relleno que NO son un resumen real. Si el
// `summary` quedó en uno de estos (backend caído / sin transcript / Bedrock
// sin suscripción), no lo persistimos al salir del wrap-up.
const SUMMARY_UNAVAILABLE =
  "El resumen automático no está disponible para este contacto. Puedes redactarlo manualmente.";
const SUMMARY_NOT_READY = "El resumen no está disponible aún. Intenta regenerar en unos segundos.";
const SUMMARY_FAILED =
  "No se pudo generar el resumen automático. Puedes redactarlo manualmente o reintentar.";
const SUMMARY_PLACEHOLDERS = [SUMMARY_UNAVAILABLE, SUMMARY_NOT_READY, SUMMARY_FAILED];

/** True si `s` es un resumen real (no vacío y no un texto de relleno). */
function isRealSummary(s: string): boolean {
  const t = (s || "").trim();
  return t.length > 0 && !SUMMARY_PLACEHOLDERS.includes(t);
}

interface WrapUpViewProps {
  contactId: string;
  customerPhone: string | null;
  queueName?: string;
  durationSeconds: number;
  /** Optional channel of the contact being wrapped up. Used to localise the
   *  title and copy ("Cierre de chat" vs. "Cierre de llamada"). */
  channel?: string | null;
  onFinish: () => void;
  /** Demo / smoke-test escape hatch: seed the AI suggestion directly and
   *  skip the Lambda fetch. Used by /wrapup-demo to QA the suggestion UI
   *  without a live call. Production never sets this. */
  initialSuggestion?: {
    stageId: string;
    subStageId: string;
    valoracion: string;
    confidence: number;
    reason: string;
  };
}

const SUGGESTED_TAGS = ["FCR", "Reclamo", "Consulta", "Cobranza", "Soporte L1"];

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Próximas acciones sugeridas DERIVADAS de la disposición elegida — NO es
 * IA: es un set determinista a partir del sub-stage (los `volver_*` ya
 * declaran el canal del follow-up) y de la valoración de la etapa. Si no
 * hay nada que sugerir devuelve [] (el bloque se auto-oculta → degradado
 * honesto, no inventamos acciones).
 */
type NextAction = { icon: string; label: string; color: string };
function deriveNextActions(
  stage: DispositionStage | null,
  subStageId: string | null,
): NextAction[] {
  if (!stage) return [];
  const out: NextAction[] = [];
  // 1) El sub-stage `volver_*` compromete un canal de seguimiento concreto.
  if (subStageId === "volver_llamar")
    out.push({ icon: "phone", label: "Agendar rellamada", color: "var(--cyan)" });
  else if (subStageId === "volver_correo")
    out.push({ icon: "mail", label: "Programar correo de seguimiento", color: "var(--gold)" });
  else if (subStageId === "volver_whatsapp")
    out.push({ icon: "wa", label: "Enviar seguimiento por WhatsApp", color: "var(--green)" });
  // 2) Acciones por valoración de la etapa (comercialmente sensatas).
  if (stage.valoracion === "cierre") {
    out.push({ icon: "check", label: "Confirmar matrícula / pago", color: "var(--green)" });
  } else if (stage.valoracion === "positiva") {
    if (subStageId == null || !subStageId.startsWith("volver_"))
      out.push({ icon: "calendar", label: "Agendar próximo contacto", color: "var(--gold)" });
  } else if (stage.valoracion === "negativa") {
    out.push({ icon: "tag", label: "Registrar motivo de descarte", color: "var(--red)" });
  }
  // 3) Siempre: reflejar la etapa en el CRM (se hace al enviar).
  out.push({ icon: "tag", label: "Actualizar etapa en Salesforce", color: "var(--accent)" });
  // Dedup por label, tope de 4.
  const seen = new Set<string>();
  const dedup: NextAction[] = [];
  for (const a of out) {
    if (seen.has(a.label)) continue;
    seen.add(a.label);
    dedup.push(a);
    if (dedup.length >= 4) break;
  }
  return dedup;
}

/**
 * Wrap-up screen shown when a call ends and the agent moves into AfterCallWork.
 *
 * Disposition uses a 2-level tree (Stage → Sub Stage) loaded from
 * `lib/dispositions`. The default tree is the UDEP funnel; customers can
 * override it via `amplify_outputs.json.custom.dispositionTree`.
 *
 * On save the wrap-up payload is sent to `saveAgentNotes` AND pushed onto
 * the live contact as Contact Attributes (`stage`, `subStage`,
 * `valoracion`, `tags`) so they appear on the CTR + downstream analytics.
 */
export function WrapUpView({
  contactId,
  customerPhone,
  queueName,
  durationSeconds,
  channel,
  onFinish,
  initialSuggestion,
}: WrapUpViewProps) {
  const channelKey = (channel || "VOICE").toUpperCase();
  const isChat = channelKey === "CHAT";
  const isEmail = channelKey === "EMAIL";
  const isTask = channelKey === "TASK";
  const titleNoun = isChat ? "chat" : isEmail ? "email" : isTask ? "tarea" : "llamada";
  const { user } = useConnectAuth();
  const { profile } = useCustomerProfile(customerPhone);
  const { data: transcript } = useLiveTranscript(contactId);
  // Resumen del lead → etapa ACTUAL (último stageLabel del historial) + toques,
  // para mostrar el "antes → después" que produce la tipificación.
  const leadOv = useLeadOverview(customerPhone);
  const { agentName, setContactAttributes } = useCCP();

  // Unified taxonomy from DynamoDB (single source of truth across all
  // channels). Falls back to the static default while loading.
  const { tree, loading: treeLoading } = useTaxonomy();

  const [summary, setSummary] = useState<string>("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryEditable, setSummaryEditable] = useState(false);
  const [notes, setNotes] = useState("");
  const [stageId, setStageId] = useState<string | null>(null);
  const [subStageId, setSubStageId] = useState<string | null>(null);
  // AI-suggested tipificación (mode="wrap-up-suggest"). Auto-applied on
  // arrival if the agent hasn't picked anything yet; the agent can
  // override by clicking another stage, or re-apply from the banner.
  const [suggestion, setSuggestion] = useState<{
    stageId: string;
    subStageId: string;
    valoracion: string;
    confidence: number;
    reason: string;
  } | null>(initialSuggestion ?? null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState({
    task24h: true,
    emailConfirm: true,
    nps: false,
  });
  const [saving, setSaving] = useState(false);

  // #21 Auto-resumen post-conversación. Si el agente se va del wrap-up SIN
  // presionar "Enviar resumen" (cierra sin tipificar, o un contacto nuevo
  // desplaza la pantalla), persistimos el resumen ya generado para que
  // aparezca en el historial del cliente sin que el agente lo pida. Refs
  // porque el cleanup de desmontaje lee el último valor, no el del 1er render.
  const sentRef = useRef(false); // true tras un "Enviar resumen" exitoso
  const autoSavedRef = useRef(false); // evita doble POST (StrictMode/dev)
  const autoSaveRef = useRef({ summary: "", agentUsername: "" });
  autoSaveRef.current = { summary, agentUsername: user?.username || "" };
  useEffect(() => {
    // Solo corre al desmontar. Persiste el resumen una vez, best-effort.
    return () => {
      if (sentRef.current || autoSavedRef.current) return;
      const { summary: s, agentUsername: au } = autoSaveRef.current;
      if (!isRealSummary(s)) return; // vacío/placeholder → no guardar
      const endpoints = getApiEndpoints();
      if (!endpoints?.saveAgentNotes) return;
      autoSavedRef.current = true;
      // summaryOnly → el backend hace UpdateItem (no pisa tipificación previa).
      // keepalive para que el POST sobreviva al desmontaje/navegación.
      fetch(endpoints.saveAgentNotes, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          contactId,
          summary: s,
          agentUsername: au,
          channel: channelKey,
          summaryOnly: true,
        }),
      }).catch(() => {
        /* best-effort — el auto-resumen no debe romper nada */
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStage: DispositionStage | null = useMemo(
    () => tree.find((s) => s.id === stageId) ?? null,
    [tree, stageId],
  );
  const selectedSubStage = useMemo(
    () => selectedStage?.subStages.find((s) => s.id === subStageId) ?? null,
    [selectedStage, subStageId],
  );

  // Customer display
  const customerName =
    profile?.businessName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
    customerPhone ||
    "Cliente";

  // Sentiment derived from the transcript
  const sentimentLabel = useMemo(() => {
    if (!transcript?.overallSentiment) return null;
    const s = String(transcript.overallSentiment).toUpperCase();
    if (s === "POSITIVE") return { label: "positivo", color: "var(--accent-green)" };
    if (s === "NEGATIVE") return { label: "negativo", color: "var(--accent-red)" };
    return { label: "neutro", color: "var(--text-2)" };
  }, [transcript?.overallSentiment]);

  // Auto-fetch the Q summary on mount. Falls back gracefully if the
  // backend isn't reachable, the contact has no transcript yet, or the
  // Bedrock model is unsubscribed — without leaking 5xxs to the console.
  const fetchSummary = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary || !contactId) return;
    setSummaryLoading(true);
    try {
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, mode: "wrap-up" }),
      });
      // Don't throw on non-2xx — just degrade to a friendly placeholder.
      if (!r.ok) {
        setSummary(SUMMARY_UNAVAILABLE);
        return;
      }
      const data = await r.json().catch(() => ({}));
      const text = data?.summary || data?.text || SUMMARY_NOT_READY;
      setSummary(text);
    } catch {
      setSummary(SUMMARY_FAILED);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // ── AI auto-classification ────────────────────────────────────────────
  // Ship the active taxonomy + ask Claude to pick the best stage/subStage.
  // We auto-apply the pick only if the agent hasn't selected anything yet,
  // so we never overwrite a manual choice.
  const fetchSuggestion = async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary || !contactId) return;
    setSuggestionLoading(true);
    try {
      const compactTaxonomy = tree.map((s) => ({
        id: s.id,
        label: s.label,
        valoracion: s.valoracion,
        description: s.description,
        subStages: s.subStages.map((ss) => ({ id: ss.id, label: ss.label })),
      }));
      const r = await fetch(endpoints.generateCallSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          mode: "wrap-up-suggest",
          taxonomy: compactTaxonomy,
        }),
      });
      if (!r.ok) return;
      const data = await r.json().catch(() => ({}));
      const parsed = parseSuggestion(data.result);
      if (!parsed) return;
      // Validate the pick against the real tree — guard against a model
      // hallucinating an id that doesn't exist.
      const stage = tree.find((s) => s.id === parsed.stageId);
      const sub = stage?.subStages.find((ss) => ss.id === parsed.subStageId);
      if (!stage || !sub) return;
      setSuggestion(parsed);
      // Auto-apply only if the agent hasn't touched the picker.
      setStageId((curr) => {
        if (curr === null) {
          setSubStageId(parsed.subStageId);
          return parsed.stageId;
        }
        return curr;
      });
    } catch {
      /* silent — suggestion is best-effort */
    } finally {
      setSuggestionLoading(false);
    }
  };

  // Fire the suggestion ONCE, and only after the taxonomy has loaded — so
  // the tree we ship to the Lambda is the real canonical one, not the
  // transient fallback.
  const suggestFiredRef = useRef(false);
  useEffect(() => {
    // Demo seed: auto-apply the injected suggestion, skip the Lambda.
    if (initialSuggestion) {
      setStageId((curr) => {
        if (curr === null) {
          setSubStageId(initialSuggestion.subStageId);
          return initialSuggestion.stageId;
        }
        return curr;
      });
      return;
    }
    if (treeLoading || suggestFiredRef.current) return;
    suggestFiredRef.current = true;
    fetchSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, treeLoading]);

  const applySuggestion = () => {
    if (!suggestion) return;
    setStageId(suggestion.stageId);
    setSubStageId(suggestion.subStageId);
    setSuggestionDismissed(false);
  };

  const addTag = (t: string) => {
    if (!tags.includes(t)) setTags((curr) => [...curr, t]);
  };
  const removeTag = (t: string) => {
    setTags((curr) => curr.filter((x) => x !== t));
  };

  // Detect whether the chosen sub-stage commits the agent to a
  // follow-up. If so, after Enviar we open the Schedule Follow-up
  // modal with the channel pre-decided.
  const followupChannel = useMemo(() => followupChannelFor(subStageId), [subStageId]);
  const [followupOpen, setFollowupOpen] = useState(false);

  const canSend = !!stageId && !!subStageId;

  const handleSend = async () => {
    if (!canSend || !selectedStage || !selectedSubStage) {
      toast.error("Selecciona un Stage y Sub Stage antes de enviar");
      return;
    }
    setSaving(true);
    const endpoints = getApiEndpoints();
    // saveAgentNotes uses `notes` (not `note`) — the old payload was
    // silently dropping the textarea content because of this typo. Also
    // include customerPhone so the Lambda can spawn the follow-up task
    // with the right customer reference.
    const payload = {
      contactId,
      agentUsername: user?.username || "",
      notes,
      summary,
      stage: selectedStage.id,
      stageLabel: selectedStage.label,
      subStage: selectedSubStage.id,
      subStageLabel: selectedSubStage.label,
      valoracion: selectedStage.valoracion,
      tags,
      followUps,
      customerPhone,
      // Channel of the contact being wrapped up — lets reports slice
      // tipificación by voice/chat/whatsapp/email under ONE taxonomy.
      channel: channelKey,
    };
    try {
      if (endpoints?.saveAgentNotes) {
        const r = await fetch(endpoints.saveAgentNotes, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await r.json().catch(() => ({}));
        if (Array.isArray(json.followUpTaskIds) && json.followUpTaskIds.length > 0) {
          toast.success(`Tarea follow-up creada (${json.followUpTaskIds.length}) · llegará en 24h`);
        }
      }
      // Also push to Amazon Connect Contact Attributes so the CTR carries
      // stage / sub-stage / valoración for analytics + Contact Lens search.
      setContactAttributes({
        stage: selectedStage.label,
        subStage: selectedSubStage.label,
        valoracion: selectedStage.valoracion,
        tags: tags.join(", "),
        wrapUpAgent: user?.username || "",
      });

      // Vox → Salesforce: push the gestión to SF (upsert Lead + Task),
      // mapping this stage's salesforceValue to Lead Status. Fire-and-forget
      // so a slow/unconfigured SF never blocks closing the contact.
      if (endpoints?.salesforceSync) {
        const sfBody = {
          customerPhone,
          customerName,
          email: profile?.email ?? undefined,
          company: profile?.businessName ?? undefined,
          leadStatus: selectedStage.salesforceValue || undefined,
          stageLabel: selectedStage.label,
          subStageLabel: selectedSubStage.label,
          valoracion: selectedStage.valoracion,
          notes,
          summary,
          agentUsername: user?.username || "",
          contactId,
          // Canal del contacto → cómo se registra la actividad en SF (CHAT aquí = WhatsApp).
          channel: channelKey === "CHAT" ? "WhatsApp" : channelKey,
        };
        fetch(endpoints.salesforceSync, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sfBody),
        }).catch(() => {
          /* best-effort — SF sync failures must not affect wrap-up */
        });
      }

      // #21: el resumen ya quedó persistido por este envío — no re-guardar
      // al desmontar.
      sentRef.current = true;
      toast.success(`Lead actualizado · ${selectedStage.label}`, {
        description:
          currentStageLabel && currentStageLabel !== selectedStage.label
            ? `Etapa: ${currentStageLabel} → ${selectedStage.label} · toque #${leadTouches + 1}`
            : `${selectedSubStage.label} · toque #${leadTouches + 1}`,
      });
      // If the sub-stage commits to a follow-up, open the schedule
      // modal instead of finishing — the agent still needs to pick
      // WHEN (and refine the content for email/whatsapp). Closing the
      // modal proceeds to onFinish.
      if (followupChannel) {
        setFollowupOpen(true);
      } else {
        onFinish();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setSaving(false);
    }
  };

  // Nota: la interacción "sin tipificar" se registra AUTOMÁTICAMENTE al terminar
  // el contacto (en el escritorio), así que aquí solo cerramos — no re-registramos.

  // Próximas acciones sugeridas — derivadas de la etapa/sub-stage elegidos
  // (determinista, NO IA). Cálculo directo (sin useMemo con for-return, que
  // rompe el gate de memoización del React Compiler).
  const nextActions = deriveNextActions(selectedStage, subStageId);

  // Impacto en el lead: etapa ACTUAL (último stageLabel del historial; recent[0]
  // es el evento más nuevo) → etapa NUEVA (la tipificación elegida). Se recalcula
  // en vivo al cambiar la selección para que el agente VEA cómo queda el lead.
  const currentStageLabel = leadOv.history?.recent.find((e) => e.stageLabel)?.stageLabel ?? null;
  const leadTouches = leadOv.history?.count ?? 0;
  const valTone: "green" | "gold" | "red" | "outline" = selectedStage
    ? selectedStage.valoracion === "negativa"
      ? "red"
      : selectedStage.valoracion === "cierre" || selectedStage.valoracion === "positiva"
        ? "green"
        : "outline"
    : "outline";

  return (
    <div className="view fadeup">
      <div className="view__head">
        <div>
          <div className="view__crumb">
            <span>Wrap-up</span> · <span className="mono">{contactId.slice(0, 8)}…</span>
          </div>
          <h1 className="view__title">Cierre de {titleNoun}</h1>
          <div className="view__sub">
            {fmtDuration(durationSeconds)} con <strong>{customerName}</strong>
            {queueName ? <> · {queueName}</> : null}
            {" · "}
            {summaryLoading ? "Generando resumen…" : "Resumen IA listo (editable)"}
          </div>
        </div>
        <div className="view__actions" style={{ alignItems: "center", gap: 10 }}>
          <span
            className="muted"
            style={{ fontSize: 11.5, flex: 1, textAlign: "left", minWidth: 0 }}
          >
            Tipifica para registrar la gestión. Si cierras sin tipificar, la llamada queda como{" "}
            <strong style={{ color: "var(--accent-amber)" }}>sin tipificar</strong> (pendiente de
            seguimiento).
          </span>
          <button
            className="btn"
            onClick={onFinish}
            title="Cierra sin tipificar — la llamada ya quedó registrada como 'sin tipificar' (pendiente) en el lead"
            style={{ borderColor: "var(--accent-amber)", color: "var(--accent-amber)" }}
          >
            Cerrar sin tipificar
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSend}
            disabled={saving || !canSend}
            title={canSend ? "Enviar resumen" : "Selecciona Stage y Sub Stage para habilitar"}
          >
            <Icon.Check size={14} /> {saving ? "Enviando…" : "Guardar y cerrar"}
          </button>
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}
      >
        <div className="col" style={{ gap: 16 }}>
          {/* Resumen de la llamada — duración real + sentiment (Contact Lens)
              + resumen IA real (Bedrock). Reusa el mismo estado/fetch. */}
          <Card title="Resumen de la llamada" icon="sparkle" accent="var(--iris)">
            <div className="row gap16" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <div
                  className="dim"
                  style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}
                >
                  Duración
                </div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                  {fmtDuration(durationSeconds)}
                </div>
              </div>
              <div>
                <div
                  className="dim"
                  style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}
                >
                  Sentiment
                </div>
                {sentimentLabel ? (
                  <Pill
                    tone={
                      sentimentLabel.label === "positivo"
                        ? "green"
                        : sentimentLabel.label === "negativo"
                          ? "red"
                          : "outline"
                    }
                  >
                    {sentimentLabel.label}
                  </Pill>
                ) : (
                  <span className="dim" style={{ fontSize: 12.5 }}>
                    Sin datos
                  </span>
                )}
              </div>
              <div style={{ marginLeft: "auto" }}>
                <Pill tone="iris" icon="sparkle">
                  Contact Lens
                </Pill>
              </div>
            </div>
            {summaryEditable ? (
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 132,
                  background: "var(--iris-soft)",
                  border: "1px solid color-mix(in srgb,var(--iris) 40%,transparent)",
                  borderRadius: "var(--r-md)",
                  padding: 14,
                  color: "var(--text-1)",
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              />
            ) : (
              <div
                className="tl__note"
                style={{ margin: 0, minHeight: 72, lineHeight: 1.6, fontSize: 13 }}
              >
                {summaryLoading ? "Generando resumen…" : summary || "Sin resumen disponible."}
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <Btn
                variant="soft"
                size="sm"
                icon="refresh"
                onClick={fetchSummary}
                disabled={summaryLoading}
              >
                Regenerar
              </Btn>
              <Btn variant="ghost" size="sm" onClick={() => setSummaryEditable((v) => !v)}>
                {summaryEditable ? "Listo" : "Editar"}
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                icon="copy"
                onClick={() => {
                  navigator.clipboard?.writeText(summary).catch(() => {});
                  toast.success("Resumen copiado");
                }}
                disabled={!summary}
              >
                Copiar
              </Btn>
            </div>
          </Card>

          {/* Impacto en el lead — cómo queda tras la tipificación: etapa
              actual → nueva, resultado, toque, y estado de Salesforce. Se
              actualiza EN VIVO al cambiar la selección (el agente ve el cambio
              antes de guardar). Placeholder honesto si aún no hay tipificación. */}
          <Card title="Cómo queda el lead" icon="target" iconColor="var(--green)">
            {selectedStage ? (
              <div className="col gap10" style={{ fontSize: 13 }}>
                <div className="row between" style={{ alignItems: "center" }}>
                  <span className="dim">Etapa</span>
                  <span className="row gap8" style={{ alignItems: "center" }}>
                    {currentStageLabel && (
                      <>
                        <span className="pill pill--outline" style={{ opacity: 0.7 }}>
                          {currentStageLabel}
                        </span>
                        <AIcon name="arrowRight" size={14} style={{ color: "var(--text-3)" }} />
                      </>
                    )}
                    <Pill tone={valTone}>{selectedStage.label}</Pill>
                  </span>
                </div>
                {selectedSubStage && (
                  <div className="row between" style={{ alignItems: "center" }}>
                    <span className="dim">Resultado</span>
                    <b>{selectedSubStage.label}</b>
                  </div>
                )}
                <div className="row between" style={{ alignItems: "center" }}>
                  <span className="dim">Toques</span>
                  <span className="mono">
                    {leadTouches} → <b style={{ color: "var(--green)" }}>{leadTouches + 1}</b>
                  </span>
                </div>
                {selectedStage.salesforceValue && (
                  <div className="row between" style={{ alignItems: "center" }}>
                    <span className="dim">Salesforce · Estado</span>
                    <b>{selectedStage.salesforceValue}</b>
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="row between" style={{ alignItems: "flex-start" }}>
                    <span className="dim">Tags</span>
                    <span
                      className="row gap4 wrap"
                      style={{ justifyContent: "flex-end", maxWidth: "68%" }}
                    >
                      {tags.map((t) => (
                        <Pill key={t} tone="cyan">
                          {t}
                        </Pill>
                      ))}
                    </span>
                  </div>
                )}
                <div
                  className="tl__note"
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <AIcon
                    name="check"
                    size={13}
                    style={{ color: "var(--green)", flex: "0 0 auto", marginTop: 1 }}
                  />
                  <span>
                    Al <b>guardar</b>, la gestión se registra en el lead (etapa, resultado, toque) y
                    se sincroniza con Salesforce.
                  </span>
                </div>
              </div>
            ) : (
              <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                Elige una tipificación (Stage → Sub Stage) a la derecha y verás aquí cómo queda el
                lead: nueva etapa, resultado y qué se sincroniza con Salesforce.
              </div>
            )}
          </Card>

          {/* Próximas acciones sugeridas — derivadas de la disposición. Se
              auto-oculta si aún no hay una etapa elegida (degradado honesto:
              no inventamos acciones sin base). */}
          {nextActions.length > 0 && (
            <Card title="Próximas acciones sugeridas" icon="target">
              <div className="col gap8">
                {nextActions.map((a) => (
                  <div
                    key={a.label}
                    className="row gap11"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid var(--border-1)",
                      borderRadius: "var(--r-md)",
                      background: "var(--bg-2)",
                    }}
                  >
                    <div
                      className="tl__ico"
                      style={{ ["--_c" as string]: a.color, width: 30, height: 30 }}
                    >
                      <AIcon name={a.icon} size={15} />
                    </div>
                    <span className="grow" style={{ fontSize: 13 }}>
                      {a.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="dim" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.45 }}>
                Sugerencias derivadas de la tipificación elegida. Se ejecutan al guardar (la etapa
                se refleja en Salesforce; los seguimientos abren el modal de agenda).
              </div>
            </Card>
          )}

          {/* Notas del agente */}
          <Card
            title="Notas del agente"
            icon="fileText"
            extra={
              <span className="dim" style={{ fontSize: 11 }}>
                {agentName || user?.username}
              </span>
            }
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas internas sobre la llamada…"
              style={{
                width: "100%",
                minHeight: 108,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-md)",
                padding: 12,
                color: "var(--text-1)",
                resize: "vertical",
                outline: "none",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
              }}
            />
          </Card>
        </div>

        <div className="col" style={{ gap: 16 }}>
          {/* Paso handoff — "Tipificar y cerrar" (encabezado del flujo de
              cierre; las tarjetas de abajo mantienen la lógica real). */}
          <div className="wstep">
            <span
              className="wstep__n"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              <AIcon name="check" size={14} />
            </span>
            <div className="grow">
              <b style={{ fontSize: 13.5 }}>Tipificar y cerrar</b>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 1 }}>
                Elige Stage y Sub Stage para registrar la gestión.
              </div>
            </div>
          </div>

          {/* Disposition — Stage → Sub Stage */}
          <div className="card">
            <div className="card__head">
              <div className="card__title">Tipificación · Stage</div>
              {suggestionLoading && !suggestion ? (
                <span className="chip chip--violet" style={{ height: 18, fontSize: 10 }}>
                  <Icon.Sparkles size={10} /> IA analizando…
                </span>
              ) : selectedStage ? (
                <span className={`chip ${VALORACION_META[selectedStage.valoracion].chip}`}>
                  <span className="dot" />
                  {VALORACION_META[selectedStage.valoracion].label}
                </span>
              ) : null}
            </div>
            <div className="card__body" style={{ display: "grid", gap: 6 }}>
              {/* AI suggestion banner — shows the pick + confidence + reason.
                  Auto-applied on arrival; banner lets the agent re-apply or
                  dismiss. Stays visible (even after manual override) so the
                  agent can always fall back to the AI pick. */}
              {suggestion &&
                !suggestionDismissed &&
                (() => {
                  const sgStage = tree.find((s) => s.id === suggestion.stageId);
                  const sgSub = sgStage?.subStages.find((ss) => ss.id === suggestion.subStageId);
                  const matches =
                    stageId === suggestion.stageId && subStageId === suggestion.subStageId;
                  return (
                    <div
                      style={{
                        border: "1px solid var(--accent-violet)",
                        background: "var(--accent-violet-soft)",
                        borderRadius: 8,
                        padding: "9px 10px",
                        marginBottom: 4,
                      }}
                    >
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <Icon.Sparkles size={13} style={{ color: "var(--accent-violet)" }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                          IA sugiere
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: confidenceColor(suggestion.confidence),
                            border: `1px solid ${confidenceColor(suggestion.confidence)}`,
                            borderRadius: 999,
                            padding: "1px 7px",
                          }}
                        >
                          {suggestion.confidence}%
                        </span>
                        <Icon.Close
                          size={13}
                          style={{ marginLeft: "auto", opacity: 0.5, cursor: "pointer" }}
                          onClick={() => setSuggestionDismissed(true)}
                        />
                      </div>
                      <div style={{ fontSize: 12.5, marginTop: 5, color: "var(--text-1)" }}>
                        <strong>{sgStage?.label}</strong>
                        {sgSub ? <> › {sgSub.label}</> : null}
                        {matches && (
                          <span
                            className="chip chip--green"
                            style={{ height: 16, fontSize: 9.5, marginLeft: 6 }}
                          >
                            aplicado
                          </span>
                        )}
                      </div>
                      {suggestion.reason && (
                        <div
                          className="muted"
                          style={{ fontSize: 11, marginTop: 4, lineHeight: 1.45 }}
                        >
                          “{suggestion.reason}”
                        </div>
                      )}
                      {!matches && (
                        <button
                          className="btn btn--sm btn--primary"
                          style={{ marginTop: 8 }}
                          onClick={applySuggestion}
                        >
                          <Icon.Check size={11} /> Aplicar sugerencia
                        </button>
                      )}
                    </div>
                  );
                })()}
              {tree.map((stage) => {
                const isSelected = stage.id === stageId;
                const valChip = VALORACION_META[stage.valoracion].chip;
                return (
                  <label
                    key={stage.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 10px",
                      borderRadius: 6,
                      background: isSelected ? "var(--bg-active)" : "transparent",
                      cursor: "pointer",
                      border: "1px solid var(--border-1)",
                    }}
                  >
                    <input
                      type="radio"
                      checked={isSelected}
                      onChange={() => {
                        setStageId(stage.id);
                        setSubStageId(null);
                      }}
                      style={{ accentColor: "var(--accent-amber)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{stage.label}</div>
                      {stage.description && (
                        <div className="muted truncate" style={{ fontSize: 11, marginTop: 2 }}>
                          {stage.description}
                        </div>
                      )}
                    </div>
                    {suggestion?.stageId === stage.id && (
                      <span
                        className="chip chip--violet"
                        style={{ height: 18, fontSize: 9.5 }}
                        title="Sugerido por IA"
                      >
                        <Icon.Sparkles size={9} /> IA
                      </span>
                    )}
                    <span className={`chip ${valChip}`} style={{ height: 18, fontSize: 10 }}>
                      {stage.valoracion}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Sub stage picker (appears only after a stage is chosen) */}
          {selectedStage && (
            <div className="card">
              <div className="card__head">
                <div className="card__title">Sub Stage · {selectedStage.label}</div>
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {selectedStage.subStages.length} opciones
                </span>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 6 }}>
                {selectedStage.subStages.map((sub) => {
                  const isSelected = sub.id === subStageId;
                  const followCh = followupChannelFor(sub.id);
                  const ChipIcon =
                    followCh === "voice"
                      ? Phone
                      : followCh === "email"
                        ? Mail
                        : followCh === "whatsapp"
                          ? MessageCircle
                          : null;
                  return (
                    <label
                      key={sub.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: isSelected ? "var(--bg-active)" : "transparent",
                        cursor: "pointer",
                        border: "1px solid var(--border-1)",
                      }}
                    >
                      <input
                        type="radio"
                        checked={isSelected}
                        onChange={() => setSubStageId(sub.id)}
                        style={{ accentColor: "var(--accent-amber)" }}
                      />
                      <span style={{ flex: 1, fontSize: 13 }}>{sub.label}</span>
                      {suggestion?.subStageId === sub.id && suggestion?.stageId === stageId && (
                        <span
                          className="chip chip--violet"
                          style={{ height: 18, fontSize: 9.5 }}
                          title="Sugerido por IA"
                        >
                          <Icon.Sparkles size={9} /> IA
                        </span>
                      )}
                      {ChipIcon && (
                        <span
                          className="chip chip--cyan"
                          style={{ height: 18, fontSize: 10 }}
                          title="Al enviar se abrirá el modal de Agendar follow-up"
                        >
                          <ChipIcon size={10} /> agendar
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {followupChannel && (
                <div
                  className="muted"
                  style={{
                    padding: "8px 10px",
                    fontSize: 11,
                    lineHeight: 1.5,
                    background: "var(--accent-cyan-soft)",
                    color: "var(--accent-cyan)",
                    borderTop: "1px solid var(--border-1)",
                  }}
                >
                  <Lightbulb size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  Al hacer <strong>Enviar resumen</strong> te abriremos el modal de Agendar
                  follow-up para que pongas la fecha/hora.
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          <div className="card">
            <div className="card__head">
              <div className="card__title">Tags</div>
              <span className="chip chip--violet">
                <Icon.Sparkles size={11} /> Q sugiere
              </span>
            </div>
            <div className="card__body">
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {tags.length === 0 && (
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Sin tags aún. Agrega desde las sugerencias.
                  </span>
                )}
                {tags.map((t) => (
                  <span key={t} className="chip chip--cyan">
                    {t}{" "}
                    <Icon.Close
                      size={11}
                      style={{ opacity: 0.6, cursor: "pointer" }}
                      onClick={() => removeTag(t)}
                    />
                  </span>
                ))}
              </div>
              <div className="divider" />
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                Sugerencias:
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).map((t) => (
                  <button key={t} className="chip" onClick={() => addTag(t)}>
                    <Icon.Plus size={10} /> {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Follow-ups */}
          <div className="card">
            <div className="card__head">
              <div className="card__title">Follow-ups</div>
            </div>
            <div className="card__body">
              <label className="row" style={{ padding: "8px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={followUps.task24h}
                  onChange={(e) => setFollowUps((f) => ({ ...f, task24h: e.target.checked }))}
                  style={{ accentColor: "var(--accent-amber)" }}
                />
                <span style={{ fontSize: 13 }}>Crear tarea de follow-up en 24h</span>
              </label>
              <label className="row" style={{ padding: "8px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={followUps.emailConfirm}
                  onChange={(e) => setFollowUps((f) => ({ ...f, emailConfirm: e.target.checked }))}
                  style={{ accentColor: "var(--accent-amber)" }}
                />
                <span style={{ fontSize: 13 }}>Enviar email con confirmación</span>
              </label>
              <label className="row" style={{ padding: "8px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={followUps.nps}
                  onChange={(e) => setFollowUps((f) => ({ ...f, nps: e.target.checked }))}
                  style={{ accentColor: "var(--accent-amber)" }}
                />
                <span style={{ fontSize: 13 }}>Programar encuesta NPS</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule follow-up modal — opens after the wrap-up is sent
          IF the sub-stage was one of "volver_*". The agent picks the
          actual when/content here. Closing the modal proceeds to
          onFinish so the wrap-up screen unmounts. */}
      <ScheduleFollowupModal
        open={followupOpen}
        onClose={() => {
          setFollowupOpen(false);
          onFinish();
        }}
        phone={customerPhone}
        customerName={customerName}
        customerEmail={profile?.email ?? null}
        assignedAgentUserId={user?.userId || ""}
        defaultChannel={followupChannel || "voice"}
        defaultNotes={notes}
        onScheduled={() => {
          // Modal will call onClose after scheduling, which triggers
          // onFinish above. Toast already fired from the modal.
        }}
      />
    </div>
  );
}
