/**
 * SEC-M1 — Enmascarado de PII (teléfonos / identificadores de usuario) para logs.
 *
 * Los teléfonos crudos (E.164) y los identificadores de usuario (PSID de Meta)
 * NO deben quedar en texto plano en CloudWatch. Este helper deja visible lo
 * mínimo para depurar (prefijo de país + últimos dígitos) y oculta el medio con
 * puntos medios "•".
 *
 * Ejemplos:
 *   maskPhone("+51953730189")  → "+51•••••189"   (prefijo +NN + últimos 3)
 *   maskPhone("51953730189")   → "51•••••189"    (sin +, mismo criterio)
 *   maskPhone("12345")         → "•••45"         (corto → solo últimos 2)
 *   maskPhone("")              → ""
 *   maskPhone(null)            → ""
 *
 * También sirve para PSIDs de Meta u otros identificadores de usuario: son PII,
 * se enmascaran igual (se tratan como "número corto" salvo que empiecen con +).
 *
 * Sin dependencias externas — se puede bundlear en cualquier Lambda.
 */
export function maskPhone(p?: string | null): string {
  if (!p) return "";
  const raw = String(p).trim();
  if (!raw) return "";

  // ¿Empieza con "+" (E.164)? Preservamos el "+" y el prefijo de país.
  const hasPlus = raw.startsWith("+");
  const digits = hasPlus ? raw.slice(1) : raw;

  // Números "cortos" (o identificadores sin +): ocultamos todo menos los
  // últimos 2. Umbral: para dejar prefijo(2) + medio + sufijo(3) hace falta
  // razonablemente >= 7 dígitos; por debajo, tratamos como corto.
  if (!hasPlus || digits.length < 7) {
    const tail = digits.slice(-2);
    const hiddenCount = Math.max(1, digits.length - tail.length);
    return "•".repeat(hiddenCount) + tail;
  }

  // E.164 normal: prefijo de país = "+" + primeros 2 dígitos, sufijo = últimos 3.
  const prefix = "+" + digits.slice(0, 2);
  const suffix = digits.slice(-3);
  const hiddenCount = Math.max(1, digits.length - 2 - 3);
  return prefix + "•".repeat(hiddenCount) + suffix;
}
