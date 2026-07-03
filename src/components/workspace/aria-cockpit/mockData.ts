/* ============================================================
   ARIA · Agent Cockpit — MOCK DATA (portada de aria-agent.jsx)
   Solo se usa en el MODO "Vista demo" del Agent Desktop. NADA de
   esto toca el softphone real; es data estática para poder VER
   todos los estados (idle · tareas · entrante · en llamada ·
   wrap-up) sin una llamada real de Amazon Connect.
   ============================================================ */

export interface DemoContact {
  id: string;
  name: string;
  channel: "voz" | "wa" | "email" | "tarea";
  prog: string;
  phone: string;
  stage: string;
  score: number;
  unread?: number;
  unknown?: boolean;
}

export interface DemoTx {
  who: "Agente" | "Cliente";
  s: "neutral" | "positivo" | "mixto" | "negativo";
  text: string;
}

export interface DemoMoment {
  t: string;
  label: string;
  tone: string;
}

export interface DemoWa {
  dir: "in" | "out";
  text: string;
  t: string;
}

export interface DemoTask {
  id: string;
  tipo: "callback" | "followup";
  t: string;
  m: string;
  prog: string;
  due: string;
  prio: "alta" | "media" | "baja";
  phone?: string;
  overdue?: boolean;
}

export const AG_CONTACTS: DemoContact[] = [
  { id: "k1", name: "Andre Alata Calle", channel: "voz", prog: "ADM-27I", phone: "+51 704 989 78", stage: "Interesado", score: 78 },
  { id: "k2", name: "Sofía Quispe Mamani", channel: "wa", prog: "PVER-27", phone: "+51 987 112 004", stage: "Contactado", score: 64, unread: 2 },
  { id: "k3", name: "Diego Ramírez Salas", channel: "email", prog: "DIP-GP", phone: "diego.ramirez@correo.com", stage: "Información enviada", score: 55, unread: 1 },
  { id: "k4", name: "Valeria Castro Núñez", channel: "tarea", prog: "ADM-27I", phone: "+51 962 383 768", stage: "Promesa de matrícula", score: 71 },
];

export const AG_TX: DemoTx[] = [
  { who: "Agente", s: "neutral", text: "Buenas tardes, le saluda Camila de ARIA. ¿Hablo con el señor Andre?" },
  { who: "Cliente", s: "neutral", text: "Sí, con él. Lo llamo por la admisión 2027." },
  { who: "Cliente", s: "positivo", text: "Vi el brochure de Ingeniería de Sistemas y me interesó." },
  { who: "Agente", s: "neutral", text: "¡Excelente elección! Le explico proceso y fechas clave." },
  { who: "Cliente", s: "mixto", text: "Me preocupa el costo y si hay becas…" },
];

export const AG_MOM: DemoMoment[] = [
  { t: "0:22", label: "Motivo: info admisión", tone: "var(--text-3)" },
  { t: "1:04", label: "Interés: Ing. Sistemas", tone: "var(--green)" },
  { t: "2:41", label: "Objeción: costo / becas", tone: "var(--gold)" },
];

export const AG_WA: DemoWa[] = [
  { dir: "in", text: "Hola, ¿siguen abiertas las inscripciones de verano?", t: "5:20 p.m." },
  { dir: "out", text: "¡Hola Sofía! Sí, hasta el 15 de agosto 🙌", t: "5:22 p.m." },
  { dir: "in", text: "¿Y hay modalidad de pago en cuotas?", t: "5:24 p.m." },
];

export const COP: Record<string, [string, string][]> = {
  guiones: [
    ["Apertura", "Preséntate y confirma identidad antes de dar información."],
    ["Cierre", "Resume acuerdos y confirma próximo paso (cita o pago)."],
    ["Despedida", "Agradece y menciona el envío de confirmación por WhatsApp."],
  ],
  objeciones: [
    ["“Está caro”", "Enfoca valor + programa de becas por mérito (hasta 50%)."],
    ["“Lo voy a pensar”", "Ofrece agendar cita con asesoría, sin presionar el cierre."],
    ["“No tengo tiempo”", "Propón WhatsApp con la info y una llamada breve mañana."],
  ],
  conocimiento: [
    ["Becas 2027", "Por mérito (hasta 50%) y socioeconómica. Requiere constancia."],
    ["Fechas clave", "Inscripción hasta 15/ago · examen 30/ago · inicio marzo."],
    ["Costo Ing. Sistemas", "Matrícula + 5 cuotas. Link de pago desde el panel."],
  ],
};

