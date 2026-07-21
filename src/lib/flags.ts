/**
 * flags — feature flags LIGEROS de front, toggleables en runtime vía localStorage
 * con un default en código. No hay backend de flags: esto alcanza para prender
 * una feature POR-NAVEGADOR (QA/rollout gradual) y verificarla en la app real
 * antes de habilitarla para todos.
 *
 * Uso en consola para QA:  localStorage.setItem("vox:flag:flujosFusion", "1")
 * Para volver al fallback:  localStorage.removeItem("vox:flag:flujosFusion")
 */

const PREFIX = "vox:flag:";

function readFlag(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(PREFIX + key);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* SSR / storage bloqueado → usar el default */
  }
  return def;
}

/**
 * Fusión de motores "Flujos" (Fase 1): UN builder + UNA lista que rutea al motor
 * correcto (regla / journey / split) según la forma. OFF por defecto → el hub de
 * la Fase 0 (picker Reflejo/Recorrido, dos editores separados) es el fallback.
 * Se habilita cuando la verificación E2E por forma confirma 1 sola ejecución.
 */
export const FLUJOS_FUSION_DEFAULT = false;

export function isFlujosFusionEnabled(): boolean {
  return readFlag("flujosFusion", FLUJOS_FUSION_DEFAULT);
}
