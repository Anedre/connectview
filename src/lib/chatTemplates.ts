/**
 * Canned-response library for the agent chat composer. Templates are
 * organised by category and support `{{var}}` interpolation against a
 * runtime context built from the active contact (customer name, agent
 * username, queue, current time).
 *
 * Storage is currently inlined here so a non-developer can edit and we
 * deploy a frontend change. If/when the list grows past ~50 we should
 * move it to a DynamoDB table + admin CRUD UI.
 */

export type TemplateCategory =
  | "bienvenida"
  | "espera"
  | "info"
  | "cierre"
  | "despedida"
  | "reagenda";

export interface ChatTemplate {
  id: string;
  category: TemplateCategory;
  /** Short label shown in the popover list. */
  title: string;
  /** Message body with optional {{var}} placeholders. */
  body: string;
}

export const TEMPLATE_CATEGORIES: Array<{ id: TemplateCategory; label: string; emoji: string }> = [
  { id: "bienvenida", label: "Bienvenida", emoji: "👋" },
  { id: "espera", label: "Espera", emoji: "⏳" },
  { id: "info", label: "Información", emoji: "ℹ️" },
  { id: "reagenda", label: "Reagendar", emoji: "📅" },
  { id: "cierre", label: "Cierre", emoji: "✅" },
  { id: "despedida", label: "Despedida", emoji: "👋" },
];

export const CHAT_TEMPLATES: ChatTemplate[] = [
  // ─── Bienvenida ────────────────────────────────────────────────
  {
    id: "saludo-basico",
    category: "bienvenida",
    title: "Saludo básico",
    body: "Hola {{nombre}} 👋, te saluda {{agente}}. ¿En qué te puedo ayudar hoy?",
  },
  {
    id: "saludo-comercial",
    category: "bienvenida",
    title: "Saludo comercial",
    body: "Hola {{nombre}}, soy {{agente}}. Vi tu interés en nuestra información. ¿Te gustaría que conversemos?",
  },
  {
    id: "saludo-followup",
    category: "bienvenida",
    title: "Seguimiento previo",
    body: "Hola {{nombre}}, retomamos contigo desde una conversación anterior. ¿Cómo va tu proceso? ¿Quedó alguna duda pendiente?",
  },

  // ─── Espera ────────────────────────────────────────────────────
  {
    id: "espera-momento",
    category: "espera",
    title: "Un momento por favor",
    body: "Un momento por favor {{nombre}}, estoy revisando tu caso 🙏",
  },
  {
    id: "espera-consultando",
    category: "espera",
    title: "Consultando sistema",
    body: "Permíteme consultar la información en nuestro sistema. Te respondo en menos de 2 minutos ⏳",
  },
  {
    id: "espera-area",
    category: "espera",
    title: "Coordinando con área",
    body: "Estoy coordinando con el área correspondiente para darte una respuesta precisa. ¿Me das unos minutos?",
  },

  // ─── Información ───────────────────────────────────────────────
  {
    id: "info-horario",
    category: "info",
    title: "Horario de atención",
    body: "Nuestro horario de atención es de lunes a viernes de 9:00 a.m. a 6:00 p.m. ¿Te ayudo con algo más?",
  },
  {
    id: "info-canales",
    category: "info",
    title: "Canales de contacto",
    body: "Puedes contactarnos por:\n📞 Llamada\n💬 WhatsApp (este canal)\n📧 Email\n🌐 Web\n\nElige el que más te convenga.",
  },
  {
    id: "info-ampliar",
    category: "info",
    title: "Ampliar información",
    body: "Con gusto te amplío la información que necesites. ¿Te gustaría que coordinemos una llamada o reunión para verlo en detalle?",
  },

  // ─── Reagenda ──────────────────────────────────────────────────
  {
    id: "reagenda-cuando",
    category: "reagenda",
    title: "¿Cuándo te llamamos?",
    body: "Claro {{nombre}}, agendemos una llamada cuando te quede mejor. ¿Qué día y hora te acomoda? 📅",
  },
  {
    id: "reagenda-confirmar",
    category: "reagenda",
    title: "Confirmar reagenda",
    body: "Perfecto, queda agendado. Un asesor te contactará en la fecha y hora acordadas. Gracias por tu disponibilidad 🙌",
  },

  // ─── Cierre ────────────────────────────────────────────────────
  {
    id: "cierre-resuelto",
    category: "cierre",
    title: "Consulta resuelta",
    body: "¿Quedó resuelta tu consulta {{nombre}}? Si surge alguna otra duda, no dudes en escribirnos.",
  },
  {
    id: "cierre-encuesta",
    category: "cierre",
    title: "Invitar a encuesta",
    body: "Gracias por tu tiempo {{nombre}}. Al terminar este chat recibirás una breve encuesta — tu opinión nos ayuda a mejorar 🙏",
  },

  // ─── Despedida ─────────────────────────────────────────────────
  {
    id: "despedida-amable",
    category: "despedida",
    title: "Despedida amable",
    body: "Gracias por contactarnos {{nombre}}. Que tengas un excelente día 🌟",
  },
  {
    id: "despedida-followup",
    category: "despedida",
    title: "Quedo atento",
    body: "Quedo atento para cualquier consulta adicional. Si no respondes, te contactaré nuevamente en las próximas horas. ¡Hasta pronto {{nombre}}! 👋",
  },
];

export interface TemplateContext {
  /** Customer's first name or full name. Falls back to "estimado/a". */
  customerName?: string;
  /** Logged-in agent username — what the customer should see in the bubble. */
  agentName?: string;
  /** Queue / business unit the agent is taking the chat in. */
  queueName?: string;
  /** Defaults to the current locale time when not provided. */
  timeIso?: string;
}

/**
 * Replace every {{var}} in the body with the matching context value.
 * Unknown placeholders are left in place so the agent notices and can
 * fix them before sending — better than silently sending "{{nombre}}".
 */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const time = ctx.timeIso ? new Date(ctx.timeIso) : new Date();
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");

  const vars: Record<string, string> = {
    nombre: ctx.customerName?.trim() || "estimado/a",
    agente: ctx.agentName?.trim() || "tu asesor",
    cola: ctx.queueName?.trim() || "",
    hora: `${hh}:${mm}`,
    fecha: time.toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  };

  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (full, key: string) => {
    const v = vars[key.toLowerCase()];
    return v != null ? v : full;
  });
}

/**
 * Returns the active variable names in a body so the popover preview
 * can flag templates that depend on context the agent hasn't provided.
 */
export function listTemplateVars(body: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([a-z_]+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}