export const C360: {
  perfil: [string, string][];
  historial: { i: string; c: string; t: string; m: string }[];
} = {
  perfil: [
    ["Etapa", "Interesado"],
    ["Programa", "ADM-27I"],
    ["Score", "78"],
    ["Origen", "Meta Ads"],
    ["UTM", "adm-27i"],
    ["Teléfono", "+51 704 989 78"],
  ],
  historial: [
    { i: "wa", c: "var(--ch-wa)", t: "WhatsApp · 12 mensajes", m: "hace 6 días" },
    { i: "missed", c: "var(--red)", t: "Llamada perdida", m: "hace 8 días" },
    { i: "mail", c: "var(--ch-email)", t: "Email · Consulta admisión", m: "hace 22 días" },
  ],
};

export const DISPO: string[] = [
  "Interesado",
  "Información enviada",
  "Promesa de matrícula",
  "Reagendar",
  "No contesta",
  "No interesado",
];

export const AG_TASKS: DemoTask[] = [
  { id: "t1", tipo: "callback", t: "Rellamar a Carlos Huamán", m: "Promesa de matrícula vence hoy", prog: "ADM-27I", due: "Hoy 5:30 p.m.", prio: "alta", phone: "+51 951 880 220" },
  { id: "t2", tipo: "followup", t: "Enviar becas a Sofía Quispe", m: "Pidió info de becas por WhatsApp", prog: "PVER-27", due: "Hoy 6:00 p.m.", prio: "media" },
  { id: "t3", tipo: "callback", t: "Confirmar cita — Valeria Castro", m: "Cita mañana 10:00 a.m.", prog: "DIP-GP", due: "Mañana", prio: "media", phone: "+51 962 383 768" },
  { id: "t4", tipo: "callback", t: "2º intento — Raúl Mendoza", m: "No contestó ayer", prog: "EC-Q1", due: "Vencida", prio: "alta", phone: "+51 987 000 111", overdue: true },
];

/** Programas para el <select> de "crear lead al vuelo" en el modo demo. */
export const DEMO_PROGRAMAS: { id: string; nombre: string }[] = [
  { id: "adm27", nombre: "Admisión 2027 — Ing. Sistemas" },
  { id: "pver27", nombre: "Programa Verano 2027" },
  { id: "dipgp", nombre: "Diplomado Gestión de Proyectos" },
];

/** Meta por canal para los badges de las pestañas de contacto. */
export const CH_META: Record<string, { icon: string; color: string }> = {
  voz: { icon: "phone", color: "var(--ch-voz, var(--cyan))" },
  wa: { icon: "wa", color: "var(--ch-wa, var(--green))" },
  email: { icon: "mail", color: "var(--ch-email, var(--gold))" },
  tarea: { icon: "check", color: "var(--iris)" },
};

/* ------------------------------------------------------------------
   Email en llamada (hilo estilo Gmail) — mock del EmailThreadPanel real.
------------------------------------------------------------------ */
export interface DemoEmail {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  attachments: { name: string; size: string }[];
}

export const AG_EMAIL: DemoEmail = {
  from: "diego.ramirez@correo.com",
  fromName: "Diego Ramírez Salas",
  to: "admision-udep@novasys.email.connect.aws",
  subject: "Consulta sobre el Diplomado en Gestión de Proyectos",
  date: "Hoy, 3:14 p.m.",
  body:
    "Buenas tardes:\n\nVi la información del Diplomado en Gestión de Proyectos y me interesa postular para la próxima cohorte. Quisiera saber:\n\n1. ¿Cuál es la modalidad (presencial / virtual) y el horario de clases?\n2. ¿El diplomado otorga certificación con validez internacional?\n3. ¿Existe algún descuento por pronto pago o convenio corporativo?\n\nAdjunto mi CV para su revisión. Quedo atento a su respuesta.\n\nSaludos cordiales,\nDiego Ramírez",
  attachments: [
    { name: "CV-Diego-Ramirez.pdf", size: "248 KB" },
    { name: "constancia-laboral.pdf", size: "96 KB" },
  ],
};

