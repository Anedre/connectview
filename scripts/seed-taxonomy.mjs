#!/usr/bin/env node
/**
 * seed-taxonomy.mjs — writes the UDEP default disposition tree into the
 * connectview-taxonomies table (via the manage-taxonomy Function URL) as
 * the canonical default taxonomy. Mirrors src/lib/dispositions.ts so the
 * DB-backed source of truth starts identical to the old hardcoded tree.
 *
 * Usage: node scripts/seed-taxonomy.mjs <manage-taxonomy-url>
 */
const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/seed-taxonomy.mjs <manage-taxonomy-url>");
  process.exit(1);
}

const stages = [
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
      { id: "no_contesta", label: "No contesta" },
      { id: "economico_dscto", label: "Económico / Descuento" },
      { id: "financiamiento", label: "Financiamiento" },
      { id: "horario", label: "Horario" },
    ],
  },
  {
    id: "cerrando",
    label: "Cerrando",
    valoracion: "positiva",
    description: "Aceptó esquema de pago, en proceso de enviar formularios",
    subStages: [
      { id: "volver_llamar", label: "Volver a llamar" },
      { id: "volver_correo", label: "Volver a enviar correo" },
      { id: "volver_whatsapp", label: "Volver a enviar WhatsApp" },
      { id: "no_contesta", label: "No contesta" },
      { id: "pendiente_envio_doc", label: "Pendiente envío de documentación" },
      { id: "doc_parcial", label: "Por completar documentación / parcial" },
    ],
  },
  {
    id: "inscrito",
    label: "Inscrito",
    valoracion: "cierre",
    description: "Cliente que cumplió con todos los requisitos, incluyendo el pago",
    subStages: [{ id: "se_inscribio", label: "Se inscribió" }],
  },
  {
    id: "matriculado",
    label: "Matriculado",
    valoracion: "cierre",
    description: "Cliente que ya canceló",
    subStages: [{ id: "pagante", label: "Pagante" }],
  },
  {
    id: "no_interesado",
    label: "No interesado",
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
      { id: "proximo_inicio", label: "Próximo inicio" },
    ],
  },
  {
    id: "no_contactado",
    label: "No contactado",
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
  taxonomyId: "udep-default",
  name: "UDEP — Embudo de admisión",
  isDefault: true,
  stages,
  actor: "seed-script",
};

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(doc),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(res.ok ? 0 : 1);
