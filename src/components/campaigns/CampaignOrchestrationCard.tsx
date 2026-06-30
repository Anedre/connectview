import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";

interface Props {
  campaignId: string;
  priority?: number;
  weight?: number;
  goalType?: string;
  goalTarget?: number;
  connectedCount?: number;
  conversionsCount?: number;
  disabled?: boolean;
  onUpdated?: () => void;
}

/**
 * Orquestación (Pilar 7) — control de blend del supervisor por campaña:
 *  · Prioridad (1-10) — quién se sirve primero cuando el pool no alcanza.
 *  · Peso — el % del pool global (la repartición 80/20).
 *  · Meta — parar a N contactados / N conversiones (auto-completa).
 *  · Pool global del tenant — nº máx de marcaciones simultáneas (= agentes).
 * Cambios en vivo (set-blend / set-pool), efectivos en el próximo tick (~60s).
 */
export function CampaignOrchestrationCard({
  campaignId,
  priority,
  weight,
  goalType,
  goalTarget,
  connectedCount,
  conversionsCount,
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
      toast.success("Blend actualizado", { description: "Efectivo en el próximo tick (~60s)" });
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

  // Avance de meta.
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

  const label: React.CSSProperties = {
    fontSize: 10.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-3)",
    fontWeight: 600,
  };

  return (
    <Card>
      <div className="card__head">
        <div className="card__title">
          <Icon.Workflow size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Orquestación
        </div>
        <span className="card__sub">prioridad · peso · meta — efectivo en ≤60s</span>
      </div>
      <CardBody>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Prioridad */}
          <div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={label}>Prioridad</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{prio}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={prio}
              disabled={disabled || busy}
              onChange={(e) => setPrio(parseInt(e.target.value, 10))}
              onMouseUp={(e) =>
                commitBlend({ priority: parseInt((e.target as HTMLInputElement).value, 10) })
              }
              onTouchEnd={(e) =>
                commitBlend({ priority: parseInt((e.target as HTMLInputElement).value, 10) })
              }
              style={{ width: "100%", accentColor: "var(--accent-violet)" }}
            />
            <div className="muted" style={{ fontSize: 10 }}>
              Mayor = se sirve primero cuando el pool no alcanza.
            </div>
          </div>

          {/* Peso */}
          <div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={label}>Peso (% del pool)</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{w}×</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={w}
              disabled={disabled || busy}
              onChange={(e) => setW(parseFloat(e.target.value))}
              onMouseUp={(e) =>
                commitBlend({ weight: parseFloat((e.target as HTMLInputElement).value) })
              }
              onTouchEnd={(e) =>
                commitBlend({ weight: parseFloat((e.target as HTMLInputElement).value) })
              }
              style={{ width: "100%", accentColor: "var(--accent-cyan)" }}
            />
            <div className="muted" style={{ fontSize: 10 }}>
              De la repartición sale el 80/20 entre campañas activas.
            </div>
          </div>

          {/* Meta */}
          <div>
            <span style={label}>Meta (auto-completa al alcanzarla)</span>
            <div
              className="row"
              style={{ gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}
            >
              <select
                value={gType}
                disabled={disabled || busy}
                onChange={(e) => setGType(e.target.value)}
                style={{
                  padding: "7px 10px",
                  fontSize: 13,
                  border: "1px solid var(--border-1)",
                  borderRadius: 8,
                  background: "var(--bg-2)",
                  color: "var(--text-1)",
                }}
              >
                <option value="none">Sin meta</option>
                <option value="contacts">Contactados</option>
                <option value="conversions">Conversiones</option>
              </select>
              {gType !== "none" && (
                <input
                  type="number"
                  min={0}
                  value={gTarget}
                  onChange={(e) => setGTarget(e.target.value)}
                  placeholder="N"
                  disabled={disabled || busy}
                  style={{
                    width: 90,
                    padding: "7px 10px",
                    fontSize: 13,
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    background: "var(--bg-2)",
                    color: "var(--text-1)",
                  }}
                />
              )}
              <button className="btn btn--sm" onClick={commitGoal} disabled={disabled || busy}>
                Guardar meta
              </button>
            </div>
            {gType !== "none" && Number(gTarget) > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 11 }}>
                  <span className="muted">
                    {goalCurrent} / {gTarget}{" "}
                    {gType === "contacts" ? "contactados" : "conversiones"}
                  </span>
                  <span style={{ fontWeight: 700 }}>{goalPct}%</span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: "var(--bg-2)",
                    borderRadius: 999,
                    overflow: "hidden",
                    marginTop: 4,
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
              </div>
            )}
          </div>

          {/* Pool global del tenant */}
          <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 12 }}>
            <span style={label}>Pool global (máx. marcaciones simultáneas)</span>
            <div
              className="row"
              style={{ gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}
            >
              <input
                type="number"
                min={0}
                value={pool}
                onChange={(e) => setPoolVal(e.target.value)}
                placeholder="ej. nº de agentes"
                disabled={busy}
                style={{
                  width: 140,
                  padding: "7px 10px",
                  fontSize: 13,
                  border: "1px solid var(--border-1)",
                  borderRadius: 8,
                  background: "var(--bg-2)",
                  color: "var(--text-1)",
                }}
              />
              <button className="btn btn--sm" onClick={commitPool} disabled={busy}>
                Aplicar
              </button>
              <span className="muted" style={{ fontSize: 10.5 }}>
                0 = sin tope. Ponlo ≈ agentes para que el 80/20 muerda.
              </span>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
