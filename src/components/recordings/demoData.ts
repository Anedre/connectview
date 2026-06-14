/**
 * demoData — dataset de ejemplo "denso" para el SHOWCASE de Historial y
 * Grabaciones (/recordings-demo), portado 1:1 del mockup de Claude Design.
 * SOLO se usa en la vista de demostración; la pantalla real (/recordings) jamás
 * lo toca. Determinista (PRNG sembrado + fechas fijas) para que se vea igual
 * siempre. Ver [[project_recordings_redesign]].
 */
export type Sent = "positivo" | "neutral" | "mixto" | "negativo";

export interface DemoContact {
  id: string; nombre: string; sub: string; tel: string; origen: string; dot: string; activo?: boolean;
}
export interface DemoCall {
  id: string; date: Date; dir: "entrante" | "saliente" | "perdida"; perdida: boolean;
  agente: string; dur: number; status: string; sent: Sent; tipi: string; grab: boolean; nota: string;
  resumenIA?: string;
  momentos?: { t: number; label: string; tone: Sent }[];
  transcript?: { t: number; who: "Agente" | "Cliente"; s: Sent; text: string }[];
}
export interface DemoWa { dir: "in" | "out"; text: string; file: boolean; date: Date; newConv: boolean }

let _s = 20260613;
const rnd = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

export const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const agentes = ["Camila Rojas", "Diego Paredes", "Valentina Núñez", "Mateo Salas", "Cola: Cobranzas", "Cola: Admisión", "Lucía Fernández"];
const tipis = ["Promesa de pago", "Sin tipificar", "No contesta", "Información enviada", "Reagendar", "Cliente molesto", "Interesado", "Buzón de voz"];

export const contactos: DemoContact[] = [
  { id: "andre", nombre: "Andre Elian Alata Calle", sub: "Etapa → No contactado · hace 5 d", tel: "70498978", origen: "Teléfono", dot: "--cian", activo: true },
  { id: "zhenia", nombre: "Zhenia Gissela Loyola Diaz", sub: "Llamada · sin tipificar · hace 11 d", tel: "+51 962 383 768", origen: "Teléfono", dot: "--cian" },
  { id: "p51962", nombre: "+51 962 383 768", sub: "Llamada · sin tipificar · hace 11 d", tel: "+51 962 383 768", origen: "Teléfono", dot: "--cian" },
  { id: "nuevo", nombre: "NUEVO NUEVO", sub: "Sync Salesforce · hace 11 d", tel: "—", origen: "Salesforce", dot: "--violeta" },
  { id: "lucia", nombre: "Lucia Web", sub: "Sync Salesforce · hace 11 d", tel: "—", origen: "WhatsApp", dot: "--verde" },
  { id: "bertha", nombre: "Bertha Boxer", sub: "Sin actividad · hace 11 d", tel: "—", origen: "Correo", dot: "--ambar" },
  { id: "phyllis", nombre: "Phyllis Cotton", sub: "Sin actividad · hace 11 d", tel: "—", origen: "Teléfono", dot: "--cian" },
  { id: "jeff", nombre: "Jeff Glimpse", sub: "Sin actividad · hace 11 d", tel: "—", origen: "WhatsApp", dot: "--verde" },
  { id: "sofia", nombre: "Sofía Quispe Mamani", sub: "WhatsApp · respondido · hace 12 d", tel: "+51 987 112 004", origen: "WhatsApp", dot: "--verde" },
  { id: "carlos", nombre: "Carlos Huamán Ríos", sub: "Llamada · promesa de pago · hace 13 d", tel: "+51 951 880 220", origen: "Teléfono", dot: "--cian" },
  { id: "maria", nombre: "María José Tello", sub: "Email · enviado · hace 14 d", tel: "—", origen: "Correo", dot: "--ambar" },
  { id: "raul", nombre: "Raúl Mendoza Vela", sub: "Sync Salesforce · hace 15 d", tel: "—", origen: "Salesforce", dot: "--violeta" },
];

const sentW: Sent[] = ["positivo", "positivo", "positivo", "neutral", "neutral", "neutral", "neutral", "mixto", "mixto", "negativo"];
export const llamadas: DemoCall[] = [];
const totalCalls = 118;
let cursor = new Date(2026, 5, 8);
for (let i = 0; i < totalCalls; i++) {
  cursor = new Date(cursor.getTime() - int(0, 4) * 86400000 - int(0, 6) * 3600000);
  const dir = pick(["entrante", "saliente", "saliente", "entrante", "perdida", "saliente"] as const);
  const perdida = dir === "perdida";
  const dur = perdida ? 0 : int(18, 640);
  const sent: Sent = perdida ? "negativo" : pick(sentW);
  const ag = pick(agentes);
  llamadas.push({
    id: "c" + i, date: new Date(cursor), dir, perdida,
    agente: dir === "entrante" ? (rnd() > 0.5 ? ag : "Cola: Cobranzas") : ag,
    dur, status: perdida ? "Perdida" : "Contestada", sent,
    tipi: perdida ? "No contesta" : pick(tipis), grab: !perdida,
    nota: rnd() > 0.7 ? pick(["Cliente pidió reagendar para fin de mes.", "Confirmó datos de contacto.", "Solicita hablar con supervisor.", "Promesa de pago parcial.", ""]) : "",
  });
}
const contestadas = llamadas.filter((c) => !c.perdida).length;
const perdidas = llamadas.filter((c) => c.perdida).length;
const durProm = Math.round(llamadas.filter((c) => !c.perdida).reduce((s, c) => s + c.dur, 0) / contestadas);

