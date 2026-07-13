import { useState } from "react";
import { toast } from "sonner";
import { Icon, Pill } from "@/components/aria";
import { Modal } from "@/components/ui/modal";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useProgramOptional } from "@/context/ProgramContext";
import { useLeadOverview } from "@/hooks/useLeadOverview";
import { VALORACION_META, type DispositionStage } from "@/lib/dispositions";
import { useConversationActions, type Conversation } from "@/hooks/useConversations";
import { useConnectAuth } from "@/context/ConnectAuthContext";

/** Tags sugeridos para tipificar un chat (mismo espíritu que el wrap-up de voz,
 *  con "Promo" añadido porque el inbox también gestiona campañas). */
const CHAT_TAGS = ["FCR", "Reclamo", "Consulta", "Cobranza", "Soporte L1", "Promo"];

/**
 * ConversationTypifyModal — tipificar una conversación tras interactuar con el
 * cliente. Reusa LA MISMA taxonomía unificada que el wrap-up de voz (Stage →
 * Sub Stage, DynamoDB) para que todos los canales tipifiquen contra UN árbol.
 *
 * Al guardar: registra la disposición en la conversación Y un golpe en el lead
 * vinculado (Pilar 2 · ledger). Con "cerrar al guardar" también cierra el chat.
 */
