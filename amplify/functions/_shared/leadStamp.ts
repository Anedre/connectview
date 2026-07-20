/**
 * leadStamp — decisión PURA (sin AWS) del estampado del agente de Connect sobre
 * el lead que comparte teléfono. Es el corazón testeable del "quién atendió la
 * llamada" que alimenta el tab Pipeline de /reports (report=typifications lee
 * `agent: typ?.agent || l.assignedAgent`, así que estampar assignedAgent llena el
 * hueco cuando la tipificación no capturó al agente o aún no hay tipificación).
 *
 * La escritura a DynamoDB (query al GSI phone-index + UpdateItem condicional) vive
 * en process-contact-event/handler.ts; acá solo la lógica de "¿aplica? ¿con qué
 * claves de teléfono busco?" — así se testea sin montar el SDK.
 */
import { sfPhoneCandidates } from "./phone";

export interface LeadStampPlan {
  /** Username del agente de Connect que atendió el contacto. */
  agent: string;
  /** Literales de teléfono a probar contra el GSI phone-index (E.164 + dígitos),
   *  para tolerar leads guardados como "+51999…" o como "51999…". */
  phoneCandidates: string[];
}

/**
 * Decide si un contacto cerrado debe estampar su agente sobre el lead que comparte
 * teléfono, y con qué claves buscarlo. Devuelve null cuando NO aplica:
 *  · sin `agentUsername` → nadie atendió (perdida/abandonada) → nada que estampar;
 *  · el endpoint no normaliza a un teléfono real (CHAT/EMAIL, endpoints raros) →
 *    no hay teléfono con qué matchear un lead. Esto restringe el estampado a voz
 *    de forma natural, sin un check de canal explícito.
 */
export function planLeadStamp(input: {
  phone?: string | null;
  agentUsername?: string | null;
}): LeadStampPlan | null {
  const agent = (input.agentUsername || "").trim();
  if (!agent) return null;
  const phoneCandidates = sfPhoneCandidates(input.phone);
  if (phoneCandidates.length === 0) return null;
  return { agent, phoneCandidates };
}