/* ------------------------------------------------------------------
   Tarea en llamada (detalle) — mock del canal Task de Connect.
------------------------------------------------------------------ */
export interface DemoTaskDetail {
  titulo: string;
  descripcion: string;
  prog: string;
  vence: string;
  prio: "alta" | "media" | "baja";
  origen: string;
  checklist: { label: string; done: boolean }[];
}

export const AG_TASK_DETAIL: DemoTaskDetail = {
  titulo: "Confirmar cita de asesoría — Valeria Castro",
  descripcion:
    "La lead prometió matrícula y agendó asesoría financiera para mañana 10:00 a.m. Confirmar asistencia y enviar recordatorio con el link de pago.",
  prog: "Admisión 2027 — Ing. Sistemas",
  vence: "Hoy 6:00 p.m.",
  prio: "media",
  origen: "Creada por el Copiloto tras la llamada anterior",
  checklist: [
    { label: "Confirmar asistencia a la cita", done: false },
    { label: "Enviar link de pago por WhatsApp", done: false },
    { label: "Actualizar etapa en Salesforce", done: true },
  ],
};

/* ------------------------------------------------------------------
   Coach IA (panel bajo el Copiloto) — mock del AICoachPanel real.
------------------------------------------------------------------ */
export interface DemoCoachBlock {
  kind: "callout" | "script" | "checklist" | "action";
  tone?: "info" | "warn" | "success";
  title?: string;
  text?: string;
  items?: string[];
  cta?: string;
}

export const AG_COACH: DemoCoachBlock[] = [
  {
    kind: "callout",
    tone: "warn",
    text: "El cliente bajó el ritmo al hablar de precio. Baja tu velocidad y valida la objeción antes de seguir.",
  },
  {
    kind: "script",
    title: "Reencuadre de valor",
    text: "Entiendo que la inversión es importante. Justamente por eso tenemos becas por mérito de hasta 50% y un plan en 5 cuotas sin intereses. ¿Le calculo su caso?",
  },
  {
    kind: "checklist",
    title: "Antes de cerrar",
    items: ["Confirmar correo para el link de pago", "Ofrecer asesoría financiera", "Agendar próximo contacto"],
  },
  {
    kind: "action",
    title: "Enviar ficha de becas 2027 por WhatsApp",
    cta: "Enviar plantilla",
  },
];

/* ------------------------------------------------------------------
   Llamadas perdidas (idle) — mock del MissedHistoryDrawer real.
------------------------------------------------------------------ */
export interface DemoMissed {
  id: string;
  name: string;
  phone: string;
  channel: "voz" | "wa" | "email";
  prog: string;
  ago: string;
  reason: string;
}

export const AG_MISSED: DemoMissed[] = [
  { id: "m1", name: "Lucía Fernández", phone: "+51 941 220 118", channel: "voz", prog: "ADM-27I", ago: "hace 12 min", reason: "Cliente colgó antes de contestar" },
  { id: "m2", name: "Mateo Ríos", phone: "+51 933 771 902", channel: "voz", prog: "PVER-27", ago: "hace 48 min", reason: "Timeout en cola" },
  { id: "m3", name: "Carmen Ávalos", phone: "+51 987 004 551", channel: "wa", prog: "DIP-GP", ago: "hace 2 h", reason: "Chat expirado" },
];

/* ------------------------------------------------------------------
   Buscar cliente (idle) — mock de Connect Customer Profiles.
------------------------------------------------------------------ */
export interface DemoProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  matchedBy: "Teléfono" | "Email" | "Nombre";
  prog: string;
}

