/**
 * copilotActions — registro ÚNICO de acciones que ARIA puede recomendar/ejecutar.
 * Lo consume (1) el Copilot para renderizar botones en sus respuestas y (2) —a
 * futuro— el motor de recomendaciones ("Recomendado para ti"). Tener un solo
 * catálogo evita rutas muertas y acciones inventadas por el modelo.
 */

/** Navegación permitida. El modelo SOLO puede linkear a estas rutas; el front
 *  descarta cualquier marcador `go` cuya ruta no esté acá (rutas reales de App.tsx). */
export const NAV_ACTIONS: { route: string; label: string; hint: string }[] = [
  { route: "/leads", label: "Leads", hint: "gestionar y priorizar leads" },
  { route: "/inbox", label: "Bandeja", hint: "conversaciones omnicanal (IG/WA/Messenger)" },
  {
    route: "/campaigns/nueva",
    label: "Nueva campaña",
    hint: "crear una campaña de voz o WhatsApp",
  },
  { route: "/campaigns", label: "Campañas", hint: "ver y controlar campañas" },
  { route: "/bot", label: "Asistentes", hint: "crear o editar un asistente — guion o IA" },
  { route: "/automations", label: "Flujos", hint: "reflejos (reglas) y recorridos (journeys)" },
  {
    route: "/journeys",
    label: "Flujos · Recorridos",
    hint: "journeys de nurturing/seguimiento en el tiempo",
  },
  { route: "/agente", label: "Asistente IA", hint: "editor del asistente de IA" },
  { route: "/reports", label: "Reportes", hint: "métricas, dashboards y descargas" },
  { route: "/recordings", label: "Grabaciones", hint: "historial de llamadas y chats" },
  { route: "/appointments", label: "Citas", hint: "agenda de citas del agente" },
  { route: "/programs", label: "Programas", hint: "programas / unidades comerciales" },
  { route: "/admin", label: "Configuración", hint: "integraciones, catálogos, WhatsApp, equipo" },
];

const NAV_SET = new Set(NAV_ACTIONS.map((a) => a.route));

/** ¿La ruta (con o sin query `?…`) está en el whitelist? */
export function isAllowedRoute(route: string): boolean {
  return NAV_SET.has(route.split("?")[0]);
}

/** Acciones EJECUTABLES en el propio bloque del chat. Efecto real → `confirm`. */
export type ExecAction = {
  id: string;
  label: string;
  /** Si está presente, se pide confirmación antes de ejecutar. */
  confirm?: string;
};

export const EXEC_ACTIONS: Record<string, ExecAction> = {
  "task.new": { id: "task.new", label: "Crear tarea" },
};

/** Dispara una acción ejecutable vía evento global; los overlays (TasksLauncher,
 *  etc.) lo escuchan y reaccionan. Desacopla al Copilot de cada componente. */
export const COPILOT_ACTION_EVENT = "aria:copilot-action";
export function runExecAction(id: string): void {
  window.dispatchEvent(new CustomEvent(COPILOT_ACTION_EVENT, { detail: { id } }));
}

/** Catálogo en texto para meterlo en el prompt del modelo (rutas + acciones). */
export function actionsPromptCatalog(): { routes: string; execs: string } {
  return {
    routes: NAV_ACTIONS.map((a) => `${a.route} (${a.hint})`).join("; "),
    execs: Object.values(EXEC_ACTIONS)
      .map((a) => `${a.id} (${a.label})`)
      .join("; "),
  };
}
