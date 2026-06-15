/**
 * Disposition tree — the two-level taxonomy agents use during wrap-up to
 * tag the outcome of a contact. The default tree below is a generic
 * sales/telemarketing funnel (Stages + Sub Stages); customers override it
 * via the DB-backed taxonomy (connectview-taxonomies) or
 * `amplify_outputs.json.custom.dispositionTree` to fit their own funnel.
 */

import outputs from "../../amplify_outputs.json";
import { getApiEndpoints } from "./api";

export type Valoracion = "inicial" | "positiva" | "negativa" | "cierre";

export interface DispositionStage {
  /** Internal id — should be stable; saved to Contact Attributes verbatim. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Color for the chip and accent. */
  valoracion: Valoracion;
  /** Optional description shown next to the stage card. */
  description?: string;
  /** Optional mapping to a Salesforce field value — used when syncing the
   *  wrap-up OUT to SF so the single taxonomy drives the CRM (roadmap #23). */
  salesforceValue?: string;
  /** Sub-stages the agent picks from after choosing this stage. */
  subStages: DispositionSubStage[];
}

export interface DispositionSubStage {
  id: string;
  label: string;
  salesforceValue?: string;
}

/** A full taxonomy doc as stored in connectview-taxonomies. */
export interface TaxonomyDoc {
  taxonomyId: string;
  name: string;
  isDefault?: boolean;
  stages: DispositionStage[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_DISPOSITIONS: DispositionStage[] = [
  {
    id: "nuevo_lead",
    label: "Nuevo lead",
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

// ─── Unified taxonomy source of truth ──────────────────────────────────
// The canonical taxonomy now lives in DynamoDB (connectview-taxonomies)
// and is served by the manage-taxonomy Lambda. This replaces the 3 separate
// taxonomies the client kept in Salesforce / Chattigo / Kommo — every
// channel's wrap-up reads the SAME tree.
//
// We keep getDispositionTree() as a SYNC accessor (returns the in-memory
// cache, or the static fallback before the first load) so existing callers
// don't break, plus an async loader the useTaxonomy hook drives.

/** In-memory cache of the active taxonomy, populated by loadTaxonomies(). */
let cachedDefault: DispositionStage[] | null = null;
let cachedDocs: TaxonomyDoc[] | null = null;

/** Static fallback: amplify_outputs override → generic default. Used only
 *  until the DB-backed taxonomy loads (or if the Lambda is unreachable). */
function staticFallback(): DispositionStage[] {
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
    /* fall through */
  }
  return DEFAULT_DISPOSITIONS;
}

/** Sync accessor — cache if loaded, else static fallback. Back-compat. */
export function getDispositionTree(): DispositionStage[] {
  return cachedDefault ?? staticFallback();
}

/** Fetch all taxonomies from the manage-taxonomy Lambda. Caches the
 *  default tree for getDispositionTree(). Never throws — returns the
 *  static fallback as a single synthetic doc on failure. */
export async function loadTaxonomies(
  force = false
): Promise<TaxonomyDoc[]> {
  if (cachedDocs && !force) return cachedDocs;
  const endpoints = getApiEndpoints();
  if (!endpoints?.manageTaxonomy) {
    return [
      {
        taxonomyId: "fallback",
        name: "Default",
        isDefault: true,
        stages: staticFallback(),
      },
    ];
  }
  try {
    const r = await fetch(endpoints.manageTaxonomy);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const docs: TaxonomyDoc[] = Array.isArray(data.taxonomies)
      ? data.taxonomies
      : [];
    if (docs.length === 0) throw new Error("no taxonomies");
    cachedDocs = docs;
    const def = docs.find((d) => d.isDefault) ?? docs[0];
    if (def?.stages?.length) cachedDefault = def.stages;
    return docs;
  } catch {
    return [
      {
        taxonomyId: "fallback",
        name: "Default",
        isDefault: true,
        stages: staticFallback(),
      },
    ];
  }
}

/** Invalidate the cache (call after an admin edits a taxonomy). */
export function invalidateTaxonomyCache(): void {
  cachedDefault = null;
  cachedDocs = null;
}

export const VALORACION_META: Record<
  Valoracion,
  { label: string; chip: string }
> = {
  inicial: { label: "Inicial", chip: "chip--cyan" },
  positiva: { label: "Valoración positiva", chip: "chip--green" },
  negativa: { label: "Valoración negativa", chip: "chip--red" },
  cierre: { label: "Cierre", chip: "chip--violet" },
};
