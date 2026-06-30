/**
 * phone — normalización canónica de teléfonos para dedup / matching, agnóstica
 * del país. NO inventa código de país: solo limpia el formato (espacios, guiones,
 * paréntesis, "00" → "+") y compara por dígitos significativos.
 *
 * Arregla el match exacto que generaba DUPLICADOS: Vox guarda E.164 ("+51999…")
 * y Salesforce guarda lo que el agente tipeó ("999 888 777", "(01) …"). Antes
 * `Phone = '+51999…'` no matcheaba el lead ya existente → se creaba uno nuevo.
 */

export interface NormalizedPhone {
  /** Mejor esfuerzo E.164: "+<dígitos>" si venía con "+"/"00"; si no, los dígitos. */
  e164: string;
  /** Solo dígitos (sin "+"), para comparar. */
  digits: string;
}

/** Normaliza un teléfono a forma canónica. Devuelve null si es demasiado corto. */
export function normalizePhone(raw?: string | null): NormalizedPhone | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // "00xx" (prefijo internacional marcado) → "+xx".
  s = s.replace(/^00/, "+");
  const hadPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return null; // demasiado corto para un teléfono real
  return { e164: hadPlus ? `+${digits}` : digits, digits };
}

/**
 * ¿Son el mismo teléfono? Compara por dígitos completos, tolerando que uno traiga
 * código de país y el otro no (p.ej. "+51999888777" == "999888777"). Exige que el
 * más largo TERMINE en el más corto y que el extra sea ≤3 dígitos (código de país)
 * para no dar falsos positivos entre abonados distintos.
 */
export function samePhone(a?: string | null, b?: string | null): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na.digits === nb.digits) return true;
  const [short, long] =
    na.digits.length <= nb.digits.length ? [na.digits, nb.digits] : [nb.digits, na.digits];
  return short.length >= 8 && long.endsWith(short) && long.length - short.length <= 3;
}

/**
 * Variantes de literal a probar al BUSCAR un teléfono en Salesforce (que guarda
 * formatos arbitrarios). Cubrimos los dos almacenamientos comunes: E.164
 * ("+51999…") y dígitos pelados ("999…"). NO cubre puntuación interna
 * (espacios/guiones) — para eso está el match determinístico por `VoxLeadId__c`:
 * una vez vinculado, el teléfono deja de importar para el dedup.
 */
export function sfPhoneCandidates(raw?: string | null): string[] {
  const n = normalizePhone(raw);
  if (!n) return [];
  const out = new Set<string>([n.e164, n.digits]);
  return [...out].filter(Boolean);
}