export function ConversationTypifyModal({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const activeProgram = useProgramOptional()?.activeProgram;
  const { tree } = useTaxonomy(activeProgram?.taxonomyId);
  const { typify } = useConversationActions();
  const { user } = useConnectAuth();
  const leadOv = useLeadOverview(conversation.phone ?? null);

  const [stageId, setStageId] = useState<string | null>(
    conversation.lastDisposition?.stageId ?? null,
  );
  const [subStageId, setSubStageId] = useState<string | null>(
    conversation.lastDisposition?.subStageId ?? null,
  );
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>(conversation.lastDisposition?.tags ?? []);
  const [closeAfter, setCloseAfter] = useState(conversation.status !== "closed");

  const selectedStage: DispositionStage | null = tree.find((s) => s.id === stageId) ?? null;
  const selectedSubStage = selectedStage?.subStages.find((s) => s.id === subStageId) ?? null;

  // "Cómo queda el lead" — etapa actual (último stageLabel del historial, o la
  // última tipificación de esta conversación) → etapa nueva, y el toque N→N+1.
  const currentStageLabel =
    leadOv.history?.recent.find((e) => e.stageLabel)?.stageLabel ??
    conversation.lastDisposition?.stageLabel ??
    null;
  const leadTouches = leadOv.history?.count ?? 0;
  const valTone: "green" | "red" | "outline" = selectedStage
    ? selectedStage.valoracion === "negativa"
      ? "red"
      : selectedStage.valoracion === "cierre" || selectedStage.valoracion === "positiva"
        ? "green"
        : "outline"
    : "outline";

  const addTag = (t: string) => setTags((c) => (c.includes(t) ? c : [...c, t]));
  const removeTag = (t: string) => setTags((c) => c.filter((x) => x !== t));

  const save = async () => {
    if (!selectedStage) {
      toast.error("Elige una etapa para tipificar");
      return;
    }
    try {
      await typify.mutateAsync({
        conversationId: conversation.conversationId,
        disposition: {
          stageId: selectedStage.id,
          stageLabel: selectedStage.label,
          subStageId: selectedSubStage?.id,
          subStageLabel: selectedSubStage?.label,
          valoracion: selectedStage.valoracion,
          tags,
          notes: notes.trim() || undefined,
        },
        closeAfter,
        agent: user?.username || undefined,
      });
      toast.success(`Conversación tipificada · ${selectedStage.label}`, {
        description: closeAfter
          ? "Cerrada · golpe registrado en el lead"
          : `Toque #${leadTouches + 1} en el lead`,
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo tipificar");
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        <span className="row gap10" style={{ alignItems: "center" }}>
          <span className="card__ico" style={{ ["--_c" as string]: "var(--gold)" }}>
            <Icon name="tag" size={16} />
          </span>
          Tipificar conversación
        </span>
      }
      className="max-w-lg"
      footer={
        <div className="row between" style={{ width: "100%", alignItems: "center", gap: 10 }}>
          <label
            className="row gap8"
            style={{ alignItems: "center", cursor: "pointer", fontSize: 12.5 }}
          >
            <input
              type="checkbox"
              checked={closeAfter}
              onChange={(e) => setCloseAfter(e.target.checked)}
              style={{ accentColor: "var(--gold)" }}
            />
            Cerrar la conversación al guardar
          </label>
          <div className="row gap8">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={save}
              disabled={!selectedStage || typify.isPending}
            >
              {typify.isPending
                ? "Guardando…"
                : closeAfter
                  ? "Tipificar y cerrar"
                  : "Guardar tipificación"}
            </button>
          </div>
        </div>
      }
    >
      <div
        style={{
          marginTop: 16,
          maxHeight: "60vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Cómo queda el lead — se actualiza en vivo al elegir la etapa. */}
        {selectedStage && (
          <div
            className="col gap8"
            style={{
              padding: "11px 12px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border-1)",
              background: "var(--bg-2)",
              fontSize: 12.5,
            }}
          >
            <div className="row between" style={{ alignItems: "center" }}>
              <span className="dim">Etapa</span>
              <span className="row gap6" style={{ alignItems: "center" }}>
                {currentStageLabel && currentStageLabel !== selectedStage.label && (
                  <>
                    <span className="pill pill--outline" style={{ opacity: 0.7 }}>
                      {currentStageLabel}
                    </span>
                    <Icon name="arrowRight" size={13} style={{ color: "var(--text-3)" }} />
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
              <span className="dim">Toques en el lead</span>
              <span className="mono">
                {leadTouches} → <b style={{ color: "var(--green)" }}>{leadTouches + 1}</b>
              </span>
            </div>
          </div>
        )}

        {/* Stage picker */}
        <div className="col gap6">
          <div className="row between" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>Etapa</span>
            {selectedStage && (
              <span className={`chip ${VALORACION_META[selectedStage.valoracion].chip}`}>
                <span className="dot" />
                {VALORACION_META[selectedStage.valoracion].label}
              </span>
            )}
          </div>
          <div className="col gap6" style={{ maxHeight: 220, overflowY: "auto" }}>
            {tree.map((stage) => {
              const isSel = stage.id === stageId;
              return (
                <label
                  key={stage.id}
                  className="row gap10"
                  style={{
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: isSel ? "var(--bg-active)" : "transparent",
                    cursor: "pointer",
                    border: "1px solid var(--border-1)",
                  }}
                >
                  <input
                    type="radio"
                    checked={isSel}
                    onChange={() => {
                      setStageId(stage.id);
                      setSubStageId(null);
                    }}
                    style={{ accentColor: "var(--gold)" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{stage.label}</div>
                    {stage.description && (
                      <div className="dim trunc" style={{ fontSize: 11, marginTop: 1 }}>
                        {stage.description}
                      </div>
                    )}
                  </div>
                  <span
                    className={`chip ${VALORACION_META[stage.valoracion].chip}`}
                    style={{ height: 18, fontSize: 10 }}
                  >
                    {stage.valoracion}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Sub Stage — aparece tras elegir etapa. */}
        {selectedStage && (
          <div className="col gap6">
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
              Resultado · {selectedStage.label}
            </span>
            <div className="col gap6">
              {selectedStage.subStages.map((sub) => {
                const isSel = sub.id === subStageId;
                return (
                  <label
                    key={sub.id}
                    className="row gap10"
                    style={{
                      alignItems: "center",
                      padding: "7px 10px",
                      borderRadius: 8,
                      background: isSel ? "var(--bg-active)" : "transparent",
                      cursor: "pointer",
                      border: "1px solid var(--border-1)",
                    }}
                  >
                    <input
                      type="radio"
                      checked={isSel}
                      onChange={() => setSubStageId(sub.id)}
                      style={{ accentColor: "var(--gold)" }}
                    />
                    <span style={{ flex: 1, fontSize: 13 }}>{sub.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Tags */}
        <div className="col gap6">
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>Tags</span>
          <div className="row wrap gap6">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="chip chip--cyan"
                onClick={() => removeTag(t)}
                title="Quitar tag"
              >
                {t}
                <Icon name="x" size={11} style={{ opacity: 0.6, marginLeft: 3 }} />
              </button>
            ))}
            {CHAT_TAGS.filter((t) => !tags.includes(t)).map((t) => (
              <button key={t} type="button" className="chip" onClick={() => addTag(t)}>
                <Icon name="plus" size={10} /> {t}
              </button>
            ))}
          </div>
        </div>

        {/* Notas */}
        <div className="col gap6">
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>Notas</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas internas sobre la conversación…"
            rows={3}
            style={{
              width: "100%",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-md)",
              padding: 10,
              color: "var(--text-1)",
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
