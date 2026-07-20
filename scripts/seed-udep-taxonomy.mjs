#!/usr/bin/env node
/**
 * seed-udep-taxonomy.mjs — crea la taxonomía "UDEP Posgrados" que CALCA el
 * dashboard de QuickSight "Últimas Tipificaciones" del cliente (Posgrados &
 * Formación Continua). A diferencia de seed-taxonomy.mjs (que escribe la
 * DEFAULT), esta es una taxonomía ASIGNABLE (isDefault:false, id estable
 * "udep-posgrados") que luego se ata a los programas UDEP desde la UI de
 * Programas ("Cambiar embudo") o vía manage-programs.
 *
 * Los 9 estados de 1er nivel = exactamente los del "RECUENTO POR ESTADO" del
 * QuickSight, en el mismo orden. "Próximo Inicio" —que en la taxonomía default
 * es un sub-estado de "No interesado"— aquí sube a estado propio, tal como lo
 * muestra el cliente.
 *
 * Uso:
 *   node scripts/seed-udep-taxonomy.mjs <manage-taxonomy-url>
 *   AUTH_TOKEN=<idToken> node scripts/seed-udep-taxonomy.mjs <url>   # tenant autenticado
 *
 * La URL de manage-taxonomy sale de amplify_outputs.json → custom.apiEndpoints.manageTaxonomy.
 */
const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/seed-udep-taxonomy.mjs <manage-taxonomy-url>");
  console.error("     (AUTH_TOKEN=<idToken> para escribir en el data plane de un tenant real)");
  process.exit(1);
}

const stages = [
  {
    id: "nuevo_lead",
    label: "Nuevo Lead",
    valoracion: "inicial",
    description: "Lead recién ingresado, todavía sin gestionar",
    subStages: [
      { id: "sin_asignar", label: "Sin asignar" },
      { id: "asignado", label: "Asignado" },
      { id: "importado_campana", label: "Importado de campaña" },
      { id: "origen_web", label: "Origen web / formulario" },
      { id: "origen_whatsapp", label: "Origen WhatsApp" },
    ],
  },
  {
    id: "gestionado",
    label: "Gestionado",
    valoracion: "positiva",
    description: "Lead que se comienza a gestionar — tiene nombre, correo y/o teléfono",
    subStages: [
      { id: "no_contesta", label: "No contesta" },
      { id: "no_figura_numero", label: "No figura número de teléfono" },
      { id: "numero_extranjero", label: "Número extranjero" },
      { id: "corta_llamada", label: "Corta llamada" },
      { id: "fuera_de_servicio", label: "Fuera de servicio" },
      { id: "contacto_tercero", label: "Contacto con tercero" },
    ],
  },
  {
    id: "contactado",
    label: "Contactado",
    valoracion: "positiva",
    description: "Se logra obtener respuesta del lead",
    subStages: [
      { id: "volver_llamar", label: "Volver a llamar" },
      { id: "volver_correo", label: "Volver a enviar correo" },
      { id: "volver_whatsapp", label: "Volver a enviar WhatsApp" },
    ],
  },
  {
    id: "interesado",
    label: "Interesado",
    valoracion: "positiva",
    description: "Cliente solicita información y se muestra interesado",
    subStages: [
      { id: "volver_llamar", label: "Volver a llamar" },
      { id: "volver_correo", label: "Volver a enviar correo" },
      { id: "volver_whatsapp", label: "Volver a enviar WhatsApp" },
      { id: "no_contesta", label: "No contesta" },
    ],
  },
  {
    id: "negociando",
    label: "Negociando",
    valoracion: "positiva",
    description: "Tomó decisión, negocia precio o modalidad de pago",
    subStages: [
      { id: "volver_llamar", label: "Volver a llamar" },
      { id: "volver_correo", label: "Volver a enviar correo" },
      { id: "volver_whatsapp", label: "Volver a enviar WhatsApp" },
      { id: "economico_dscto", label: "Económico / Descuento" },
      { id: "financiamiento", label: "Financiamiento" },
      { id: "horario", label: "Horario" },
    ],
  },
  {
    id: "inscrito",
    label: "Inscrito",
    valoracion: "cierre",
    description: "Cliente que cumplió con todos los requisitos, incluyendo el pago",
    subStages: [
      { id: "se_inscribio", label: "Se inscribió" },
      { id: "pagante", label: "Pagante / matriculado" },
    ],
  },
  {
    id: "proximo_inicio",
    label: "Próximo Inicio",
    valoracion: "positiva",
    description: "Interesado a la espera del próximo inicio del programa (se reactiva)",
    subStages: [
      { id: "espera_fecha", label: "En espera de la fecha de inicio" },
      { id: "reservo_cupo", label: "Reservó cupo" },
      { id: "reagendar_siguiente", label: "Reagendar al siguiente ciclo" },
    ],
  },
  {
    id: "no_interesado",
    label: "No Interesado",
    valoracion: "negativa",
    description: "Lead que se cayó entre contactado y cerrando",
    subStages: [
      { id: "producto_competencia", label: "Producto / Competencia" },
      { id: "no_solicito_info", label: "No solicitó información" },
      { id: "sin_interes_no_especifica", label: "Sin interés (no especifica)" },
      { id: "destinatario_erroneo", label: "Destinatario erróneo" },
      { id: "economico_precio", label: "Económico — precio" },
      { id: "modalidad_presencial", label: "Modalidad presencial" },
      { id: "modalidad_virtual", label: "Modalidad virtual" },
      { id: "motivos_personales", label: "Motivos personales" },
      { id: "motivos_laborales", label: "Motivos laborales" },
      { id: "sin_horario", label: "No contamos con horario" },
      { id: "no_cumple_perfil", label: "No cumple con requisito / perfil" },
      { id: "sin_programa", label: "No contamos con programa" },
      { id: "black_list", label: "Black list" },
    ],
  },
  {
    id: "no_contactado",
    label: "No Contactado",
    valoracion: "negativa",
    description: "Después de varios intentos nunca contestó",
    subStages: [
      { id: "buzon", label: "Buzón" },
      { id: "corta_llamada", label: "Corta llamada" },
      { id: "inubicable", label: "Inubicable / nunca contestó" },
      { id: "numero_no_existe", label: "Número no existe" },
    ],
  },
];

const doc = {
  taxonomyId: "udep-posgrados",
  name: "UDEP Posgrados — Últimas Tipificaciones",
  isDefault: false,
  stages,
  actor: "seed-udep-taxonomy",
};

const headers = { "Content-Type": "application/json" };
if (process.env.AUTH_TOKEN) headers.Authorization = `Bearer ${process.env.AUTH_TOKEN}`;

const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(doc) });
const json = await res.json().catch(() => ({}));
console.log(JSON.stringify(json, null, 2));
console.log(
  res.ok
    ? `\n✅ Taxonomía "udep-posgrados" lista. Asígnala a los programas UDEP desde Programas → (programa) → Cambiar embudo.`
    : `\n❌ Falló (HTTP ${res.status}).`,
);
process.exit(res.ok ? 0 : 1);
