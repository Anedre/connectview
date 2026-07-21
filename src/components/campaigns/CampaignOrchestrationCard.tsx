import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { SegmentedControl } from "@/components/ui/segmented";
import { RadioCards } from "@/components/ui/radio-cards";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";

interface Props {
  campaignId: string;
  priority?: number;
  weight?: number;
  goalType?: string;
  goalTarget?: number;
  connectedCount?: number;
  conversionsCount?: number;
  /** true si la campaña es POR AGENTES (progressive/manual) — el caso normal. El
   *  peso y el pool global reparten un pool COMPARTIDO, que solo existe en modo
   *  agentless (bucketMode=false, hoy fuera del UI) → con agentes se ocultan. */
  bucketMode?: boolean;
  disabled?: boolean;
  onUpdated?: () => void;
}

const label: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  fontWeight: 650,
};
const numInput: React.CSSProperties = {
  width: 96,
  padding: "8px 11px",
  fontSize: 14,
  fontWeight: 600,
  border: "1px solid var(--border-1)",
  borderRadius: 9,
  background: "var(--bg-2)",
  color: "var(--text-1)",
};

/**
 * Orquestación (Pilar 7) — control de blend por campaña, CONSCIENTE del modo:
 *  · Prioridad — orden en que el discador sirve las campañas (aplica en todo modo).
 *  · Meta — parar a N contactados / conversiones (aplica en todo modo).
 *  · Peso + Pool global — SOLO en modo pool compartido (agentless / sin agentes):
 *    reparten un pool común. Con agentes asignados no hay pool que repartir → se
 *    ocultan (antes se mostraban siempre y podían frenar una campaña por error).
 * Controles modernos: SegmentedControl (prioridad/peso) + RadioCards (meta).
 */