export const dayKey = (d: Date) => d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();

// Llamada de ejemplo (la rica, con transcripción + sentimiento + momentos).
const ejemplo = llamadas.find((c) => !c.perdida && c.dur > 180) || llamadas[0];
ejemplo.sent = "mixto";
ejemplo.dur = 327;
ejemplo.agente = "Camila Rojas";
ejemplo.tipi = "Promesa de pago";
ejemplo.resumenIA = "El cliente consulta por el estado de su deuda y muestra molestia inicial por un cobro duplicado. La agente verifica el caso, confirma el error y ofrece reversar el cargo en 48h. El cliente acepta y se compromete a regularizar el saldo restante antes de fin de mes.";
ejemplo.momentos = [
  { t: 22, label: "Motivo: cobro duplicado", tone: "negativo" },
  { t: 96, label: "Verificación de cuenta", tone: "neutral" },
  { t: 178, label: "Ofrece reverso 48h", tone: "positivo" },
  { t: 268, label: "Promesa de pago", tone: "positivo" },
];
ejemplo.transcript = [
  { t: 4, who: "Agente", s: "neutral", text: "Buenas tardes, le saluda Camila de ARIA. ¿Hablo con el señor Andre Alata?" },
  { t: 9, who: "Cliente", s: "neutral", text: "Sí, con él. Mire, lo llamo porque me cobraron dos veces la misma cuota." },
  { t: 22, who: "Cliente", s: "negativo", text: "Es la segunda vez que pasa y nadie me da una solución, la verdad estoy molesto." },
  { t: 34, who: "Agente", s: "neutral", text: "Lamento mucho el inconveniente, lo entiendo perfectamente. Déjeme verificar su cuenta ahora mismo." },
  { t: 52, who: "Agente", s: "neutral", text: "¿Me confirma su número de documento para validar la información, por favor?" },
  { t: 60, who: "Cliente", s: "neutral", text: "Claro, es 70498978." },
  { t: 96, who: "Agente", s: "neutral", text: "Gracias. Efectivamente veo dos cargos del 12 de mayo por el mismo monto. Tiene toda la razón." },
  { t: 120, who: "Cliente", s: "mixto", text: "Entonces fue error de ustedes. ¿Y eso cómo se arregla?" },
  { t: 178, who: "Agente", s: "positivo", text: "Voy a generar la reversión del cargo duplicado. Se verá reflejado en un máximo de 48 horas hábiles." },
  { t: 206, who: "Cliente", s: "neutral", text: "Ya, está bien. ¿Y el saldo que sí debo?" },
  { t: 240, who: "Agente", s: "positivo", text: "Le quedaría únicamente la cuota de junio. ¿Le parece si la regularizamos antes de fin de mes?" },
  { t: 268, who: "Cliente", s: "positivo", text: "Sí, dame hasta el 28 y la pago completa, sin problema." },
  { t: 300, who: "Agente", s: "positivo", text: "Perfecto, lo registro como promesa de pago para el 28. Le envío la confirmación por WhatsApp." },
  { t: 318, who: "Cliente", s: "positivo", text: "Listo, te agradezco la ayuda Camila." },
];

// Día del ejemplo enriquecido con más llamadas (lista del día sustanciosa).
const ed = ejemplo.date;
const sibs = [
  { h: 9, m: 12, dir: "saliente" as const, ag: "Diego Paredes", dur: 42, sent: "neutral" as Sent, st: "Contestada", tipi: "No contesta familiar" },
  { h: 10, m: 48, dir: "entrante" as const, ag: "Cola: Cobranzas", dur: 0, sent: "negativo" as Sent, st: "Perdida", tipi: "No contesta", perdida: true },
  { h: 12, m: 5, dir: "saliente" as const, ag: "Camila Rojas", dur: 198, sent: "mixto" as Sent, st: "Contestada", tipi: "Reagendar" },
  { h: 15, m: 33, dir: "entrante" as const, ag: "Valentina Núñez", dur: 276, sent: "positivo" as Sent, st: "Contestada", tipi: "Información enviada" },
  { h: 17, m: 9, dir: "saliente" as const, ag: "Cola: Cobranzas", dur: 0, sent: "negativo" as Sent, st: "Perdida", tipi: "Buzón de voz", perdida: true },
  { h: 19, m: 41, dir: "saliente" as const, ag: "Mateo Salas", dur: 121, sent: "neutral" as Sent, st: "Contestada", tipi: "Interesado" },
];
sibs.forEach((s, i) => {
  llamadas.push({
    id: "ej-sib" + i, date: new Date(ed.getFullYear(), ed.getMonth(), ed.getDate(), s.h, s.m),
    dir: s.dir, perdida: !!s.perdida, agente: s.ag, dur: s.dur, status: s.st, sent: s.sent, tipi: s.tipi,
    grab: !s.perdida, nota: "",
  });
});

