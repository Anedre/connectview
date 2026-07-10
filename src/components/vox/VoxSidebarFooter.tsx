import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useCCP } from "@/hooks/useCCP";
import { roleLabelOf } from "@/types/auth";
import * as Icon from "./primitives";
import { initialsOf } from "./primitives";
import { NotificationsBell } from "@/components/layout/NotificationsBell";

/**
 * VoxSidebarFooter — el "dock" al pie del sidebar: identidad del usuario + tema,
 * notificaciones y cuenta. El estado del agente de Connect (Disponible…) vive
 * ahora en el `AppTopBar` (como en el mockup); aquí solo queda un punto de
 * presencia sobre el avatar. El menú de cuenta abre hacia ARRIBA.
 */

const PRESENCE: Record<string, string> = {
  Available: "var(--accent-green)",
  Routable: "var(--accent-green)",
  Busy: "var(--accent-cyan)",
  CallingCustomer: "var(--accent-cyan)",
  AfterCallWork: "var(--accent-amber)",
  PendingBusy: "var(--accent-amber)",
  Offline: "var(--text-3)",
  Init: "var(--text-3)",
  Error: "var(--accent-red)",
};

export function VoxSidebarFooter() {
  const { user: authUser, signOut } = useAuth();
  const { user: cUser } = useConnectAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { agentState } = useCCP();
  const [userMenu, setUserMenu] = useState(false);

  const username = cUser?.username ?? authUser?.username ?? "—";
  const initials = initialsOf(username);
  const roleLabel = roleLabelOf(cUser?.highestRole);
  const presence = PRESENCE[agentState] ?? "var(--text-3)";

  return (
    <div className="sb__dock">
      <div className="sb__footer">
        <div className="sb__user-avatar" style={{ position: "relative" }}>
          {initials}
          <span className="sb__user-presence" style={{ background: presence }} />
        </div>
        <div className="sb__user-meta">
          <div className="sb__user-name">{username}</div>
          <div className="sb__user-role">{roleLabel}</div>
        </div>
        <button className="sb__dockbtn" title="Tema" onClick={toggleTheme}>
          {resolvedTheme === "dark" ? <Icon.Sun size={15} /> : <Icon.Moon size={15} />}
        </button>
        <NotificationsBell placement="up" buttonClassName="sb__dockbtn" iconSize={15} />
        <button className="sb__dockbtn" title="Cuenta" onClick={() => setUserMenu((o) => !o)}>
          <Icon.User size={15} />
        </button>
      </div>

      {/* Menú de cuenta — abre hacia arriba */}
      {userMenu && (
        <div className="sb__menu">
          <div className="sb__menu-acct">
            <div className="sb__menu-acct-name">{username}</div>
            {authUser?.email && <div className="sb__menu-acct-mail">{authUser.email}</div>}
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

      {userMenu && (
        <div
          onClick={() => setUserMenu(false)}
          style={{ position: "fixed", inset: 0, zIndex: 150 }}
        />
      )}
    </div>
  );
}