export function CampaignOrchestrationCard({
  campaignId,
  priority,
  weight,
  goalType,
  goalTarget,
  connectedCount,
  conversionsCount,
  bucketMode,
  disabled,
  onUpdated,
}: Props) {
  const { setBlend, setPool, update } = useCampaignMutations();
  const [prio, setPrio] = useState(Number(priority ?? 5));
  const [w, setW] = useState(Number(weight ?? 1));
  const [gType, setGType] = useState(goalType || "none");
  const [gTarget, setGTarget] = useState(goalTarget ? String(goalTarget) : "");
  const [pool, setPoolVal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPrio(Number(priority ?? 5));
    setW(Number(weight ?? 1));
    setGType(goalType || "none");
    setGTarget(goalTarget ? String(goalTarget) : "");
  }, [priority, weight, goalType, goalTarget]);

  const commitBlend = async (next: { priority?: number; weight?: number }) => {
    setBusy(true);
    try {
      await setBlend(campaignId, next);
      toast.success("Orquestación actualizada", {
        description: "Efectivo en el próximo tick (~60s)",
      });
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const commitGoal = async () => {
    setBusy(true);
    try {
      await update({
        campaignId,
        goalType: gType as "none" | "contacts" | "conversions",
        goalTarget: gType === "none" ? 0 : Math.max(0, Number(gTarget) || 0),
      });
      toast.success("Meta guardada");
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const commitPool = async () => {
    setBusy(true);
    try {
      const n = Number(pool) || 0;
      await setPool(n);
      toast.success(
        n > 0 ? `Pool global → ${n} marcaciones` : "Pool sin tope (suma de concurrencias)",
      );
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  // Meta — avance.
  const goalCurrent =
    gType === "contacts"
      ? Number(connectedCount || 0)
      : gType === "conversions"
        ? Number(conversionsCount || 0)
        : 0;
  const goalPct =
    gType !== "none" && Number(gTarget) > 0
      ? Math.min(100, Math.round((goalCurrent / Number(gTarget)) * 100))
      : 0;

  // Prioridad como niveles nombrados (el tick usa prioridad RELATIVA). El activo
  // es el nivel MÁS CERCANO al valor guardado — no se reescribe hasta que el
  // usuario elige uno (sin escrituras silenciosas).
  const PRIO_LEVELS = [
    { value: "3", label: "Baja", color: "var(--text-3)" },
    { value: "5", label: "Normal", color: "var(--accent-cyan)" },
    { value: "8", label: "Alta", color: "var(--accent-violet)" },
    { value: "10", label: "Máxima", color: "var(--accent-red)" },
  ];
  const prioSel = PRIO_LEVELS.reduce((best, o) =>
    Math.abs(Number(o.value) - prio) < Math.abs(Number(best.value) - prio) ? o : best,
  ).value;

  const WEIGHTS = [
    { value: "1", label: "1×" },
    { value: "2", label: "2×" },
    { value: "3", label: "3×" },
    { value: "5", label: "5×" },
  ];
  const wSel = WEIGHTS.reduce((best, o) =>
    Math.abs(Number(o.value) - w) < Math.abs(Number(best.value) - w) ? o : best,
  ).value;

  return (
    <Card>
      <div className="card__head">
        <div className="card__title">
          <Icon.Workflow size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Orquestación
        </div>
        <span className="card__sub">
          {bucketMode ? "prioridad · meta — efectivo en ≤60s" : "prioridad · peso · meta — ≤60s"}
        </span>
      </div>
      <CardBody>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* ── Prioridad (aplica en todo modo) ─────────────────────────── */}
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Prioridad</div>
            <SegmentedControl
              aria-label="Prioridad de la campaña"
              value={prioSel}
              onValueChange={(v) => {
                setPrio(Number(v));
                void commitBlend({ priority: Number(v) });
              }}
              options={PRIO_LEVELS}
            />
            <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
              Mayor prioridad = el discador la sirve primero cuando no alcanzan los agentes.
            </div>
          </div>

          {/* ── Meta (aplica en todo modo) ──────────────────────────────── */}
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Meta — auto-completa al alcanzarla</div>
            <RadioCards
              aria-label="Tipo de meta"
              columns={3}
              value={gType}
              onValueChange={setGType}
              options={[
                {
                  value: "none",
                  label: "Sin meta",
                  icon: <Icon.Workflow size={14} />,
                  description: "Corre hasta agotar los contactos.",
                },
                {
                  value: "contacts",
                  label: "Contactados",
                  color: "var(--accent-cyan)",
                  icon: <Icon.Phone size={14} />,
                  description: "Para al llegar a N atendidas.",
                },
                {
                  value: "conversions",
                  label: "Conversiones",
                  color: "var(--accent-green)",
                  icon: <Icon.Check size={14} />,
                  description: "Para al llegar a N ventas.",
                },
              ]}
            />
            {gType !== "none" && (
              <div
                className="row"
                style={{ gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}
              >
                <input
                  type="number"
                  min={0}
                  value={gTarget}
                  onChange={(e) => setGTarget(e.target.value)}
                  placeholder="Meta (N)"
                  disabled={disabled || busy}
                  style={numInput}
                />
                <button
                  className="btn btn--sm btn--primary"
                  onClick={commitGoal}
                  disabled={disabled || busy}
                >
                  Guardar meta
                </button>
                {Number(gTarget) > 0 && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {goalCurrent} / {gTarget} · {goalPct}%
                  </span>
                )}
              </div>
            )}
            {gType !== "none" && Number(gTarget) > 0 && (
              <div
                style={{
                  height: 6,
                  background: "var(--bg-3)",
                  borderRadius: 999,
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${goalPct}%`,
                    background: "var(--accent-green)",
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Peso + Pool global — SOLO modo pool compartido (agentless, hoy
                dormido). Con agentes asignados no se muestran: cada campaña tiene
                sus propios agentes, no hay pool que repartir. ─────────────── */}
          {!bucketMode && (
            <>
              <div>
                <div style={{ ...label, marginBottom: 6 }}>Peso del pool</div>
                <SegmentedControl
                  aria-label="Peso de la campaña"
                  value={wSel}
                  onValueChange={(v) => {
                    setW(Number(v));
                    void commitBlend({ weight: Number(v) });
                  }}
                  options={WEIGHTS.map((o) => ({ ...o, color: "var(--accent-cyan)" }))}
                />
                <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
                  Reparte el pool compartido entre campañas activas (el 80/20).
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 14 }}>
                <div style={{ ...label, marginBottom: 6 }}>
                  Pool global — máx. marcaciones simultáneas
                </div>
                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="number"
                    min={0}
                    value={pool}
                    onChange={(e) => setPoolVal(e.target.value)}
                    placeholder="≈ nº agentes"
                    disabled={busy}
                    style={{ ...numInput, width: 130 }}
                  />
                  <button className="btn btn--sm" onClick={commitPool} disabled={busy}>
                    Aplicar
                  </button>
                  <span className="muted" style={{ fontSize: 10.5 }}>
                    0 = sin tope. Ponlo ≈ agentes para que el 80/20 muerda.
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
