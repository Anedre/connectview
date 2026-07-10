import type { CSSProperties } from "react";
import { useDropdown } from "@/hooks/useDropdown";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";

/**
 * Quick state switcher pill — replaces the previous static state chip
 * in the softphone header. Clicking opens a dropdown listing all states
 * surfaced by `agent.getAgentStates()` so the agent can flip to Lunch /
 * Break / Offline without leaving the desktop. Falls back to the static
 * pill if Streams hasn't populated `availableStates` yet (e.g. before
 * the CCP iframe finishes login).
 */

type StateStyle = { fg: string; bg: string; label: string };

const FALLBACK: StateStyle = {
  fg: "var(--text-3)",
  bg: "var(--bg-3)",
  label: "—",
};

// Map common Connect state names to colors + Spanish labels. Anything
// not matched falls back to the routable-vs-not-routable heuristic.
const STATE_STYLE: Record<string, StateStyle> = {
  Init: { fg: "var(--text-3)", bg: "var(--bg-3)", label: "Inicio" },
  Available: { fg: "var(--accent-green)", bg: "var(--accent-green-soft)", label: "Disponible" },
  Busy: { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "En llamada" },
  AfterCallWork: { fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)", label: "ACW" },
  CallingCustomer: { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "Marcando" },
  Offline: { fg: "var(--text-3)", bg: "var(--bg-3)", label: "Offline" },
  Error: { fg: "var(--accent-red)", bg: "var(--accent-red-soft)", label: "Error" },
  MissedCallAgent: {
    fg: "var(--accent-red)",
    bg: "var(--accent-red-soft)",
    label: "Contacto perdido",
  },
  MissedCall: { fg: "var(--accent-red)", bg: "var(--accent-red-soft)", label: "Contacto perdido" },
  "Missed Call Agent": {
    fg: "var(--accent-red)",
    bg: "var(--accent-red-soft)",
    label: "Contacto perdido",
  },
  Lunch: { fg: "var(--accent-violet)", bg: "var(--accent-violet-soft)", label: "Almuerzo" },
  Break: { fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)", label: "Pausa" },
  Training: { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)", label: "Capacitación" },
  Meeting: { fg: "var(--accent-violet)", bg: "var(--accent-violet-soft)", label: "Reunión" },
};

function styleFor(name: string, type?: string): StateStyle {
  if (STATE_STYLE[name]) return STATE_STYLE[name];
  if (type === "routable") {
    return { fg: "var(--accent-green)", bg: "var(--accent-green-soft)", label: name };
  }
  return { fg: "var(--text-2)", bg: "var(--bg-2)", label: name };
}

export function AgentStatePill() {
  const { agentState, availableStates, changeAgentState } = useCCP();
  // Abre al hover, cierra al click afuera / Escape (hook compartido).
  const dd = useDropdown<HTMLDivElement>({ hover: true });

  const current = STATE_STYLE[agentState] ?? FALLBACK;
  const list = availableStates ?? [];
  const canChange = list.length > 0;

  return (
    <div style={{ position: "relative" }} {...dd.wrapProps}>
      <button
        type="button"
        className="vox-sp__state"
        onClick={() => canChange && dd.toggle()}
        style={
          {
            "--st-fg": current.fg,
            "--st-bg": current.bg,
          } as CSSProperties
        }
        title={canChange ? "Cambiar estado" : "Estado actual"}
        aria-haspopup="listbox"
        aria-expanded={dd.open}
        disabled={!canChange}
      >
        <span className="vox-sp__state-dot" />
        <span>{current.label}</span>
        {canChange && <Icon.ChevDown size={11} className="vox-sp__state-caret" />}
      </button>
      {dd.open && canChange && (
        <div className="vox-sp__state-menu aria-menu-anim" role="listbox">
          {list.map((s) => {
            const st = styleFor(s.name, s.type);
            const isCurrent = s.name === agentState;
            return (
              <button
                key={s.agentStateARN || s.name}
                type="button"
                role="option"
                aria-selected={isCurrent}
                className={`vox-sp__state-opt ${isCurrent ? "vox-sp__state-opt--active" : ""}`}
                onClick={() => {
                  try {
                    changeAgentState(s);
                  } catch {
                    /* CCPContext shows its own toast */
                  }
                  dd.close();
                }}
              >
                <span className="vox-sp__state-opt-dot" style={{ background: st.fg }} />
                <span style={{ flex: 1 }}>{st.label}</span>
                {isCurrent && <Icon.Check size={12} style={{ color: "var(--text-3)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
