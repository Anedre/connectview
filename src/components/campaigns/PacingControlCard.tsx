import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";

interface Props {
  campaignId: string;
  concurrency: number;
  dialMode: string;
  /** Called after a successful concurrency change so the parent can
   *  refresh the campaign meta + show the new value immediately. */
  onUpdated?: () => void;
  /** Disable controls when the campaign isn't in a state that can be
   *  tuned (e.g. COMPLETED / CANCELLED). */
  disabled?: boolean;
}

/**
 * Live pacing control card. Lets a manager bump the dialer's
 * concurrency up or down without pausing the campaign.
 *
 * The dialer Lambda reads `concurrency` from the campaigns table every
 * minute when it computes how many StartOutboundVoiceContact calls to
 * fire, so changes take effect on the next tick (≤60 seconds).
 *
 * Persists via the `controlCampaign` Function URL with the new
 * `action: "set-concurrency"` action (which only updates the
 * concurrency field; status is untouched).
 */
export function PacingControlCard({
  campaignId,
  concurrency,
  dialMode,
  onUpdated,
  disabled,
}: Props) {
  // Local slider value kept separate from the prop so the agent can
  // drag without each microstep firing a request. We commit on release.
  const [draftValue, setDraftValue] = useState(concurrency);
  const [committing, setCommitting] = useState(false);
  const { setConcurrency } = useCampaignMutations();

  // Keep the draft in sync if the prop changes from outside (e.g.
  // another admin edited via the dialog while this page was open).
  useEffect(() => {
    setDraftValue(concurrency);
  }, [concurrency]);

  const dirty = draftValue !== concurrency;

  const commit = async (val: number) => {
    if (val === concurrency) return;
    setCommitting(true);
    try {
      await setConcurrency(campaignId, val);
      toast.success(`Concurrencia → ${val}`, {
        description: "Aplicado en el próximo tick (~60s)",
      });
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando");
      setDraftValue(concurrency); // revert
    } finally {
      setCommitting(false);
    }
  };

  // Quick presets — handy for "slow start" / "burst" workflows.
  const PRESETS = [1, 3, 5, 10, 20];

  // The dialer scales sloppily past ~30 concurrent in our setup
  // (memory hits, API throttling on StartOutboundVoiceContact). 50
  // is the hard ceiling enforced by the control-campaign Lambda.
  const MAX = 50;

  const paceColor =
    draftValue <= 3
      ? "var(--accent-amber)"
      : draftValue <= 10
      ? "var(--accent-cyan)"
      : "var(--accent-green)";

  return (
    <Card>
      <div className="card__head">
        <div className="card__title">
          <Icon.Lightning
            size={14}
            style={{ marginRight: 6, verticalAlign: "middle" }}
          />
          Pacing en vivo
        </div>
        <span className="card__sub">
          modo {dialMode}
          {disabled
            ? " · campaña finalizada — pacing congelado"
            : " · cambio efectivo en ≤60s"}
        </span>
      </div>
      <CardBody>
        <div
          className="row"
          style={{
            gap: 18,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {/* Current value display */}
          <div style={{ minWidth: 96 }}>
            <div
              className="muted"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Concurrencia
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                lineHeight: 1,
                color: paceColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {draftValue}
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-3)",
                  fontWeight: 400,
                  marginLeft: 4,
                }}
              >
                / {MAX}
              </span>
            </div>
            <div
              className="muted"
              style={{ fontSize: 11, marginTop: 2 }}
            >
              llamadas simultáneas
            </div>
          </div>

          {/* Slider — covers 1..MAX. Touch + keyboard accessible
              via the native input. */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              type="range"
              min={1}
              max={MAX}
              step={1}
              value={draftValue}
              disabled={disabled || committing}
              onChange={(e) => setDraftValue(parseInt(e.target.value, 10))}
              onMouseUp={(e) =>
                commit(parseInt((e.target as HTMLInputElement).value, 10))
              }
              onTouchEnd={(e) =>
                commit(parseInt((e.target as HTMLInputElement).value, 10))
              }
              onKeyUp={(e) => {
                if (
                  e.key === "ArrowLeft" ||
                  e.key === "ArrowRight" ||
                  e.key === "Home" ||
                  e.key === "End" ||
                  e.key === "PageUp" ||
                  e.key === "PageDown"
                ) {
                  commit(parseInt((e.target as HTMLInputElement).value, 10));
                }
              }}
              style={{
                width: "100%",
                accentColor: paceColor,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            />
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                marginTop: 4,
                fontSize: 10,
                color: "var(--text-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <span>1 · suave</span>
              <span>{MAX} · máximo</span>
            </div>
          </div>

          {/* Quick presets */}
          <div className="col" style={{ gap: 4 }}>
            <div
              className="muted"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Presets
            </div>
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`btn btn--sm ${
                    draftValue === p ? "btn--primary" : "btn--ghost"
                  }`}
                  onClick={() => {
                    setDraftValue(p);
                    void commit(p);
                  }}
                  disabled={disabled || committing}
                  style={{ minWidth: 36, padding: "0 8px" }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {dirty && !committing && (
          <div
            className="muted"
            style={{
              fontSize: 11,
              marginTop: 10,
              padding: "6px 10px",
              borderRadius: 6,
              background: "var(--accent-amber-soft)",
              color: "var(--accent-amber)",
            }}
          >
            Cambio pendiente · suelta el slider para aplicar (o usa un preset)
          </div>
        )}
        {committing && (
          <div
            className="muted"
            style={{ fontSize: 11, marginTop: 10 }}
          >
            Guardando…
          </div>
        )}
      </CardBody>
    </Card>
  );
}
