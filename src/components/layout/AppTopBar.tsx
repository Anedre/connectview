import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sun, Moon, Question } from "@phosphor-icons/react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useCCP, type ConnectAgentState } from "@/hooks/useCCP";
import { useTopBarSlot } from "@/components/layout/TopBarSlot";
import { useTheme } from "@/context/ThemeContext";
import * as Icon from "@/components/vox/primitives";
import { ProgramSwitcher } from "@/components/layout/ProgramSwitcher";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { useDropdown } from "@/hooks/useDropdown";

/** ARIA sun/moon segmented theme toggle, wired to the real ThemeContext. */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div className="theme-tog" role="group" aria-label="Tema">
      <button
        type="button"
        className="fx-ico-spin"
        aria-pressed={resolvedTheme === "light"}
        onClick={() => setTheme("light")}
        title="Claro"
      >
        <Sun size={15} />
      </button>
      <button
        type="button"
        className="fx-ico-rock"
        aria-pressed={resolvedTheme === "dark"}
        onClick={() => setTheme("dark")}
        title="Oscuro"
      >
        <Moon size={15} />
      </button>
    </div>
  );
}

/**
 * AppTopBar — la barra superior unificada con el sidebar (chrome en "L"): el
 * logo ocupa la esquina y este top bar comparte altura + borde inferior, así
 * que la línea se ve continua. A la izquierda el breadcrumb (sección › página,
 * derivado de la ruta); a la derecha el estado del agente de Connect (subido
 * desde el dock del sidebar, como en el mockup). Tema/campana/cuenta siguen en
 * el dock del pie del sidebar.
 */

const STATE_COLORS: Record<string, { fg: string; bg: string }> = {
  Available: { fg: "var(--accent-green)", bg: "var(--accent-green-soft)" },
  Routable: { fg: "var(--accent-green)", bg: "var(--accent-green-soft)" },
  Busy: { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)" },
  CallingCustomer: { fg: "var(--accent-cyan)", bg: "var(--accent-cyan-soft)" },
  AfterCallWork: { fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)" },
  PendingBusy: { fg: "var(--accent-amber)", bg: "var(--accent-amber-soft)" },
  Offline: { fg: "var(--text-3)", bg: "var(--bg-3)" },
  Init: { fg: "var(--text-3)", bg: "var(--bg-3)" },
  Error: { fg: "var(--accent-red)", bg: "var(--accent-red-soft)" },
  FailedConnectAgent: { fg: "var(--accent-red)", bg: "var(--accent-red-soft)" },
  FailedConnect: { fg: "var(--accent-red)", bg: "var(--accent-red-soft)" },
};
function colorFor(s: ConnectAgentState): { fg: string; bg: string } {
  return STATE_COLORS[s.name] || STATE_COLORS[s.type] || { fg: "var(--text-3)", bg: "var(--bg-3)" };
}
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
  FailedConnectAgent: "No conectó",
  FailedConnect: "No conectó",
  Lunch: "Almuerzo",
  Break: "Pausa",
  Training: "Capacitación",
  Meeting: "Reunión",
};
const labelFor = (n: string) => STATE_LABELS[n] || n;