export const porDia: Record<string, DemoCall[]> = {};
llamadas.forEach((c) => { const k = dayKey(c.date); (porDia[k] = porDia[k] || []).push(c); });

const waSeed: [DemoWa["dir"], string, boolean][] = [
  ["in", "Hola, buenas. Quería saber sobre mi estado de cuenta", false],
  ["out", "¡Hola Andre! Claro, déjame revisar tu caso un momento 🙌", false],
  ["out", "Tu saldo pendiente es de S/ 480. ¿Te ayudo a generar el link de pago?", false],
  ["in", "Sí porfa", false],
  ["out", "Aquí tienes 👇", false],
  ["out", "comprobante_pago.pdf", true],
  ["in", "Listo, ya pagué la mitad", false],
  ["in", "captura_yape.jpg", true],
  ["out", "¡Recibido! Gracias Andre, lo registro 😊", false],
  ["in", "¿Cuándo vence lo que falta?", false],
  ["out", "El 28 de este mes. Te recuerdo unos días antes 👍", false],
  ["in", "Ok gracias", false],
];
export const waMsgs: DemoWa[] = [];
let wd = new Date(2026, 5, 3, 9, 15);
for (let i = 0; i < 80; i++) {
  const seed = waSeed[i % waSeed.length];
  wd = new Date(wd.getTime() + int(2, 55) * 60000 + (i % waSeed.length === 0 ? int(1, 6) * 86400000 : 0));
  waMsgs.push({ dir: seed[0], text: seed[1], file: seed[2], date: new Date(wd), newConv: i % waSeed.length === 0 && i > 0 });
}

export const emails = [
  { asunto: "Consulta admisión - Quiero información sobre Ingeniería", from: "+51 953 730 189", msgs: [{ who: "Cliente", date: "hace 22 días", text: "Buenas tardes, quisiera información sobre el proceso de admisión para Ingeniería de Sistemas, costos y fechas. Gracias.", file: undefined as string | undefined }] },
  { asunto: "Consulta admisión 2027 - Pregrado Ingeniería", from: "+51 953 730 189", msgs: [{ who: "Cliente", date: "hace 22 días", text: "Hola, ¿siguen abiertas las inscripciones para el ciclo 2027? Adjunto mi constancia de estudios.", file: "constancia_estudios.pdf" as string | undefined }] },
];

export const archivos = [
  { nombre: "captura_yape.jpg", tipo: "img", canal: "WhatsApp", quien: "Cliente", size: "248 KB", color: "--verde" },
  { nombre: "comprobante_pago.pdf", tipo: "pdf", canal: "WhatsApp", quien: "Agente", size: "96 KB", color: "--verde" },
  { nombre: "constancia_estudios.pdf", tipo: "pdf", canal: "Email", quien: "Cliente", size: "1.2 MB", color: "--ambar" },
];

export const historial = [
  { icon: "trending", color: "--violeta", title: "Cambio de etapa → No contactado", meta: "Automatización · hace 5 d" },
  { icon: "tag", color: "--cian", title: "Llamada tipificada: Promesa de pago", meta: "Camila Rojas · hace 5 d" },
  { icon: "refresh", color: "--violeta", title: "Sincronizado con Salesforce", meta: "Sistema · hace 8 d" },
  { icon: "trending", color: "--violeta", title: "Cambio de etapa → En seguimiento", meta: "Diego Paredes · hace 11 d" },
  { icon: "tag", color: "--cian", title: "Llamada tipificada: Reagendar", meta: "Cola: Cobranzas · hace 13 d" },
  { icon: "refresh", color: "--violeta", title: "Lead creado desde formulario web", meta: "Sistema · hace 28 d" },
  { icon: "refresh", color: "--violeta", title: "Origen asignado: Teléfono", meta: "Sistema · hace 28 d" },
];

export const sentColor: Record<Sent, string> = { positivo: "--verde", neutral: "--text-3", mixto: "--ambar", negativo: "--rojo" };
export const sentMix = { positivo: 46, neutral: 34, mixto: 13, negativo: 7 };
export const ejemploCall = ejemplo;
export const metrics = { total: totalCalls, contestadas, perdidas, durProm, contestPct: Math.round((contestadas / totalCalls) * 100) };
export const counts = { llamadas: 118, whatsapp: 80, emails: 2, archivos: 3, historial: 7, total: 200 };
