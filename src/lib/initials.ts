/**
 * initials — iniciales canónicas para avatares en TODA la app. Una sola fuente
 * para que el mismo nombre dé SIEMPRE el mismo avatar. Antes había 4 versiones
 * (aria/primitives, vox/primitives, LeadsPage, pipeline/FlowView) con lógica
 * distinta, así que el mismo texto ("Lead Prueba ARIA") daba "LP" en una vista y
 * "LA" en otra.
 *
 * Regla: primer carácter de las 2 PRIMERAS palabras, separando por espacio,
 * guion, punto o guion bajo (cubre nombres "Lead Prueba" y usernames "juan-perez").
 * Con una sola palabra, usa sus 2 primeras letras. Sin letras → "?".
 */
export function initials(name?: string | null): string {
  const parts = String(name ?? "")
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
