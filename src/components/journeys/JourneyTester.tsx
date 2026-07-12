import { useMemo, useState } from "react";
import { X, Play, Flag, Target, DoorOpen, Clock } from "lucide-react";
import type { Journey } from "@/hooks/useJourneys";
import { JOURNEY_ICONS } from "@/lib/journeyFlow";
import { simulateJourney, type SimResult } from "@/lib/journeySim";

/**
 * JourneyTester — "Probar" el recorrido que estás creando (dry-run, sin envíos).
 * Panel flotante: ajustas un lead de muestra (score/grade/etapa/origen), simula
 * el camino con `simulateJourney` (puro) y muestra la traza paso a paso —
 * qué enviaría, qué rama toma, cuánto esperaría — y cómo termina. Refleja el
 * borrador ACTUAL (nodos+edges sin guardar), como el BotTester de Bots.
 */
const ENDED_META: Record<SimResult["ended"], { label: string; icon: typeof Flag; color: string }> =
  {
    exit: { label: "Fin del recorrido", icon: Flag, color: "#64748B" },
    goal: { label: "Objetivo — convierte", icon: Target, color: "#16A34A" },
    leave: { label: "Salió del recorrido", icon: DoorOpen, color: "#EF4444" },
    loop: { label: "Ciclo detectado", icon: Clock, color: "#E0A72E" },
    deadend: { label: "Camino sin salida (falta conectar)", icon: Clock, color: "#E0A72E" },
  };

export function JourneyTester({ journey, onClose }: { journey: Journey; onClose: () => void }) {
  const [score, setScore] = useState("80");
  const [grade, setGrade] = useState("A");
  const [stageId, setStageId] = useState("nuevo");
  const [source, setSource] = useState("web");
  const [result, setResult] = useState<SimResult | null>(null);

  const lead = useMemo(() => {
    const l: Record<string, unknown> = {};
    if (score.trim() !== "") l.score = Number(score);
    if (grade.trim()) l.grade = grade.trim();
    if (stageId.trim()) l.stageId = stageId.trim();
    if (source.trim()) l.source = source.trim();
    return l;
  }, [score, grade, stageId, source]);

  const run = () => setResult(simulateJourney(journey, lead));

  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label className="jt-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  const endMeta = result ? ENDED_META[result.ended] : null;
  const EndIcon = endMeta?.icon;

  return (
    <div className="jt">
      <div className="jt__head">
        <Play size={14} />
        <span className="jt__title">Probar recorrido</span>
        <button className="jt__close" onClick={onClose} title="Cerrar" aria-label="Cerrar">
          <X size={15} />
        </button>
      </div>

      <div className="jt__lead">
        <div className="jt__hint">
          Lead de muestra — ajusta y simula el camino (sin envíos reales).
        </div>
        <div className="jt__grid">
          {field("Score", score, setScore, "number")}
          {field("Grade", grade, setGrade)}
          {field("Etapa (stageId)", stageId, setStageId)}
          {field("Origen (source)", source, setSource)}
        </div>
        <button className="btn btn--primary btn--sm jt__run" onClick={run}>
          <Play size={13} /> Simular
        </button>
      </div>

      {result && (
        <div className="jt__out">
          {endMeta && EndIcon && (
            <div className="jt__end" style={{ ["--_c" as string]: endMeta.color }}>
              <EndIcon size={14} />
              <span>{endMeta.label}</span>
              {result.waitedDays > 0 && (
                <span className="jt__waited">
                  · esperaría {result.waitedDays} día{result.waitedDays === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
          <ol className="jt__steps">
            {result.steps.map((s, i) => {
              const Icon = JOURNEY_ICONS[s.icon] || JOURNEY_ICONS.action;
              return (
                <li
                  key={i}
                  className={`jt__step jt__step--${s.tone}`}
                  style={{ ["--_c" as string]: s.accent }}
                >
                  <span className="jt__step-ico">
                    <Icon size={13} strokeWidth={2.2} />
                  </span>
                  <span className="jt__step-body">
                    <span className="jt__step-label">{s.label}</span>
                    <span className="jt__step-detail">{s.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {result.steps.length === 0 && (
            <div className="jt__hint">El recorrido no tiene pasos que simular todavía.</div>
          )}
        </div>
      )}
    </div>
  );
}
