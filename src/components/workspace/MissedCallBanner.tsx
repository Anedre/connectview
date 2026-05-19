import { useCCP } from "@/hooks/useCCP";
import { useMissedContacts } from "@/hooks/useActiveContact";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";

/**
 * Banner that appears when Amazon Connect moves the agent into the
 * `MissedCallAgent` state after a missed contact. Connect blocks new
 * routed contacts in that state until the agent manually returns to
 * Available — this banner makes the recovery one click.
 *
 * Connect's native CCP shows the same UX. We expose it here because
 * our custom CRM hides the CCP iframe, so the agent would otherwise
 * have no way of knowing why they stopped getting routed.
 */
export function MissedCallBanner() {
  const { agentState, availableStates, changeAgentState } = useCCP();
  const { missedContacts } = useMissedContacts();

  // Connect's built-in "missed" agent state can appear under a few
  // names depending on the instance configuration. Match all the
  // common variants.
  const isInMissedState =
    agentState === "MissedCallAgent" ||
    agentState === "MissedCall" ||
    agentState === "Missed Call Agent";

  useDebugRender("MissedCallBanner", {
    agentState,
    missedCount: missedContacts.length,
    visible: isInMissedState,
  });

  if (!isInMissedState) return null;

  // Find an "Available" / "Routable" state we can switch back to.
  // Some instances rename it ("Disponible", "Routable", etc.) so we
  // fuzzy-match by type=routable first, then by name.
  const availableState =
    availableStates.find((s) => s.type === "routable") ||
    availableStates.find((s) =>
      /availab|routab|disponib/i.test(s.name)
    );

  // Most recent miss (top of the banner — there can be more in the
  // tab strip).
  const latest =
    missedContacts.length > 0
      ? [...missedContacts].sort((a, b) => b.missedAt - a.missedAt)[0]
      : null;

  const handleReturnAvailable = () => {
    if (availableState) changeAgentState(availableState);
  };

  return (
    <div
      data-debug-component="MissedCallBanner"
      style={{
        background:
          "linear-gradient(135deg, var(--accent-red-soft) 0%, var(--accent-amber-soft) 100%)",
        borderBottom: "1px solid var(--accent-red)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        color: "var(--text-1)",
      }}
    >
      <div
        style={{
          display: "grid",
          placeItems: "center",
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--accent-red)",
          color: "white",
          flexShrink: 0,
        }}
      >
        <Icon.Hangup size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--accent-red)" }}>
          Contacto perdido — estás bloqueado para nuevos contactos
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-2)",
            marginTop: 2,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {latest && (
            <span>
              Último: <strong>{latest.customerPhone || latest.queueName || "Cliente"}</strong>
              {" · "}
              <span className="mono">{latest.channel}</span>
            </span>
          )}
          <span>
            Amazon Connect cambió tu estado a <strong>{agentState}</strong>. No
            recibirás más contactos hasta que vuelvas a Disponible.
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={handleReturnAvailable}
        disabled={!availableState}
        className="btn btn--success"
        style={{ minHeight: 36, padding: "0 14px", whiteSpace: "nowrap" }}
        title={
          availableState
            ? `Cambiar a ${availableState.name}`
            : "No se encontró un estado Available en este instance"
        }
      >
        <Icon.PhoneIn size={13} /> Volver a disponible
      </button>
    </div>
  );
}
