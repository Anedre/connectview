/**
 * Disposition tree — the two-level taxonomy agents use during wrap-up to
 * tag the outcome of a contact. The default tree below is the UDEP
 * proposal (Stages + Sub Stages) for educational telemarketing, but
 * customers can override it via `amplify_outputs.json.custom.dispositionTree`
 * (raw JSON) to fit their own funnel.
 */

import outputs from "../../amplify_outputs.json";

export type Valoracion = "positiva" | "negativa" | "cierre";

export interface DispositionStage {
  /** Internal id — should be stable; saved to Contact Attributes verbatim. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Color for the chip and accent. */
  valoracion: Valoracion;
  /** Optional description shown next to the stage card. */
  description?: string;
  /** Sub-stages the agent picks from after choosing this stage. */
  subStages: DispositionSubStage[];
}

export interface DispositionSubStage {
  id: string;
  label: string;
}

const UDEP_DEFAULT: DispositionStage[] = [
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

/**
 * Read the tree from amplify outputs if the customer configured one,
 * otherwise fall back to the UDEP default.
 */
export function getDispositionTree(): DispositionStage[] {
  try {
    const custom = (outputs as Record<string, unknown>).custom as
      | Record<string, string>
      | undefined;
    const raw = custom?.dispositionTree;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as DispositionStage[];
      }
    }
  } catch {
    /* fall through to default */
  }
  return UDEP_DEFAULT;
}

export const VALORACION_META: Record<
  Valoracion,
  { label: string; chip: string }
> = {
  positiva: { label: "Valoración positiva", chip: "chip--green" },
  negativa: { label: "Valoración negativa", chip: "chip--red" },
  cierre: { label: "Cierre", chip: "chip--violet" },
};
