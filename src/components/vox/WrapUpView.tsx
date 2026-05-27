import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { useCCP } from "@/hooks/useCCP";
import { getApiEndpoints } from "@/lib/api";
import {
  getDispositionTree,
  VALORACION_META,
  type DispositionStage,
} from "@/lib/dispositions";
import * as Icon from "@/components/vox/primitives";
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
function followupChannelFor(
  subStageId: string | null
): "voice" | "email" | "whatsapp" | null {
  if (!subStageId) return null;
  if (subStageId === "volver_llamar") return "voice";
  if (subStageId === "volver_correo") return "email";
  if (subStageId === "volver_whatsapp") return "whatsapp";
  return null;
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
}

const SUGGESTED_TAGS = ["FCR", "Reclamo", "Consulta", "Cobranza", "Soporte L1"];

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
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
}: WrapUpViewProps) {
  const channelKey = (channel || "VOICE").toUpperCase();
  const isChat = channelKey === "CHAT";
  const isEmail = channelKey === "EMAIL";
  const isTask = channelKey === "TASK";
  const titleNoun = isChat
    ? "chat"
    : isEmail
    ? "email"
    : isTask
    ? "tarea"
    : "llamada";
  const { user } = useConnectAuth();
  const { profile } = useCustomerProfile(customerPhone);
  const { data: transcript } = useLiveTranscript(contactId);
  const { agentName, setContactAttributes } = useCCP();

  const tree = useMemo(() => getDispositionTree(), []);

  const [summary, setSummary] = useState<string>("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryEditable, setSummaryEditable] = useState(false);
  const [notes, setNotes] = useState("");
  const [stageId, setStageId] = useState<string | null>(null);
  const [subStageId, setSubStageId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState({
    task24h: true,
    emailConfirm: true,
    nps: false,
  });
  const [saving, setSaving] = useState(false);

  const selectedStage: DispositionStage | null = useMemo(
    () => tree.find((s) => s.id === stageId) ?? null,
    [tree, stageId]
  );
  const selectedSubStage = useMemo(
    () => selectedStage?.subStages.find((s) => s.id === subStageId) ?? null,
    [selectedStage, subStageId]
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
        setSummary(
          "El resumen automático no está disponible para este contacto. Puedes redactarlo manualmente."
        );
        return;
      }
      const data = await r.json().catch(() => ({}));
      const text =
        data?.summary ||
        data?.text ||
        "El resumen no está disponible aún. Intenta regenerar en unos segundos.";
      setSummary(text);
    } catch {
      setSummary(
        "No se pudo generar el resumen automático. Puedes redactarlo manualmente o reintentar."
      );
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const addTag = (t: string) => {
    if (!tags.includes(t)) setTags((curr) => [...curr, t]);
  };
  const removeTag = (t: string) => {
    setTags((curr) => curr.filter((x) => x !== t));
  };

  // Detect whether the chosen sub-stage commits the agent to a
  // follow-up. If so, after Enviar we open the Schedule Follow-up
  // modal with the channel pre-decided.
  const followupChannel = useMemo(
    () => followupChannelFor(subStageId),
    [subStageId]
  );
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
          toast.success(
            `Tarea follow-up creada (${json.followUpTaskIds.length}) · llegará en 24h`
          );
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
      toast.success("Wrap-up enviado");
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

  return (
    <div className="view" style={{ maxWidth: 1200 }}>
      <div className="view__head">
        <div>
          <div className="view__crumb">
            <span>Wrap-up</span> ·{" "}
            <span className="mono">{contactId.slice(0, 8)}…</span>
          </div>
          <h1 className="view__title">Cierre de {titleNoun}</h1>
          <div className="view__sub">
            {fmtDuration(durationSeconds)} con <strong>{customerName}</strong>
            {queueName ? <> · {queueName}</> : null}
            {" · "}
            {summaryLoading
              ? "Q está generando el resumen…"
              : "Q ya generó un borrador del resumen"}
          </div>
        </div>
        <div className="view__actions">
          <button className="btn" onClick={onFinish}>
            Guardar borrador
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSend}
            disabled={saving || !canSend}
            title={
              canSend
                ? "Enviar resumen"
                : "Selecciona Stage y Sub Stage para habilitar"
            }
          >
            <Icon.Check size={14} /> {saving ? "Enviando…" : "Enviar resumen"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div className="col" style={{ gap: 16 }}>
          {/* Q-generated summary */}
          <div className="card">
            <div className="card__head">
              <div className="card__title">Resumen generado por Q</div>
              <span className="chip chip--violet">
                <Icon.Sparkles size={11} /> Contact Lens
              </span>
            </div>
            <div className="card__body">
              {summaryEditable ? (
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 140,
                    background: "var(--accent-violet-soft)",
                    border: "1px solid var(--accent-violet)",
                    borderRadius: 8,
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
                  style={{
                    background: "var(--accent-violet-soft)",
                    padding: 14,
                    borderRadius: 8,
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--text-1)",
                    minHeight: 80,
                  }}
                >
                  {summaryLoading
                    ? "Generando resumen…"
                    : summary || "Sin resumen disponible."}
                  {sentimentLabel && !summaryLoading && (
                    <>
                      {" "}
                      <strong>
                        Sentiment final:{" "}
                        <span style={{ color: sentimentLabel.color }}>
                          {sentimentLabel.label}
                        </span>
                        .
                      </strong>
                    </>
                  )}
                </div>
              )}
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn--sm"
                  onClick={fetchSummary}
                  disabled={summaryLoading}
                >
                  <Icon.Refresh size={12} />
                  Regenerar
                </button>
                <button
                  className="btn btn--sm"
                  onClick={() => setSummaryEditable((v) => !v)}
                >
                  {summaryEditable ? "Listo" : "Editar"}
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(summary).catch(() => {});
                    toast.success("Resumen copiado");
                  }}
                  disabled={!summary}
                >
                  Copiar
                </button>
              </div>
            </div>
          </div>

          {/* Agent notes */}
          <div className="card">
            <div className="card__head">
              <div className="card__title">Notas del agente</div>
              <span className="muted" style={{ fontSize: 11 }}>
                {agentName || user?.username}
              </span>
            </div>
            <div className="card__body">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas internas sobre la llamada…"
                style={{
                  width: "100%",
                  minHeight: 120,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  padding: 12,
                  color: "var(--text-1)",
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                }}
              />
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          {/* Disposition — Stage → Sub Stage */}
          <div className="card">
            <div className="card__head">
              <div className="card__title">Tipificación · Stage</div>
              {selectedStage && (
                <span className={`chip ${VALORACION_META[selectedStage.valoracion].chip}`}>
                  <span className="dot" />
                  {VALORACION_META[selectedStage.valoracion].label}
                </span>
              )}
            </div>
            <div className="card__body" style={{ display: "grid", gap: 6 }}>
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
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {stage.label}
                      </div>
                      {stage.description && (
                        <div
                          className="muted truncate"
                          style={{ fontSize: 11, marginTop: 2 }}
                        >
                          {stage.description}
                        </div>
                      )}
                    </div>
                    <span
                      className={`chip ${valChip}`}
                      style={{ height: 18, fontSize: 10 }}
                    >
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
                <div className="card__title">
                  Sub Stage · {selectedStage.label}
                </div>
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {selectedStage.subStages.length} opciones
                </span>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 6 }}>
                {selectedStage.subStages.map((sub) => {
                  const isSelected = sub.id === subStageId;
                  const followCh = followupChannelFor(sub.id);
                  const chipIcon =
                    followCh === "voice"
                      ? "📞"
                      : followCh === "email"
                      ? "📧"
                      : followCh === "whatsapp"
                      ? "💬"
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
                      {chipIcon && (
                        <span
                          className="chip chip--cyan"
                          style={{ height: 18, fontSize: 10 }}
                          title="Al enviar se abrirá el modal de Agendar follow-up"
                        >
                          {chipIcon} agendar
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
                  💡 Al hacer{" "}
                  <strong>Enviar resumen</strong> te abriremos el modal de
                  Agendar follow-up para que pongas la fecha/hora.
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
                  <button
                    key={t}
                    className="chip"
                    onClick={() => addTag(t)}
                  >
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
                  onChange={(e) =>
                    setFollowUps((f) => ({ ...f, task24h: e.target.checked }))
                  }
                  style={{ accentColor: "var(--accent-amber)" }}
                />
                <span style={{ fontSize: 13 }}>Crear tarea de follow-up en 24h</span>
              </label>
              <label className="row" style={{ padding: "8px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={followUps.emailConfirm}
                  onChange={(e) =>
                    setFollowUps((f) => ({ ...f, emailConfirm: e.target.checked }))
                  }
                  style={{ accentColor: "var(--accent-amber)" }}
                />
                <span style={{ fontSize: 13 }}>Enviar email con confirmación</span>
              </label>
              <label className="row" style={{ padding: "8px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={followUps.nps}
                  onChange={(e) =>
                    setFollowUps((f) => ({ ...f, nps: e.target.checked }))
                  }
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
