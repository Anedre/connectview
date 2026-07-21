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
import { usePermissions } from "@/hooks/usePermissions";
import type { UserRole } from "@/types/auth";
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
  // Capacidad de VISIBILIDAD en la matriz de permisos (Configuración → Seguridad).
  // El rol mínimo sale de esa matriz EN VIVO — cambiarlo ahí re-escala el menú sin
  // deploy. `minRole` queda solo como fallback mientras la matriz carga (o si el
  // backend de permisos no responde), preservando el comportamiento por defecto.
  cap?: string;
  minRole?: UserRole;
}

type NavEntry = { section: string } | NavItem;

const NAV: NavEntry[] = [
  { section: "Operación" },
  { id: "home", path: "/", label: "Inicio", icon: House, cap: "view_home", minRole: "Agents" },
  {
    id: "call",
    path: "/agent",
    label: "Agent Desktop",
    icon: Headset,
    cap: "view_agent_desktop",
    minRole: "Agents",
  },
  {
    id: "inbox",
    path: "/inbox",
    label: "Conversaciones",
    icon: ChatsCircle,
    cap: "view_inbox",
    minRole: "Agents",
  },
  {
    id: "queue",
    path: "/queue",
    label: "Cola en vivo",
    icon: Stack,
    cap: "view_live_queue",
    minRole: "Supervisors",
  },
  { section: "Crecimiento" },
  {
    id: "programs",
    path: "/programs",
    label: "Programas",
    icon: GraduationCap,
    cap: "view_programs",
    minRole: "Supervisors",
  },
  {
    id: "leads",
    path: "/leads",
    label: "Leads",
    icon: UserPlus,
    cap: "view_leads",
    minRole: "Admins",
  },
  {
    id: "campaigns",
    path: "/campaigns",
    label: "Campañas",
    icon: Megaphone,
    cap: "view_campaigns",
    minRole: "Supervisors",
  },
  {
    id: "bots",
    path: "/bot",
    label: "Asistentes",
    icon: Robot,
    cap: "view_bots",
    minRole: "Admins",
  },
  {
    id: "journeys",
    path: "/journeys",
    label: "Journeys",
    icon: FlowArrow,
    cap: "view_journeys",
    minRole: "Admins",
  },
  {
    id: "automations",
    path: "/automations",
    label: "Automatizaciones",
    icon: Lightning,
    cap: "view_automations",
    minRole: "Admins",
  },
  // "Agente IA" se unificó dentro de Asistentes (/bot): un agente IA es un bot de
  // un nodo `ai_agent` (mismo runtime/tabla). El hub deja crear/editar ambos modos.
  // La ruta /agente sigue viva como el editor del modo IA (se abre desde el hub).
  {
    id: "appointments",
    path: "/appointments",
    label: "Citas",
    icon: CalendarDots,
    cap: "view_appointments",
    minRole: "Admins",
  },
  {
    id: "reports",
    path: "/reports",
    label: "Reportes",
    icon: ChartBar,
    cap: "view_reports",
    minRole: "Supervisors",
  },
  {
    id: "recordings",
    path: "/recordings",
    label: "Grabaciones",
    icon: Disc,
    cap: "view_recordings",
    minRole: "Supervisors",
  },
  { section: "Sistema" },
  {
    id: "admin",
    path: "/admin",
    label: "Configuración",
    icon: Gear,
    cap: "view_settings",
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
  // Matriz de permisos (Configuración → Seguridad). Es la fuente de verdad de la
  // VISIBILIDAD por rol: el rol mínimo de cada sección sale de aquí, en vivo.
  const { matrix } = usePermissions();

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
          {collapsed ? (
            <CaretRight size={14} weight="bold" />
          ) : (
            <CaretLeft size={14} weight="bold" />
          )}
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
          // Rol mínimo EFECTIVO: el de la matriz si ya cargó esa capacidad; si no
          // (aún cargando o sin backend), cae al minRole hardcodeado — así no hay
          // "flash" de secciones que luego desaparecen.
          const effMinRole = (entry.cap && matrix[entry.cap]) || entry.minRole;
          if (effMinRole && !isAtLeast(effMinRole as UserRole)) return null;
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
