import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useConnections } from "@/hooks/useConnections";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";

/**
 * CampaignBlendBoard — tablero "blend en vivo" del supervisor (Pilar 7 · Fase B).
 * Muestra TODAS las campañas de voz activas con su prioridad/peso (sliders en
 * vivo), su % del pool (la repartición 80/20), lo que está marcando, su meta y
 * el ETA de término. El control del pool global vive arriba. Reusa el reparto
 * por peso que hace el dialer, calculado acá del lado del cliente.
 */
function etaLabel(c: Campaign): string {
  const pending = Number(c.pendingCount) || 0;
  if (pending === 0) return "—";
  const started = c.startedAt ? new Date(c.startedAt).getTime() : 0;
  const done = Number(c.doneCount) || 0;
  if (!started || done === 0) return "s/datos";
  const mins = (Date.now() - started) / 60000;
  const rate = done / Math.max(1, mins); // contactos/min
  if (rate <= 0) return "s/datos";
  const remainMin = pending / rate;
  if (remainMin < 60) return `~${Math.round(remainMin)} min`;
  if (remainMin < 60 * 24) return `~${(remainMin / 60).toFixed(1)} h`;
  return `~${Math.round(remainMin / 60 / 24)} d`;
}

export function CampaignBlendBoard() {
  const { campaigns } = useCampaigns(5000);
  const { config } = useConnections();
  const { setBlend, setPool } = useCampaignMutations();
  const [poolDraft, setPoolDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const poolCfg = Number(
    (config as { orchestration?: { maxConcurrentDials?: number } }).orchestration
      ?.maxConcurrentDials,
  );

  // Campañas de voz activas (RUNNING). El blend solo aplica a voz.
  const active = useMemo(
    () =>
      campaigns
        .filter(
          (c) =>
            (c.status === "RUNNING" || c.status === "PAUSED") &&
            (c.campaignType || "voice").toLowerCase() !== "whatsapp",
        )
        .sort(
          (a, b) =>
            Number(b.priority ?? 5) - Number(a.priority ?? 5) ||
            Number(b.weight ?? 1) - Number(a.weight ?? 1),
        ),
    [campaigns],
  );

  const sumConc = active.reduce((n, c) => n + (Number(c.concurrency) || 1), 0);
  const sumWeight = active.reduce((n, c) => n + (Number(c.weight ?? 1) || 1), 0);
  const poolCap = Number.isFinite(poolCfg) && poolCfg > 0 ? poolCfg : sumConc;

  const commitBlend = async (id: string, patch: { priority?: number; weight?: number }) => {
    setBusy(true);
    try {
      await setBlend(id, patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const commitPool = async () => {
    setBusy(true);
    try {
      const n = Number(poolDraft) || 0;
      await setPool(n);
      toast.success(n > 0 ? `Pool global → ${n}` : "Pool sin tope");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  if (active.length === 0) return null; // sin campañas de voz activas → no se muestra

  return (
    <Card style={{ marginBottom: 16 }}>
      <div className="card__head">
        <div className="card__title">
          <Icon.Workflow size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Orquestación en vivo
        </div>
        <span className="card__sub">
          {active.length} campaña{active.length === 1 ? "" : "s"} de voz activa
          {active.length === 1 ? "" : "s"} · reparto por peso del pool
        </span>
      </div>
      <CardBody>
        {/* Pool global */}
        <div
          className="row"
          style={{
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 14,
            paddingBottom: 12,
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>Pool global</span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "var(--accent-cyan)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {poolCap}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>
            marcaciones simultáneas máx.{!poolCfg ? " (= Σ concurrencias)" : ""}
          </span>
          <div style={{ flex: 1 }} />
          <input
            type="number"
            min={0}
            value={poolDraft}
            onChange={(e) => setPoolDraft(e.target.value)}
            placeholder="≈ nº agentes"
            style={{
              width: 110,
              padding: "6px 9px",
              fontSize: 12.5,
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              background: "var(--bg-2)",
              color: "var(--text-1)",
            }}
          />
          <button className="btn btn--sm" onClick={commitPool} disabled={busy}>
            Aplicar pool
          </button>
        </div>

        {/* Filas por campaña */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {active.map((c) => {
            const w = Number(c.weight ?? 1) || 1;
            const prio = Number(c.priority ?? 5);
            const sharePct = sumWeight > 0 ? Math.round((w / sumWeight) * 100) : 0;
            const live = (Number(c.dialingCount) || 0) + (Number(c.connectedCount) || 0);
            const goalCur =
              c.goalType === "contacts"
                ? Number(c.connectedCount) || 0
                : c.goalType === "conversions"
                  ? Number(c.conversionsCount) || 0
                  : 0;
            const goalPct =
              c.goalType && c.goalType !== "none" && Number(c.goalTarget) > 0
                ? Math.min(100, Math.round((goalCur / Number(c.goalTarget)) * 100))
                : null;
            return (
              <div
                key={c.campaignId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.6fr 1.2fr 1.2fr 0.9fr 1fr",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 10px",
                  background: "var(--bg-2)",
                  borderRadius: 10,
                }}
              >
                {/* Nombre + % pool */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 12.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </div>
                  <div className="muted" style={{ fontSize: 10.5 }}>
                    {sharePct}% del pool · marcando {live} · pend. {c.pendingCount}
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: "var(--bg-1)",
                      borderRadius: 999,
                      overflow: "hidden",
                      marginTop: 3,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${sharePct}%`,
                        background: "var(--accent-cyan)",
                      }}
                    />
                  </div>
                </div>
                {/* Prioridad */}
                <label style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                  Prioridad <b style={{ color: "var(--text-1)" }}>{prio}</b>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    defaultValue={prio}
                    disabled={busy}
                    onMouseUp={(e) =>
                      commitBlend(c.campaignId, {
                        priority: parseInt((e.target as HTMLInputElement).value, 10),
                      })
                    }
                    onTouchEnd={(e) =>
                      commitBlend(c.campaignId, {
                        priority: parseInt((e.target as HTMLInputElement).value, 10),
                      })
                    }
                    style={{ width: "100%", accentColor: "var(--accent-violet)" }}
                  />
                </label>
                {/* Peso */}
                <label style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                  Peso <b style={{ color: "var(--text-1)" }}>{w}×</b>
                  <input
                    type="range"
                    min={0.5}
                    max={5}
                    step={0.5}
                    defaultValue={w}
                    disabled={busy}
                    onMouseUp={(e) =>
                      commitBlend(c.campaignId, {
                        weight: parseFloat((e.target as HTMLInputElement).value),
                      })
                    }
                    onTouchEnd={(e) =>
                      commitBlend(c.campaignId, {
                        weight: parseFloat((e.target as HTMLInputElement).value),
                      })
                    }
                    style={{ width: "100%", accentColor: "var(--accent-cyan)" }}
                  />
                </label>
                {/* ETA */}
                <div style={{ textAlign: "center" }}>
                  <div
                    className="muted"
                    style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em" }}
                  >
                    ETA
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{etaLabel(c)}</div>
                </div>
                {/* Meta */}
                <div>
                  {goalPct != null ? (
                    <>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {goalCur}/{c.goalTarget} {c.goalType === "contacts" ? "cont." : "conv."}
                      </div>
                      <div
                        style={{
                          height: 5,
                          background: "var(--bg-1)",
                          borderRadius: 999,
                          overflow: "hidden",
                          marginTop: 3,
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
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      sin meta
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
