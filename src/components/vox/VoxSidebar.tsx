import { useLocation, useNavigate } from "react-router-dom";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useRoles } from "@/hooks/useRoles";
import { useCCP } from "@/hooks/useCCP";
import { roleLabelOf } from "@/types/auth";
import * as Icon from "./primitives";
import { initialsOf } from "./primitives";

const PRESENCE_COLOR: Record<string, { color: string; soft: string; label: string }> = {
  Available:       { color: "var(--accent-green)", soft: "var(--accent-green-soft)", label: "Disponible" },
  Routable:        { color: "var(--accent-green)", soft: "var(--accent-green-soft)", label: "Disponible" },
  Busy:            { color: "var(--accent-cyan)",  soft: "var(--accent-cyan-soft)",  label: "En llamada" },
  CallingCustomer: { color: "var(--accent-cyan)",  soft: "var(--accent-cyan-soft)",  label: "Marcando" },
  AfterCallWork:   { color: "var(--accent-amber)", soft: "var(--accent-amber-soft)", label: "ACW" },
  PendingBusy:     { color: "var(--accent-amber)", soft: "var(--accent-amber-soft)", label: "Pendiente" },
  Offline:         { color: "var(--text-3)",       soft: "var(--bg-3)",              label: "Offline" },
  Init:            { color: "var(--text-3)",       soft: "var(--bg-3)",              label: "Inicializando" },
  Error:           { color: "var(--accent-red)",   soft: "var(--accent-red-soft)",   label: "Error" },
};

interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: (typeof Icon)[
    | "Home"
    | "Phone"
    | "Queue"
    | "ContactCard"
    | "Ticket"
    | "Megaphone"
    | "Workflow"
    | "Chart"
    | "Sparkles"
    | "Settings"
    | "Disc"];
  count?: string;
  alert?: boolean;
  minRole?: "Agents" | "Supervisors" | "Admins";
}

type NavEntry = { section: string } | NavItem;

const NAV: NavEntry[] = [
  { section: "Operación" },
  { id: "home", path: "/", label: "Inicio", icon: Icon.Home, minRole: "Agents" },
  {
    id: "call",
    path: "/agent",
    label: "Agent Desktop",
    icon: Icon.Phone,
    minRole: "Agents",
  },
  {
    id: "queue",
    path: "/queue",
    label: "Cola en vivo",
    icon: Icon.Queue,
    minRole: "Supervisors",
  },
  { section: "Crecimiento" },
  {
    id: "leads",
    path: "/leads",
    label: "Leads",
    icon: Icon.Users,
    minRole: "Admins",
  },
  {
    id: "campaigns",
    path: "/campaigns",
    label: "Campañas",
    icon: Icon.Megaphone,
    minRole: "Admins",
  },
  {
    id: "bots",
    path: "/bot",
    label: "Bots",
    icon: Icon.Workflow,
    minRole: "Admins",
  },
  {
    id: "agente",
    path: "/agente",
    label: "Agente IA",
    icon: Icon.Sparkles,
    minRole: "Admins",
  },
  {
    id: "appointments",
    path: "/appointments",
    label: "Citas",
    icon: Icon.Calendar,
    minRole: "Admins",
  },
  {
    id: "reports",
    path: "/reports",
    label: "Reportes",
    icon: Icon.Chart,
    minRole: "Supervisors",
  },
  {
    id: "recordings",
    path: "/recordings",
    label: "Grabaciones",
    icon: Icon.Disc,
    minRole: "Supervisors",
  },
  { section: "Sistema" },
  {
    id: "admin",
    path: "/admin",
    label: "Configuración",
    icon: Icon.Settings,
    minRole: "Admins",
  },
];

/** Pinned integrations shown at the bottom of the sidebar (Kommo-style). */
const PINNED = [
  { id: "wa", label: "WhatsApp", color: "#25D366" },
  { id: "sf", label: "Salesforce", color: "#00A1E0" },
  { id: "connect", label: "Amazon Connect", color: "#FF9900" },
];

function isItem(e: NavEntry): e is NavItem {
  return (e as NavItem).id !== undefined;
}

export function VoxSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, productName } = useConnectAuth();
  const { isAtLeast } = useRoles();
  const { agentState } = useCCP();

  const presence =
    PRESENCE_COLOR[agentState] ?? PRESENCE_COLOR.Init;

  const initials = initialsOf(user?.username);
  // Use the centralized label so the sidebar matches every other
  // place that shows the role chip (was previously its own ad-hoc
  // mapping that called "Admins" → "Manager", introducing the
  // dual-terminology problem reported in Bug #19).
  const roleLabel = roleLabelOf(user?.highestRole);

  return (
    <aside className="app__sidebar">
      <div className="sb__brand">
        <div className="sb__logo" />
        <div className="sb__name">
          {productName}
        </div>
      </div>
      <nav className="sb__nav">
        {NAV.map((entry, i) => {
          if (!isItem(entry)) {
            return (
              <div key={`s${i}`} className="sb__section">
                {entry.section}
              </div>
            );
          }
          if (entry.minRole && !isAtLeast(entry.minRole)) return null;
          const Icn = entry.icon;
          const active =
            location.pathname === entry.path ||
            (entry.path !== "/" && location.pathname.startsWith(entry.path));
          return (
            <button
              type="button"
              key={entry.id}
              className={`sb__item ${active ? "sb__item--active" : ""}`}
              onClick={() => navigate(entry.path)}
              aria-current={active ? "page" : undefined}
            >
              <Icn className="sb__icon" size={16} />
              <div className="sb__label">{entry.label}</div>
              {entry.count && (
                <div className={`sb__count ${entry.alert ? "sb__count--alert" : ""}`}>
                  {entry.count}
                </div>
              )}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "0 8px 8px" }}>
        <div className="sb__section">Integraciones</div>
        {PINNED.map((p) => (
          <div
            key={p.id}
            title={`${p.label} · conectado`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 10px",
              fontSize: 13,
              color: "var(--text-2)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: p.color,
                boxShadow: `0 0 0 3px ${p.color}22`,
                flex: "0 0 auto",
              }}
            />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.label}
            </span>
          </div>
        ))}
      </div>
      <div className="sb__footer">
        <div className="sb__user-avatar">{initials}</div>
        <div className="sb__user-meta">
          <div className="sb__user-name">{user?.username ?? "—"}</div>
          <div className="sb__user-role">{roleLabel}</div>
        </div>
        <div
          className="sb__presence"
          title={presence.label}
          style={{ background: presence.color, boxShadow: `0 0 0 3px ${presence.soft}` }}
        />
      </div>
    </aside>
  );
}