/** Ruta → migaja (sección › página). Espejo del NAV del sidebar. */
const CRUMBS: Record<string, { section: string; label: string }> = {
  "/": { section: "Operación", label: "Inicio" },
  "/agent": { section: "Operación", label: "Agent Desktop" },
  "/queue": { section: "Operación", label: "Cola en vivo" },
  "/programs": { section: "Crecimiento", label: "Programas" },
  "/leads": { section: "Crecimiento", label: "Leads" },
  "/campaigns": { section: "Crecimiento", label: "Campañas" },
  "/bot": { section: "Crecimiento", label: "Asistentes" },
  "/journeys": { section: "Crecimiento", label: "Flujos · Recorrido" },
  "/automations": { section: "Crecimiento", label: "Flujos" },
  "/agente": { section: "Crecimiento", label: "Asistentes · IA" },
  "/appointments": { section: "Crecimiento", label: "Citas" },
  "/reports": { section: "Crecimiento", label: "Reportes" },
  "/recordings": { section: "Crecimiento", label: "Grabaciones" },
  "/admin": { section: "Sistema", label: "Configuración" },
};
function crumbFor(path: string): { section: string; label: string } {
  if (CRUMBS[path]) return CRUMBS[path];
  const hit = Object.keys(CRUMBS)
    .filter((k) => k !== "/" && path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? CRUMBS[hit] : { section: "ARIA", label: "" };
}

export function AppTopBar() {
  const location = useLocation();
  const crumb = crumbFor(location.pathname);
  const { isOnboarding } = useConnectAuth();
  const { agentState, availableStates, changeAgentState, error } = useCCP();
  const pageActions = useTopBarSlot();
  // Desplegable de estado: abre al hover, cierra al salir / click afuera / Escape.
  const statusDd = useDropdown({ hover: true });
  const [helpOpen, setHelpOpen] = useState(false);

  const ccpError = isOnboarding ? null : error;
  const current =
    availableStates.find((s) => s.name === agentState) ||
    ({ name: agentState, type: "system" } as ConnectAgentState);
  const c = colorFor(current);
  const selectable = availableStates.filter((s) => s.type !== "system");

  return (
    <header className="tb">
      <nav className="tb__crumb" aria-label="Ruta">
        <span>{crumb.section}</span>
        {crumb.label && (
          <>
            <Icon.ChevRight size={13} />
            <b>{crumb.label}</b>
          </>
        )}
      </nav>

      <ProgramSwitcher />

      <div className="tb__spacer" />

      <div className="tbx__right">
        <ThemeToggle />

        {ccpError && (
          <span className="chip chip--red" role="alert" title={ccpError} style={{ maxWidth: 240 }}>
            <span className="dot" /> <span className="truncate">{ccpError}</span>
          </span>
        )}

        <div className="tbx__status-wrap" {...statusDd.wrapProps}>
          {isOnboarding ? (
            <Link
              to="/admin"
              className="tbx__status"
              style={{ background: "var(--accent-amber-soft)", color: "var(--accent-amber)" }}
              title="Configura tu Amazon Connect para activar el contact center"
            >
              <span className="dot" /> Configura Connect
            </Link>
          ) : (
            <button
              className="tbx__status"
              onClick={statusDd.toggle}
              style={{ background: c.bg, color: c.fg }}
              disabled={selectable.length === 0}
              title={
                selectable.length === 0
                  ? "Esperando conexión con Amazon Connect…"
                  : "Cambiar estado del agente"
              }
            >
              <span className="dot" />
              {labelFor(agentState)}
              {selectable.length > 0 && <Icon.ChevDown size={12} style={{ opacity: 0.7 }} />}
            </button>
          )}

          {statusDd.open && selectable.length > 0 && (
            <div className="tbx__menu">
              <div className="tbx__menu-head">Estado del agente · Amazon Connect</div>
              {selectable.map((s) => {
                const sc = colorFor(s);
                const isCurrent = s.name === agentState;
                return (
                  <button
                    type="button"
                    key={s.name}
                    onClick={() => {
                      changeAgentState(s);
                      statusDd.close();
                    }}
                    className={`sb__item ${isCurrent ? "sb__item--active" : ""}`}
                    style={{ margin: 0, padding: "8px 10px" }}
                    aria-current={isCurrent ? "true" : undefined}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: sc.fg,
                        flex: "0 0 auto",
                      }}
                    />
                    <span className="sb__label">{labelFor(s.name)}</span>
                    {isCurrent && <Icon.Check size={12} style={{ color: sc.fg }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {pageActions && <div className="tbx__pageactions">{pageActions}</div>}

        <button
          type="button"
          className="tb__ico fx-ico-wiggle"
          title="Ayuda y atajos"
          onClick={() => setHelpOpen(true)}
        >
          <Question size={18} />
        </button>

        <NotificationsBell placement="down" />
      </div>

      {/* Ayuda → atajos de teclado (controlado por el botón "?"). */}
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </header>
  );
}
