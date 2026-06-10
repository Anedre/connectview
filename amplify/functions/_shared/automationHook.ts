/**
 * automationHook — notifica eventos de negocio al automation-engine (#15).
 *
 * Fire-and-forget CON await (en Lambda un fetch sin await se congela al
 * devolver la respuesta): AbortController ~1500ms + catch total → el hook
 * NUNCA rompe ni demora (más de 1.5s) al handler que lo llama. NO-OP si
 * faltan los envs (rollout seguro: sin AUTOMATION_ENGINE_URL no pasa nada).
 *
 * El engine corre a término aunque abortemos acá (Function URL buffered:
 * una vez que el request llegó, la invocación sigue sola).
 */
import type { AutomationEvent } from "../automation-engine/handler";

const ENGINE_URL = process.env.AUTOMATION_ENGINE_URL || "";
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";

export async function fireAutomation(event: AutomationEvent): Promise<void> {
  if (!ENGINE_URL || !INTERNAL_SECRET) return; // no configurado → no-op
  if (!event?.type || !event?.tenantId) return;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-vox-internal": INTERNAL_SECRET },
      body: JSON.stringify({ event }),
      signal: ac.signal,
    });
  } catch {
    /* timeout/red caída → el negocio sigue; el engine es best-effort */
  } finally {
    clearTimeout(timer);
  }
}
