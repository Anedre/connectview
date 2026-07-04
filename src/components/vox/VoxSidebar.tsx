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
  FlowArrow,
  Lightning,
  Sparkle,
  CalendarDots,
  ChartBar,
  Disc,
  Gear,
  MagnifyingGlass,
  CaretLeft,
  CaretRight,
  Check,
  type Icon as PhIcon,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { useConnectAuth } from "@/context/ConnectAuthContext";
import { useRoles } from "@/hooks/useRoles";
import { SECTION_COLOR } from "@/components/aria";
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
    id: "journeys",
    path: "/journeys",
    label: "Journeys",
    icon: FlowArrow,
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

interface VoxSidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function VoxSidebar({ collapsed, onToggleCollapse }: VoxSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { productName } = useConnectAuth();
  const { isAtLeast } = useRoles();

  // Renders the product name so "IA" (or the accent suffix) gets the gradient
  // treatment from the ARIA design system (.sb__name b).
  const name = productName || "ARIA";
  const splitAt = Math.max(1, name.length - 2);

  return (
    <aside className="sb">
      {onToggleCollapse && (
        <button
          type="button"
          className="sb__collapse"
          onClick={onToggleCollapse}
          title={collapsed ? "Expandir menú" : "Colapsar menú"}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          {collapsed ? <CaretRight size={13} /> : <CaretLeft size={13} />}
        </button>
      )}
      <div className="sb__brand">
        <img
          className="sb__brandmark"
          src="/brand/aria-mark-white.png"
          alt="ARIA"
          width={30}
          height={30}
          draggable={false}
        />
        <div className="sb__name">
          {name.slice(0, splitAt)}
          <b>{name.slice(splitAt)}</b>
        </div>
      </div>
      <button
        type="button"
        className="sb__search"
        onClick={() => window.dispatchEvent(new CustomEvent("aria:cmdk"))}
        title="Buscar o ejecutar (⌘K)"
      >
        <MagnifyingGlass size={16} />
        <span>Buscar o ejecutar…</span>
        <span className="kbd">⌘K</span>
      </button>
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
            (entry.path !== "/" && location.pathname.startsWith(entry.path + "/"));
          const color = SECTION_COLOR[entry.id] || "var(--accent)";
          return (
            <button
              type="button"
              key={entry.id}
              className={`sb__item ${active ? "sb__item--active" : ""}`}
              style={{ ["--_c" as string]: color } as CSSProperties}
              onClick={() => navigate(entry.path)}
              aria-current={active ? "page" : undefined}
            >
              {/* Peso premium por estado: activo = fill sólido (con su color de
                  sección); inactivo = duotone (con profundidad). */}
              <Icn className="sb__icon" size={18} weight={active ? "fill" : "duotone"} />
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
      <div className="sb__pinned">
        <div className="sb__section">Integraciones</div>
        {PINNED.map((p) => (
          <div key={p.id} className="sb__pin" title={`${p.label} · conectado`}>
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
            <span className="sb__label">{p.label}</span>
            <Check size={13} style={{ color: "var(--green)", flex: "0 0 auto" }} />
          </div>
        ))}
      </div>
      <VoxSidebarFooter />
    </aside>
  );
}
