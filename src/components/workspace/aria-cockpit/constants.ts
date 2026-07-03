/* Constantes de layout del cockpit — extraídas para no repetir literales
   mágicos en los primitivos y evitar arrays inline en cada render. */

/** Alturas base de las barras de la waveform del CallBar. */
export const WAVE_BARS = [40, 70, 30, 90, 55, 80, 45, 100, 60, 35, 75, 50, 85, 40, 65, 30, 70];

/** Cada N barras la waveform usa el color cyan (acento secundario). */
export const CY_STEP = 5;

/** Formatea segundos a m:ss para el timer del CallBar. */
export function fmtDur(s: number): string {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
