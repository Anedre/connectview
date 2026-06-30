import { useLocation, useNavigate } from "react-router-dom";
import {
  House,
  Headset,
  Stack,
  ChatsCircle,
  GraduationCap,
  UserPlus,
  Megaphone,
  Robot,
  Lightning,
  Sparkle,
  CalendarDots,
  ChartBar,
  Disc,
  Gear,
  type Icon as PhIcon,
} from "@phosphor-icons/react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useRoles } from "@/hooks/useRoles";
import { VoxSidebarFooter } from "./VoxSidebarFooter";

interface NavItem {
  id: string;
  path: string;
  label: string;
  // Iconos Phosphor: en el render usan weight "regular" (inactivo) y "fill"
  // (activo) para marcar la sección actual con un relleno premium.
  icon: PhIcon;
  count?: string;
  alert?: boolean;
  minRole?: "Agents" | "Supervisors" | "Admins";
}

type NavEntry = { section: string } | NavItem;

const NAV: NavEntry[] = [
  { section: "Operación" },
  { id: "home", path: "/", label: "Inicio", icon: House, minRole: "Agents" },
  {
    id: "call",
    path: "/agent",
    label: "Agent Desktop",
    icon: Headset,
    minRole: "Agents",
  },
  {
    id: "inbox",
    path: "/inbox",
    label: "Conversaciones",
    icon: ChatsCircle,
    minRole: "Agents",
  },
  {
    id: "queue",
    path: "/queue",
    label: "Cola en vivo",
    icon: Stack,
    minRole: "Supervisors",
  },
  { section: "Crecimiento" },
  {
    id: "programs",
    path: "/programs",
    label: "Programas",
    icon: GraduationCap,
    minRole: "Supervisors",
  },
  {
    id: "leads",
    path: "/leads",
    label: "Leads",
    icon: UserPlus,
    minRole: "Admins",
  },
  {
    id: "campaigns",
    path: "/campaigns",
    label: "Campañas",
    icon: Megaphone,
    minRole: "Admins",
  },
  {
    id: "bots",
    path: "/bot",
    label: "Bots",
    icon: Robot,
    minRole: "Admins",
  },
  {
    id: "automations",
    path: "/automations",
    label: "Automatizaciones",
    icon: Lightning,
    minRole: "Admins",
  },
  {
    id: "agente",
    path: "/agente",
    label: "Agente IA",
    icon: Sparkle,
    minRole: "Admins",
  },
  {
    id: "appointments",
    path: "/appointments",
    label: "Citas",
    icon: CalendarDots,
    minRole: "Admins",
  },
  {
    id: "reports",
    path: "/reports",
    label: "Reportes",
    icon: ChartBar,
    minRole: "Supervisors",
  },
  {
    id: "recordings",
    path: "/recordings",
    label: "Grabaciones",
    icon: Disc,
    minRole: "Supervisors",
  },
  { section: "Sistema" },
  {
    id: "admin",
    path: "/admin",
    label: "Configuración",
    icon: Gear,
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
  const { productName } = useConnectAuth();
  const { isAtLeast } = useRoles();

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
              <Icn className="sb__icon" size={18} weight={active ? "fill" : "regular"} />
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
      <VoxSidebarFooter />
    </aside>
  );
}