export const AG_PROFILES: DemoProfile[] = [
  { id: "p1", name: "Ana Beltrán Ruiz", phone: "+51 953 730 189", email: "ana.beltran@correo.com", matchedBy: "Teléfono", prog: "ADM-27I" },
  { id: "p2", name: "Ana María Torres", phone: "+51 987 553 210", email: "anamaria.t@correo.com", matchedBy: "Nombre", prog: "PVER-27" },
  { id: "p3", name: "Analía Ponce", phone: "+51 941 882 077", email: "analia.ponce@correo.com", matchedBy: "Nombre", prog: "DIP-GP" },
];

/** Atendidos recientemente (cuando el buscador está vacío). */
export const AG_RECENTS: { name: string; phone: string; channel: "voz" | "wa" | "email"; ago: string }[] = [
  { name: "Andre Alata Calle", phone: "+51 704 989 78", channel: "voz", ago: "hace 5 min" },
  { name: "Sofía Quispe Mamani", phone: "+51 987 112 004", channel: "wa", ago: "hace 1 h" },
  { name: "Diego Ramírez Salas", phone: "diego.ramirez@correo.com", channel: "email", ago: "hace 3 h" },
];

/* ------------------------------------------------------------------
   Iniciar contacto completo (idle) — tiles del OutboundActionsMenu real.
------------------------------------------------------------------ */
export const AG_START_TILES: { id: string; label: string; sub: string; icon: string; color: string }[] = [
  { id: "quick", label: "Quick connects", sub: "Colas y agentes", icon: "users", color: "var(--cyan)" },
  { id: "lead", label: "Capturar lead", sub: "Referido / nuevo nº", icon: "userplus", color: "var(--green)" },
  { id: "task", label: "Tarea", sub: "Crear seguimiento", icon: "check", color: "var(--iris)" },
  { id: "email", label: "Email", sub: "Enviar correo", icon: "mail", color: "var(--gold)" },
];

/** Quick connects de ejemplo (al abrir el tile). */
export const AG_QUICK_CONNECTS: { name: string; type: "Cola" | "Agente" }[] = [
  { name: "Admisión — Nivel 2", type: "Cola" },
  { name: "Asesoría financiera", type: "Cola" },
  { name: "Camila Rojas", type: "Agente" },
  { name: "Supervisión", type: "Agente" },
];

/* ------------------------------------------------------------------
   Modales del CallBar (DTMF / Transferir / Conferencia) — mock.
------------------------------------------------------------------ */
export const AG_TRANSFER_TARGETS: { name: string; type: "Cola" | "Agente"; meta: string }[] = [
  { name: "Admisión — Nivel 2", type: "Cola", meta: "3 en espera" },
  { name: "Asesoría financiera", type: "Cola", meta: "1 en espera" },
  { name: "Soporte matrícula", type: "Cola", meta: "libre" },
  { name: "Camila Rojas", type: "Agente", meta: "Disponible" },
  { name: "Luis Paredes", type: "Agente", meta: "En llamada" },
];

/* ------------------------------------------------------------------
   Leads pre-asignados (idle) — mock del MyCampaignLeadsPanel real.
------------------------------------------------------------------ */
export interface DemoMyLead {
  id: string;
  name: string;
  phone: string;
  campaign: string;
  tags: string[];
}

export const AG_MY_LEADS: DemoMyLead[] = [
  { id: "l1", name: "Renzo Aguilar", phone: "+51 921 550 340", campaign: "Admisión 2027", tags: ["Meta Ads", "Score 82"] },
  { id: "l2", name: "Paola Medina", phone: "+51 954 118 662", campaign: "Programa Verano", tags: ["Referido", "Score 69"] },
  { id: "l3", name: "Gabriel Soto", phone: "+51 933 900 217", campaign: "Diplomado GP", tags: ["Landing", "Score 74"] },
];

/** Presets de reagendado para follow-ups (WrapUp + leads). */
export const AG_FOLLOWUP_PRESETS: { label: string; when: string }[] = [
  { label: "+30 min", when: "Hoy 4:30 p.m." },
  { label: "+1 h", when: "Hoy 5:00 p.m." },
  { label: "Mañana 9 a.m.", when: "Mañana 9:00 a.m." },
  { label: "En 3 días", when: "Vie 5 jul" },
];
