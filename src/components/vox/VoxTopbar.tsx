import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useCCP, type ConnectAgentState } from "@/hooks/useCCP";
import { modifierLabel } from "@/lib/utils";
import * as Icon from "./primitives";

const STATE_COLORS: Record<
  string,
  { fg: string; bg: string }
> = {
  Available:        { fg: "var(--accent-green)", bg: "var(--accent-green-soft)" },
  Routable:         { fg: "var(--accent-green)", bg: "var(--accent-green-soft)" },
  Busy:             { fg: "var(--accent-cyan)",  bg: "var(--accent-cyan-soft)"  },
  CallingCustomer:  { fg: "var(--accent-cyan)",  bg: "var(--accent-cyan-soft)"  },
  AfterCallWork:    { fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)" },
  PendingBusy:      { fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)" },
  Offline:          { fg: "var(--text-3)",       bg: "var(--bg-3)"              },
  Init:             { fg: "var(--text-3)",       bg: "var(--bg-3)"              },
  Error:            { fg: "var(--accent-red)",   bg: "var(--accent-red-soft)"   },
};

function colorFor(state: ConnectAgentState): { fg: string; bg: string } {
  // First try by name (covers "Available", "Offline", custom "Break" etc.),
  // then by type — useful for system states.
  return (
    STATE_COLORS[state.name] ||
    STATE_COLORS[state.type] ||
    { fg: "var(--text-3)", bg: "var(--bg-3)" }
  );
}

// Etiqueta en español del estado de Connect (los nombres llegan en inglés del
// routing profile). Los estados personalizados muestran su propio nombre.
const STATE_LABELS: Record<string, string> = {
  Available: "Disponible",
  Routable: "Disponible",
  Busy: "En llamada",
  CallingCustomer: "Marcando",
  AfterCallWork: "ACW",
  PendingBusy: "Ocupado",
  Offline: "Offline",
  Init: "Conectando…",
  Error: "Error",
  Lunch: "Almuerzo",
  Break: "Pausa",
  Training: "Capacitación",
  Meeting: "Reunión",
};
function labelFor(name: string): string {
  return STATE_LABELS[name] || name;
}

export function VoxTopbar() {
  const { user, signOut } = useAuth();
  const { isOnboarding } = useConnectAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { agentState, availableStates, changeAgentState, error } = useCCP();
  const [statusOpen, setStatusOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  if (!user) return null;
  // En onboarding (sin Connect) el chip de status/error no tiene sentido — el
  // CCPProvider tampoco se suscribe, así que cualquier `error` que quede es
  // de un render anterior y no aplica.
  const ccpError = isOnboarding ? null : error;

  // Build the current state object for color lookup. agentState is the name.
  const current =
    availableStates.find((s) => s.name === agentState) ||
    ({ name: agentState, type: "system" } as ConnectAgentState);
  const currentColor = colorFor(current);

  // Routable + agent-selectable states are the ones the agent can switch to
  // on their own. System states (Init, FailedConnectAgent, etc.) are filtered
  // out so the dropdown stays clean.
  const selectableStates = availableStates.filter((s) => s.type !== "system");

  return (
    <header className="app__topbar">
      <div className="tb__search">
        <Icon.Search size={14} />
        <input placeholder="Buscar contactos, agentes, casos, transcripciones…" />
        <span className="tb__kbd">{modifierLabel()} K</span>
      </div>

      <div className="tb__actions">
        {/* En onboarding mostramos un CTA a Integraciones en lugar del
            status pill, que sin Connect se queda en "Init" para siempre. */}
        {isOnboarding ? (
          <a
            href="/admin"
            className="tb__status"
            style={{ background: "var(--accent-amber-soft)", color: "var(--accent-amber)" }}
            title="Configurá tu Amazon Connect para activar el contact center"
          >
            <span className="dot" />
            Configurá Connect
          </a>
        ) : (
          <button
            className="tb__status"
            onClick={() => setStatusOpen((o) => !o)}
            style={{
              background: currentColor.bg,
              color: currentColor.fg,
            }}
            disabled={selectableStates.length === 0}
            title={
              selectableStates.length === 0
                ? "Esperando conexión con Amazon Connect…"
                : "Cambiar estado del agente"
            }
          >
            <span className="dot" />
            {labelFor(agentState)}
            <Icon.ChevDown size={12} style={{ opacity: 0.7 }} />
          </button>
        )}
        {statusOpen && selectableStates.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 42,
              right: 180,
              background: "var(--bg-1)",
              border: "1px solid var(--border-2)",
              borderRadius: 8,
              boxShadow: "var(--shadow-pop)",
              padding: 6,
              minWidth: 220,
              maxHeight: 320,
              overflow: "auto",
              zIndex: 100,
            }}
          >
            <div
              style={{
                padding: "6px 10px",
                fontSize: 10.5,
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 500,
              }}
            >
              Estado del agente · Amazon Connect
            </div>
            {selectableStates.map((s) => {
              const c = colorFor(s);
              const isCurrent = s.name === agentState;
              return (
                <button
                  type="button"
                  key={s.name}
                  onClick={() => {
                    changeAgentState(s);
                    setStatusOpen(false);
                  }}
                  className={`sb__item ${isCurrent ? "sb__item--active" : ""}`}
                  style={{ margin: 0, padding: "8px 10px" }}
                  aria-current={isCurrent ? "true" : undefined}
                >
                  <span
                    className="state-dot"
                    style={{ background: c.fg }}
                  />
                  <span className="sb__label">{labelFor(s.name)}</span>
                  {isCurrent && (
                    <Icon.Check size={12} style={{ color: c.fg }} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {ccpError && (
          <span
            className="chip chip--red"
            role="alert"
            title={ccpError}
            style={{ maxWidth: 220 }}
          >
            <span className="dot" />
            <span className="truncate">{ccpError}</span>
          </span>
        )}

        <div className="tb__divider" />

        <button
          className="tb__iconbtn"
          title="Tema"
          onClick={toggleTheme}
        >
          {resolvedTheme === "dark" ? (
            <Icon.Sun size={16} />
          ) : (
            <Icon.Moon size={16} />
          )}
        </button>
        <button className="tb__iconbtn" title="Notificaciones">
          <Icon.Bell size={16} />
        </button>
        <button
          className="tb__iconbtn"
          title="Cuenta"
          onClick={() => setUserMenu((o) => !o)}
        >
          <Icon.User size={16} />
        </button>
        {userMenu && (
          <div
            style={{
              position: "absolute",
              top: 42,
              right: 8,
              background: "var(--bg-1)",
              border: "1px solid var(--border-2)",
              borderRadius: 8,
              boxShadow: "var(--shadow-pop)",
              padding: 6,
              minWidth: 220,
              zIndex: 100,
            }}
          >
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-1)" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
                {user.username}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{user.email}</div>
            </div>
            <button
              type="button"
              className="sb__item"
              style={{ margin: 4, padding: "8px 10px" }}
              onClick={() => {
                setUserMenu(false);
                signOut();
              }}
            >
              <Icon.Logout className="sb__icon" size={14} />
              <span className="sb__label">Cerrar sesión</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
